import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as stream from 'node:stream'
import { deleteFile, getFilePath, getFileUrl, saveFile } from '@/services/storage.service.js'
import { logger } from '@/utils/logger.js'
import archiver from 'archiver'

const uploadFieldsSchema = z.object({
  title:       z.string().min(1).max(500).optional(),
  accessLevel: z.coerce.number().int().min(1).max(3).default(1),
  // Normaliza: string vazia, "null" e "undefined" (vindos do multipart) → undefined
  categoryId: z
    .string()
    .optional()
    .transform(v => (!v || v === 'null' || v === 'undefined' ? undefined : v)),
})

export class LibraryController {

  // POST /api/v1/library/upload
  async upload(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id
    const organizationId = request.user.organizationId

    if (!organizationId && !request.user.isSuperAdmin) {
      return reply.status(403).send({ message: 'Usuário sem organização' })
    }

    const parts = request.parts()

    let fileBuffer: Buffer | null = null
    let originalFileName = ''
    let mimeType = ''
    const fields: Record<string, string> = {}

    for await (const part of parts) {
      if (part.type === 'file') {
        // Aceita apenas PDF
        if (part.mimetype !== 'application/pdf') {
          return reply.status(400).send({ message: 'Apenas arquivos PDF são aceitos.' })
        }

        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer)
        }
        fileBuffer = Buffer.concat(chunks)
        originalFileName = part.filename
        mimeType = part.mimetype
      } else {
        fields[part.fieldname] = part.value as string
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado.' })
    }

    // Limite de 50 MB
    if (fileBuffer.length > 50 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Arquivo muito grande. Limite: 50 MB.' })
    }

