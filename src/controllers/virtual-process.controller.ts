import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma, db } from '@/utils/database.js'
import { logger } from '@/utils/logger.js'
import { z } from 'zod'
import { createVirtualProcessSchema, uploadDocumentSchema } from '@/schemas/virtual-process.schemas.js'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'virtual-processes')

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export class VirtualProcessController {
  async listProcesses(request: FastifyRequest, reply: FastifyReply) {
    try {
      const querySchema = z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(50),
        search: z.string().optional(),
        status: z.string().optional(),
      })

      const query = querySchema.parse(request.query)
      const where: any = {}

      if (query.search) {
        where.OR = [
          { processNumber: { contains: query.search, mode: 'insensitive' } },
          { subject: { contains: query.search, mode: 'insensitive' } },
          { secretaria: { contains: query.search, mode: 'insensitive' } },
          { category: { contains: query.search, mode: 'insensitive' } }
        ]
      }

      if (query.status) {
        where.status = query.status
      }

      const total = await prisma.virtualProcess.count({ where })
      const processes = await prisma.virtualProcess.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count: { select: { documents: true } }
        }
      })

      const paginatedResult = db.paginate(processes, query.page, query.limit, total)
      return reply.send(paginatedResult)
    } catch (error: any) {
      logger.error(error, 'Failed to list virtual processes')
      return reply.code(500).send({ error: 'Process Fetch Failed', message: error.message })
    }
  }

  async getProcessDetails(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const process = await prisma.virtualProcess.findUnique({
        where: { id },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
          documents: {
            include: {
              uploader: { select: { id: true, firstName: true, lastName: true } }
            },
            orderBy: { uploadedAt: 'desc' }
          }
        }
      })

      if (!process) {
        return reply.code(404).send({ error: 'Process Not Found', message: 'Processo não encontrado' })
      }

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'VISUALIZOU',
        resource: 'virtual_process',
        resourceId: id,
        ipAddress: request.ip,
        success: true
      })

      return reply.send(process)
    } catch (error: any) {
      logger.error(error, 'Failed to get virtual process details')
      return reply.code(500).send({ error: 'Process Fetch Failed', message: error.message })
    }
  }

  async createProcess(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createVirtualProcessSchema.parse(request.body)
      const userId = (request as any).user?.id as string

      const existingProcess = await prisma.virtualProcess.findUnique({
        where: { processNumber: data.processNumber }
      })

      if (existingProcess) {
        return reply.code(400).send({ error: 'Conflict', message: 'Número de processo já existe' })
      }

      const process = await prisma.virtualProcess.create({
        data: {
          processNumber: data.processNumber,
          secretaria: data.secretaria,
          source: data.source,
          sourceDetail: data.sourceDetail,
          bankAccount: data.bankAccount,
          agency: data.agency,
          bankName: data.bankName,
          subject: data.subject,
          category: data.category,
          createdById: userId,
          status: 'Tramitando'
        }
      })

      await db.createAuditLog({
        userId,
        action: 'AUTUOU',
        resource: 'virtual_process',
        resourceId: process.id,
        ipAddress: request.ip,
        success: true,
        newData: process
      })

      return reply.code(201).send(process)
    } catch (error: any) {
      logger.error(error, 'Failed to create virtual process')
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', details: error.errors })
      }
      return reply.code(500).send({ error: 'Process Creation Failed', message: error.message })
    }
  }

  async toggleStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { status } = z.object({ status: z.string().min(1) }).parse(request.body)

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const oldStatus = process.status
      const updatedProcess = await prisma.virtualProcess.update({
        where: { id },
        data: { status }
      })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'ALTEROU_STATUS',
        resource: 'virtual_process',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { status: oldStatus },
        newData: { status }
      })

      return reply.send(updatedProcess)
    } catch (error: any) {
      logger.error(error, 'Failed to update virtual process status')
      return reply.code(500).send({ error: 'Status Update Failed', message: error.message })
    }
  }

  async deleteProcess(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const process = await prisma.virtualProcess.findUnique({ where: { id } })

      if (!process) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      if ((Date.now() - process.createdAt.getTime()) > 24 * 60 * 60 * 1000) {
        return reply.code(403).send({ error: 'Forbidden', message: 'O prazo de 24 horas para exclusão expirou' })
      }

      await prisma.virtualProcess.delete({ where: { id } })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'EXCLUIU',
        resource: 'virtual_process',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: process
      })

      return reply.code(204).send()
    } catch (error: any) {
      logger.error(error, 'Failed to delete virtual process')
      return reply.code(500).send({ error: 'Process Deletion Failed', message: error.message })
    }
  }

  async uploadDocument(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const processObj = await prisma.virtualProcess.findUnique({ where: { id } })

      if (!processObj) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const parts = request.parts()
      let fileData: any = null
      let fieldsData: any = {}

      for await (const part of parts) {
        if (part.type === 'file') {
          const extension = path.extname(part.filename)
          const fileName = `${randomUUID()}${extension}`
          const filePath = path.join(UPLOAD_DIR, fileName)

          await pipeline(part.file, fs.createWriteStream(filePath))

          fileData = {
            fileName: part.filename,
            fileUrl: `/uploads/virtual-processes/${fileName}`,
            fileSize: (await fs.promises.stat(filePath)).size
          }
        } else {
          fieldsData[part.fieldname] = part.value
        }
      }

      if (!fileData) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Nenhum arquivo enviado' })
      }

      const validatedFields = uploadDocumentSchema.parse(fieldsData)

      const document = await prisma.virtualProcessDocument.create({
        data: {
          virtualProcessId: id,
          tag: validatedFields.tag,
          description: validatedFields.description,
          fileName: fileData.fileName,
          fileUrl: fileData.fileUrl,
          fileSize: fileData.fileSize,
          uploadedById: (request as any).user?.id
        }
      })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'ANEXOU_DOCUMENTO',
        resource: 'virtual_process_document',
        resourceId: document.id,
        ipAddress: request.ip,
        success: true,
        metadata: { processId: id, fileName: fileData.fileName }
      })

      return reply.code(201).send(document)
    } catch (error: any) {
      logger.error(error, 'Failed to upload document')
      return reply.code(500).send({ error: 'Upload Failed', message: error.message })
    }
  }

  async downloadDocument(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, documentId } = request.params as { id: string, documentId: string }

      const document = await prisma.virtualProcessDocument.findUnique({
        where: { id: documentId }
      })

      if (!document || document.virtualProcessId !== id) {
        return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado' })
      }

      const urlParts = document.fileUrl.split('/')
      const fileNameOnDisk = urlParts[urlParts.length - 1]
      const filePath = path.join(UPLOAD_DIR, fileNameOnDisk)

      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ error: 'Not Found', message: 'Arquivo não encontrado no servidor' })
      }

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'BAIXOU_DOCUMENTO',
        resource: 'virtual_process_document',
        resourceId: documentId,
        ipAddress: request.ip,
        success: true,
        metadata: { processId: id }
      })

      const stream = fs.createReadStream(filePath)
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(document.fileName)}"`)
      return reply.send(stream)
    } catch (error: any) {
      logger.error(error, 'Failed to download document')
      return reply.code(500).send({ error: 'Download Failed', message: error.message })
    }
  }
}

export const virtualProcessController = new VirtualProcessController()