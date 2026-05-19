import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { prisma } from '@/lib/prisma.js'
import r2 from '@/lib/r2.js'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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

async function resolveCouncil(councilId: string, organizationId: string) {
  return prisma.council.findFirst({ where: { id: councilId, organizationId } })
}

async function resolveMeeting(meetingId: string, councilId: string, organizationId: string) {
  return prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, organizationId } })
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
      const { organizationId } = (request as unknown as RequestUser).user
      const { councilId, meetingId } = docParam.parse(request.params)

      const council = await resolveCouncil(councilId, organizationId)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, organizationId)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const documents = await prisma.councilDocument.findMany({
        where: { meetingId, organizationId },
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
      const { organizationId, id: userId } = (request as unknown as RequestUser).user
      const { councilId, meetingId } = docParam.parse(request.params)

      const council = await resolveCouncil(councilId, organizationId)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, organizationId)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

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

      // Build unique R2 key
      const ext       = path.extname(originalFileName) || '.pdf'
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
      const fileKey    = `organizations/${organizationId}/councils/${uniqueName}`

      // Upload to R2
      await r2.send(new PutObjectCommand({
        Bucket:      process.env.R2_BUCKET_NAME,
        Key:         fileKey,
        Body:        fileBuffer,
        ContentType: mimeType,
      }))

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
      const { organizationId } = (request as unknown as RequestUser).user
      const { councilId, meetingId, docId } = docDetailParam.parse(request.params)

      const council = await resolveCouncil(councilId, organizationId)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, organizationId)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const document = await prisma.councilDocument.findFirst({
        where: { id: docId, meetingId, organizationId },
      })
      if (!document) return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado.' })

      const url = await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: document.fileKey }),
        { expiresIn: 300 },
      )

      return reply.send({ url, fileName: document.fileName, sha256Hash: document.sha256Hash })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Download Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { councilId, meetingId, docId } = docDetailParam.parse(request.params)

      const council = await resolveCouncil(councilId, organizationId)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await resolveMeeting(meetingId, councilId, organizationId)
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const document = await prisma.councilDocument.findFirst({
        where: { id: docId, meetingId, organizationId },
      })
      if (!document) return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado.' })

      // Delete from R2 first — if it fails we leave DB record intact
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: document.fileKey }))
      } catch (r2Err) {
        request.log.warn({ r2Err, fileKey: document.fileKey }, 'Failed to delete council document from R2')
      }

      await prisma.councilDocument.delete({ where: { id: docId } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Document Failed', message: (err as Error).message })
    }
  },
}