    const parsed = uploadFieldsSchema.safeParse(fields)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Dados inválidos.',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
      })
    }

    const { title, accessLevel, categoryId } = parsed.data
    const covenantId = fields['covenantId'] && fields['covenantId'] !== 'null' && fields['covenantId'] !== 'undefined'
      ? fields['covenantId']
      : undefined
    const virtualProcessId = fields['virtualProcessId'] && fields['virtualProcessId'] !== 'null' && fields['virtualProcessId'] !== 'undefined'
      ? fields['virtualProcessId']
      : undefined
    const orgId = organizationId ?? 'global'

    // Vínculo documento→processo só é válido dentro do convênio de origem.
    // A interface já oferece apenas os processos corretos, mas interface não é
    // fronteira de segurança: um upload cruzado direto na API deve ser recusado.
    if (virtualProcessId) {
      if (!covenantId) {
        return reply.status(400).send({
          message: 'Só é possível vincular um documento a um processo no contexto de um convênio.'
        })
      }

      const link = await prisma.covenant.findFirst({
        where: {
          id: covenantId,
          organizationId: orgId,
          virtualProcesses: { some: { id: virtualProcessId } },
        },
        select: { id: true },
      })

      if (!link) {
        return reply.status(400).send({
          message: 'O processo informado não está vinculado a este convênio.'
        })
      }
    }

    const ext = path.extname(originalFileName) || '.pdf'

    // Grava em disco local (uploads/) — ver storage.service.ts
    const fileKey = await saveFile(fileBuffer, {
      organizationId: orgId,
      scope: 'library',
      originalName: originalFileName,
    })

    // Salva registro no banco
    const document = await prisma.libraryDocument.create({
      data: {
        title: title ?? originalFileName.replace(ext, ''),
        fileName: originalFileName,
        fileKey,
        fileSize: fileBuffer.length,
        mimeType,
        accessLevel,
        uploaderId: userId,
        organizationId: orgId,
        ...(categoryId  ? { categoryId }  : {}),
        ...(covenantId  ? { covenantId }  : {}),
        ...(virtualProcessId ? { virtualProcessId } : {}),
      }
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPLOAD',
        resource: 'LIBRARY_DOCUMENT',
        resourceId: document.id,
        ipAddress: request.ip,
        success: true,
        organizationId: orgId,
        metadata: { fileName: originalFileName, fileSize: fileBuffer.length, accessLevel }
      }
    })

    logger.info({ documentId: document.id }, 'Library document uploaded')

    return reply.status(201).send(document)
  }

  // GET /api/v1/library
  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id
    const clearanceLevel = (request.user as any).clearanceLevel as number ?? 1
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const { search, page, limit, categoryId, covenantId } = z.object({
      search:     z.string().optional(),
      categoryId: z.string().optional(),
      covenantId: z.string().optional(),
      page:  z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query)

    const where: any = {
      ...orgFilter,
      deletedAt: null,
      OR: [
        { accessLevel: { lte: clearanceLevel } },
        { uploaderId: userId }
      ]
    }

    if (categoryId)  where.categoryId  = categoryId
    if (covenantId)  where.covenantId  = covenantId

    if (search) {
      where.AND = [{
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { fileName: { contains: search, mode: 'insensitive' } },
          { textContent: { contains: search, mode: 'insensitive' } }
        ]
      }]
    }

    const [documents, total] = await Promise.all([
      prisma.libraryDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, title: true, fileName: true, fileSize: true,
          mimeType: true, accessLevel: true, createdAt: true,
          // Necessário para a aba Documentos do convênio agrupar por processo.
          virtualProcessId: true,
          uploader:  { select: { id: true, firstName: true, lastName: true, avatar: true } },
          category:  { select: { id: true, name: true } }
        }
      }),
      prisma.libraryDocument.count({ where })
    ])

    return reply.send({
      data: documents,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    })
  }

  // GET /api/v1/library/:id/download
  async download(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const userId = request.user.id
    const clearanceLevel = (request.user as any).clearanceLevel as number ?? 1
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const document = await prisma.libraryDocument.findFirst({
      where: { id, deletedAt: null, ...orgFilter }
    })

    if (!document) return reply.status(404).send({ message: 'Documento não encontrado.' })

    // Regra de acesso: nível de sigilo ou uploader
    const canAccess =
      request.user.isSuperAdmin ||
      document.uploaderId === userId ||
      document.accessLevel <= clearanceLevel

    if (!canAccess) {
      return reply.status(403).send({ message: 'Seu nível de acesso não permite visualizar este documento.' })
    }

    const url = getFileUrl(document.fileKey)

    // Audit log de acesso
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DOWNLOAD',
        resource: 'LIBRARY_DOCUMENT',
        resourceId: document.id,
        ipAddress: request.ip,
        success: true,
        organizationId: document.organizationId
      }
    })

    return reply.send({ url, fileName: document.fileName, fileSize: document.fileSize })
  }

  // DELETE /api/v1/library/:id (soft delete)
  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const userId = request.user.id
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const document = await prisma.libraryDocument.findFirst({
      where: { id, deletedAt: null, ...orgFilter }
    })

    if (!document) return reply.status(404).send({ message: 'Documento não encontrado.' })

    await prisma.libraryDocument.update({
      where: { id },
      data: { deletedAt: new Date() }
    })

    // Deleta fisicamente do disco — falha aqui não impede a exclusão do registro
    try {
      await deleteFile(document.fileKey)
    } catch (err) {
      logger.warn({ err, fileKey: document.fileKey }, 'Failed to delete library document from disk')
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        resource: 'LIBRARY_DOCUMENT',
        resourceId: document.id,
        ipAddress: request.ip,
        success: true,
        organizationId: document.organizationId
      }
    })

    return reply.status(204).send()
  }

  // GET /api/v1/library/logs (apenas quem tem library:logs)
  async logs(request: FastifyRequest, reply: FastifyReply) {
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const { page, limit } = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30)
    }).parse(request.query)

    const where = {
      resource: 'LIBRARY_DOCUMENT',
      ...orgFilter
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } }
      }),
      prisma.auditLog.count({ where })
    ])

    return reply.send({
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    })
  }
  // POST /api/v1/library/download-zip
  async downloadZip(request: FastifyRequest, reply: FastifyReply) {
    const { documentIds } = z.object({
      documentIds: z.array(z.string()).min(1).max(50)
    }).parse(request.body)

    const userId = request.user.id
    const clearanceLevel = (request.user as any).clearanceLevel as number ?? 1
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const documents = await prisma.libraryDocument.findMany({
      where: { id: { in: documentIds }, deletedAt: null, ...orgFilter },
      select: { id: true, fileName: true, fileKey: true, accessLevel: true, uploaderId: true, organizationId: true }
    })

    if (documents.length !== documentIds.length) {
      return reply.status(404).send({ message: 'Um ou mais documentos não foram encontrados.' })
    }

    // Verificação de segurança em lote
    const forbidden = documents.filter(doc => {
      if (request.user.isSuperAdmin) return false
      if (doc.uploaderId === userId) return false
      return doc.accessLevel > clearanceLevel
    })

    if (forbidden.length > 0) {
      return reply.status(403).send({ message: 'Sem permissão para acessar um ou mais documentos do lote.' })
    }

    const passThrough = new stream.PassThrough()
    const archive = archiver('zip', { zlib: { level: 5 } })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', 'attachment; filename="documentos-biblioteca.zip"')

    archive.pipe(passThrough)

    // Trabalho assíncrono em IIFE desacoplada — o handler retorna reply.send() imediatamente
    // sem suspender, evitando que o Fastify finalize a resposta prematuramente
    void (async () => {
      try {
        for (const doc of documents) {
          // path.basename() remove qualquer componente de diretório (../) do nome do arquivo
          // prevenindo Zip Slip — CodeQL js/zip-slip
          const safeName = path.basename(doc.fileName)
          archive.append(fs.createReadStream(getFilePath(doc.fileKey)), { name: safeName })
        }
        await archive.finalize()
      } catch (error) {
        console.error('Falha crítica ao montar ZIP em background:', error)
        logger.error({ error }, 'Error during ZIP generation')
        passThrough.destroy(error instanceof Error ? error : new Error('Erro no ZIP'))
      }
    })()

    // Audit log (fire-and-forget)
    prisma.auditLog.create({
      data: {
        userId,
        action: 'DOWNLOAD_ZIP',
        resource: 'LIBRARY_DOCUMENT',
        ipAddress: request.ip,
        success: true,
        organizationId: request.user.organizationId ?? 'global',
        metadata: { documentIds, count: documents.length }
      }
    }).catch(err => logger.warn({ err }, 'Failed to write ZIP audit log'))

    return reply.send(passThrough)
  }

  // GET /api/v1/library/categories
  async listCategories(request: FastifyRequest, reply: FastifyReply) {
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const categories = await prisma.documentCategory.findMany({
      where: orgFilter,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, createdAt: true }
    })
    return reply.send(categories)
  }

  // POST /api/v1/library/categories
  async createCategory(request: FastifyRequest, reply: FastifyReply) {
    const organizationId = request.user.organizationId
    if (!organizationId && !request.user.isSuperAdmin) {
      return reply.status(403).send({ message: 'Usuário sem organização' })
    }
    const { name } = z.object({ name: z.string().min(1).max(100).trim() }).parse(request.body)
    const orgId = organizationId ?? 'global'

    const existing = await prisma.documentCategory.findFirst({
      where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' } }
    })
    if (existing) return reply.status(409).send({ message: 'Categoria já existe.' })

    const category = await prisma.documentCategory.create({
      data: { name, organizationId: orgId },
      select: { id: true, name: true, createdAt: true }
    })
    return reply.status(201).send(category)
  }

  // DELETE /api/v1/library/categories/:id
  async deleteCategory(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

    const category = await prisma.documentCategory.findFirst({ where: { id, ...orgFilter } })
    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada.' })

    // Desvincula documentos (SetNull já trata no banco, mas garantimos aqui)
    await prisma.documentCategory.delete({ where: { id } })
    return reply.status(204).send()
  }
}

export const libraryController = new LibraryController()
