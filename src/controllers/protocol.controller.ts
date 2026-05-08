import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { OfficialDocumentCategory, OfficialDocumentNumberingType, OfficialDocumentStatus } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestUser {
  user: {
    id: string
    organizationId: string
    isSuperAdmin: boolean
    permissions?: string[]
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const generateSchema = z.object({
  documentCategory: z.nativeEnum(OfficialDocumentCategory),
  documentType:     z.string().min(1).max(100),
  numberingType:    z.nativeEnum(OfficialDocumentNumberingType).default('SEQUENTIAL'),
  subject:          z.string().min(1).max(500),
  recipient:        z.string().max(300).optional(),
  sector:           z.string().min(1).max(100),
})

const updateStatusSchema = z.object({
  status:            z.enum(['EMITIDO', 'CANCELADO']),
  cancelReason:      z.string().min(1).optional(),
  libraryDocumentId: z.string().uuid().optional(),
})

const listQuerySchema = z.object({
  page:             z.coerce.number().int().positive().default(1),
  limit:            z.coerce.number().int().positive().max(100).default(20),
  search:           z.string().optional(),
  documentCategory: z.nativeEnum(OfficialDocumentCategory).optional(),
  documentType:     z.string().optional(),
  sector:           z.string().optional(),
  status:           z.nativeEnum(OfficialDocumentStatus).optional(),
  year:             z.coerce.number().int().optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentYear() {
  return new Date().getFullYear()
}

function formatNumber(n: number): string {
  return String(n).padStart(3, '0')
}

function buildFormattedNumber(
  documentType: string,
  sequenceNumber: number | null,
  year: number,
  sector: string,
  category: OfficialDocumentCategory,
): string {
  const type = documentType.toUpperCase()
  if (sequenceNumber !== null) {
    const num = formatNumber(sequenceNumber)
    if (category === OfficialDocumentCategory.NORMATIVO || sector === 'CENTRAL') {
      return `${type} Nº ${num}/${year}`
    }
    return `${type} Nº ${num}/${year} - ${sector.toUpperCase()}`
  }
  // RANDOM: 6 hex chars = 16M+ possibilidades, sem colisão previsível
  const ref = randomBytes(3).toString('hex').toUpperCase()
  if (category === OfficialDocumentCategory.NORMATIVO || sector === 'CENTRAL') {
    return `${type} Nº ${ref}/${year}`
  }
  return `${type} Nº ${ref}/${year} - ${sector.toUpperCase()}`
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const protocolController = {

  async generate(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: creatorId } = (request as unknown as RequestUser).user
      const body = generateSchema.parse(request.body)
      const year = currentYear()

      // Normativos: sector sempre CENTRAL (centralizado por org+ano)
      // Para COMUNICACAO: usar o código do departamento enviado pelo cliente
      const effectiveSector =
        body.documentCategory === OfficialDocumentCategory.NORMATIVO
          ? 'CENTRAL'
          : body.sector.trim().toUpperCase()

      if (body.documentCategory !== OfficialDocumentCategory.NORMATIVO && !effectiveSector) {
        return reply.code(400).send({ error: 'Validation Error', message: 'sector é obrigatório para documentos de comunicação' })
      }

      let sequenceNumber: number | null = null

      if (body.numberingType === OfficialDocumentNumberingType.SEQUENTIAL) {
        // Upsert atômico com SELECT FOR UPDATE via Prisma $transaction para serializar
        // escritas concorrentes no mesmo setor/tipo/ano
        const result = await prisma.$transaction(async (tx) => {
          // Tenta inserir; em conflito incrementa — PostgreSQL executa como operação única
          const control = await tx.sequenceControl.upsert({
            where: {
              organizationId_documentCategory_documentType_sector_year: {
                organizationId,
                documentCategory: body.documentCategory,
                documentType:     body.documentType,
                sector:           effectiveSector,
                year,
              },
            },
            create: {
              organizationId,
              documentCategory: body.documentCategory,
              documentType:     body.documentType,
              sector:           effectiveSector,
              year,
              currentNumber:    1,
            },
            update: {
              currentNumber: { increment: 1 },
            },
          })
          return control
        }, { isolationLevel: 'Serializable' })
        sequenceNumber = result.currentNumber
      }

      const formattedNumber = buildFormattedNumber(
        body.documentType,
        sequenceNumber,
        year,
        effectiveSector,
        body.documentCategory,
      )

      const doc = await prisma.officialDocument.create({
        data: {
          organizationId,
          creatorId,
          documentCategory: body.documentCategory,
          documentType:     body.documentType,
          numberingType:    body.numberingType,
          sequenceNumber,
          year,
          formattedNumber,
          subject:          body.subject,
          recipient:        body.recipient ?? null,
          sector:           effectiveSector,
          status:           OfficialDocumentStatus.RESERVADO,
        },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
      })

      return reply.code(201).send(doc)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      const message = err instanceof Error ? err.message : 'Erro interno'
      return reply.code(500).send({ error: 'Generate Failed', message })
    }
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId, isSuperAdmin, permissions } = (request as unknown as RequestUser).user
      const query = listQuerySchema.parse(request.query)

      const hasAdmin = permissions?.includes('protocols:admin') || isSuperAdmin

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organizationId }
      if (query.documentCategory) where.documentCategory = query.documentCategory
      if (query.documentType)     where.documentType     = query.documentType
      if (query.status)           where.status           = query.status
      if (query.year)             where.year             = query.year
      if (query.sector)           where.sector           = query.sector

      if (!hasAdmin) {
        // Regra de "caixa compartilhada do setor": usuários não-admin veem todos
        // os documentos do próprio setor (departamento), não apenas os que criaram.
        // Se o usuário não pertence a nenhum departamento, vê apenas os próprios.
        const userRecord = await prisma.user.findUnique({
          where: { id: userId },
          select: { departments: { take: 1, select: { code: true } } },
        })
        const deptCode = userRecord?.departments[0]?.code
        if (deptCode) {
          where.sector = deptCode.toUpperCase()
        } else {
          where.creatorId = userId
        }
      }

      // Full-text search on formattedNumber and subject
      if (query.search) {
        where.OR = [
          { formattedNumber: { contains: query.search, mode: 'insensitive' } },
          { subject:         { contains: query.search, mode: 'insensitive' } },
        ]
      }

      const [data, total] = await Promise.all([
        prisma.officialDocument.findMany({
          where,
          orderBy: [{ year: 'desc' }, { sequenceNumber: 'desc' }, { createdAt: 'desc' }],
          skip:  (query.page - 1) * query.limit,
          take:  query.limit,
          include: { creator: { select: { id: true, firstName: true, lastName: true } } },
        }),
        prisma.officialDocument.count({ where }),
      ])

      return reply.send({
        data,
        meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
      })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      const message = err instanceof Error ? err.message : 'Erro interno'
      return reply.code(500).send({ error: 'List Failed', message })
    }
  },

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const body = updateStatusSchema.parse(request.body)

      const existing = await prisma.officialDocument.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      const hasAdmin = (request as unknown as { user: { permissions?: string[] } })
        .user.permissions?.includes('protocols:admin') || isSuperAdmin
      const isCreator = existing.creatorId === (request as unknown as RequestUser).user.id
      // Admin: qualquer mudança. Criador: pode EMITIR ou CANCELAR o próprio. Outros: bloqueado.
      if (!hasAdmin && !isCreator) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Apenas o criador ou um administrador pode alterar o status deste documento.' })
      }

      const updated = await prisma.officialDocument.update({
        where: { id },
        data: {
          status:            body.status as OfficialDocumentStatus,
          cancelReason:      body.status === 'CANCELADO' ? (body.cancelReason ?? null) : null,
          libraryDocumentId: body.libraryDocumentId ?? undefined,
        },
      })

      return reply.send(updated)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Failed', message: (err as Error).message })
    }
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const userId = (request as unknown as RequestUser).user.id
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

      const existing = await prisma.officialDocument.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      const hasAdmin = (request as unknown as { user: { permissions?: string[] } }).user.permissions?.includes('protocols:admin') || isSuperAdmin
      const isCreator = existing.creatorId === userId

      if (!hasAdmin && !isCreator) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Apenas o criador ou um administrador pode excluir este documento.' })
      }

      if (existing.status !== OfficialDocumentStatus.RESERVADO) {
        return reply.code(422).send({ error: 'Unprocessable', message: 'Apenas documentos com status RESERVADO podem ser excluídos.' })
      }

      await prisma.officialDocument.delete({ where: { id } })
      return reply.code(204).send()
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Delete Failed', message: (err as Error).message })
    }
  },

  async getSequences(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const year = z.object({ year: z.coerce.number().int().optional() }).parse(request.query).year ?? currentYear()

      const sequences = await prisma.sequenceControl.findMany({
        where: { organizationId, year },
        orderBy: [{ documentCategory: 'asc' }, { documentType: 'asc' }, { sector: 'asc' }],
      })

      return reply.send(sequences)
    } catch (err: unknown) {
      return reply.code(500).send({ error: 'Query Failed', message: (err as Error).message })
    }
  },
}
