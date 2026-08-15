import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import { prisma } from '@/lib/prisma.js'
import { deleteFile, getFileUrl, saveFile } from '@/services/storage.service.js'
import {
  MEETING_FROZEN_ERROR,
  MEETING_FROZEN_MESSAGE,
  isMeetingFrozen,
} from '@/services/council-compliance.js'
import { z } from 'zod'
import { CouncilDocumentType } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestUser {
  user: {
    id: string
    organizationId: string
    isSuperAdmin: boolean
    permissions?: string[]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64')
}

async function resolveCouncil(councilId: string, orgFilter: Record<string, unknown>) {
  return prisma.council.findFirst({ where: { id: councilId, ...orgFilter } })
}

async function resolveMeeting(meetingId: string, councilId: string, orgFilter: Record<string, unknown>) {
  return prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
}

// ─── Validation ───────────────────────────────────────────────────────────────

const uploadFieldsSchema = z.object({
  title:        z.string().min(1).max(300).optional(),
  documentType: z.nativeEnum(CouncilDocumentType).default(CouncilDocumentType.ATA),
})

const docParam = z.object({
  councilId: z.string().min(1),
  meetingId: z.string().min(1),
})

const docDetailParam = z.object({
  councilId: z.string().min(1),
  meetingId: z.string().min(1),
  docId:     z.string().min(1),
})

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// ─── Controller ───────────────────────────────────────────────────────────────

export const documentController = {

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, meetingId } = docParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, orgFilter)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const documents = await prisma.councilDocument.findMany({
        where: { meetingId, ...orgFilter },
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy:       { select: { id: true, firstName: true, lastName: true } },
          signatureRequests: { select: { id: true, status: true, signedAt: true, requestedById: true } },
        },
      })

      return reply.send({ data: documents })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Documents Failed', message: (err as Error).message })
    }
  },

  async upload(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, meetingId } = docParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, orgFilter)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (isMeetingFrozen(meeting.scheduledAt)) {
        return reply.code(403).send({ error: MEETING_FROZEN_ERROR, message: MEETING_FROZEN_MESSAGE })
      }

      // Parse multipart
      let fileBuffer: Buffer | null = null
      let originalFileName = ''
      let mimeType = ''
      const fields: Record<string, string> = {}

      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.mimetype !== 'application/pdf') {
            return reply.code(400).send({ error: 'Invalid File', message: 'Apenas arquivos PDF são aceitos.' })
          }
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk as Buffer)
          fileBuffer = Buffer.concat(chunks)
          originalFileName = part.filename
          mimeType = part.mimetype
        } else {
          fields[part.fieldname] = part.value as string
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.code(400).send({ error: 'Missing File', message: 'Nenhum arquivo enviado.' })
      }

      if (fileBuffer.length > MAX_FILE_SIZE) {
        return reply.code(400).send({ error: 'File Too Large', message: 'Tamanho máximo permitido: 50 MB.' })
      }

      const parsed = uploadFieldsSchema.safeParse(fields)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation Error', issues: parsed.error.issues })
      }

      const { title, documentType } = parsed.data

      // Compute SHA-256 server-side — client hash is never trusted
      const sha256Hash = computeSha256(fileBuffer)

      const ext = path.extname(originalFileName) || '.pdf'

      // Grava em disco local — ver storage.service.ts
      const fileKey = await saveFile(fileBuffer, {
        organizationId,
        scope: 'councils',
        originalName: originalFileName,
      })

      // Persist record
      const document = await prisma.councilDocument.create({
        data: {
          organizationId,
          meetingId,
          uploadedById: userId,
          documentType,
          title:         title ?? originalFileName.replace(ext, ''),
          fileKey,
          fileName:      originalFileName,
          fileSize:      fileBuffer.length,
          mimeType,
          sha256Hash,
        },
      })

      return reply.code(201).send(document)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Upload Failed', message: (err as Error).message })
    }
  },

  async download(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, meetingId, docId } = docDetailParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, orgFilter)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const document = await prisma.councilDocument.findFirst({
        where: { id: docId, meetingId, ...orgFilter },
      })
      if (!document) return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado.' })

      const url = getFileUrl(document.fileKey)

      return reply.send({ url, fileName: document.fileName, sha256Hash: document.sha256Hash })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Download Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, meetingId, docId } = docDetailParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, orgFilter)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const document = await prisma.councilDocument.findFirst({
        where: { id: docId, meetingId, ...orgFilter },
      })
      if (!document) return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado.' })

      // Mesma trava do upload: sem isso, o congelamento seria contornável
      // apagando a ata e reanexando outra.
      if (isMeetingFrozen(meeting.scheduledAt)) {
        return reply.code(403).send({ error: MEETING_FROZEN_ERROR, message: MEETING_FROZEN_MESSAGE })
      }

      // Apaga do disco primeiro — se falhar, o registro no banco permanece intacto
      try {
        await deleteFile(document.fileKey)
      } catch (fsErr) {
        request.log.warn({ fsErr, fileKey: document.fileKey }, 'Failed to delete council document from disk')
      }

      await prisma.councilDocument.delete({ where: { id: docId } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Document Failed', message: (err as Error).message })
    }
  },
}
