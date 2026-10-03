import type { FastifyReply, FastifyRequest } from 'fastify'
import { protocolReportService } from '@/services/protocol-report.service.js'
import { buildProtocolVisibilityFilter } from '@/utils/protocol-access.util.js'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { OfficialDocumentCategory, OfficialDocumentNumberingType, OfficialDocumentStatus, Prisma } from '@prisma/client'

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

export const DUPLICATE_NORMATIVO_MESSAGE = 'Já tem outra lei/documento com esse numero existente.'

const generateSchema = z.object({
  documentCategory: z.nativeEnum(OfficialDocumentCategory),
  documentType:     z.string().min(1).max(100),
  numberingType:    z.nativeEnum(OfficialDocumentNumberingType).default('SEQUENTIAL'),
  subject:          z.string().min(1).max(500),
  recipient:        z.string().max(300).optional(),
  // COMUNICACAO: departmentId obrigatório. NORMATIVO: omitir (salvo como null).
  // Department.id usa nanoid, não uuid — .uuid() rejeitaria todo departamento real.
  departmentId:     z.string().min(1).optional(),
  // NORMATIVO: número e ano informados manualmente pelo usuário — a numeração oficial
  // vem do processo legislativo, externa ao sistema. z.coerce.number() normaliza
  // "007" → 7, impedindo duplicata por diferença de formatação.
  sequenceNumber:   z.coerce.number().int().positive().optional(),
  year:             z.coerce.number().int().min(1900).max(2200).optional(),
}).refine(
  data => data.documentCategory !== OfficialDocumentCategory.NORMATIVO
    || (data.sequenceNumber !== undefined && data.year !== undefined),
  { message: 'Número e ano são obrigatórios para Ato Normativo.', path: ['sequenceNumber'] },
)

const updateStatusSchema = z.object({
  status:            z.enum(['EMITIDO', 'CANCELADO']),
  cancelReason:      z.string().min(1).optional(),
  // LibraryDocument.id usa nanoid, não uuid — .uuid() rejeitava todo anexo real com
  // 400 Bad Request. Mesma classe de bug que já ocorrera com departmentId.
  libraryDocumentId: z.string().min(1).optional(),
})

const reportQuerySchema = z.object({
  startDate:        z.coerce.date().optional(),
  endDate:          z.coerce.date().optional(),
  documentCategory: z.nativeEnum(OfficialDocumentCategory).optional(),
  // `type` é o nome do parâmetro na especificação; internamente o campo do
  // modelo chama documentType.
  type:             z.string().optional(),
}).refine(q => !q.startDate || !q.endDate || q.startDate <= q.endDate, {
  message: 'A data inicial não pode ser posterior à data final.',
  path: ['startDate'],
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
  month:            z.coerce.number().int().min(1).max(12).optional(),
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
    if (category === OfficialDocumentCategory.NORMATIVO) {
      return `${type} Nº ${num}/${year}`
    }
    return `${type} Nº ${num}/${year} - ${sector.toUpperCase()}`
  }
  // RANDOM: 6 hex chars — nunca usado em normativos
  const ref = randomBytes(3).toString('hex').toUpperCase()
  return `${type} Nº ${ref}/${year} - ${sector.toUpperCase()}`
}

/**
 * Retenta uma transação Serializable até `maxAttempts` vezes quando o Postgres
 * rejeita por conflito de serialização (Prisma P2034) — cenário esperado sob
 * concorrência real no upsert de SequenceControl, não um erro de programação.
 */
async function withSerializableRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isSerializationConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
      if (!isSerializationConflict || attempt === maxAttempts) throw err
    }
  }
  // Inalcançável: o loop sempre retorna ou lança na última tentativa.
  throw new Error('withSerializableRetry: falha inesperada')
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const protocolController = {

  async generate(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: creatorId } = (request as unknown as RequestUser).user
      const body = generateSchema.parse(request.body)

      const isNormativo = body.documentCategory === OfficialDocumentCategory.NORMATIVO

      // Normativo: ano informado pelo usuário (o ato pode ser de exercício anterior).
      // Comunicação: ano corrente, definido pelo sistema.
      const year = isNormativo ? body.year : currentYear()

      // Normativos: sector = 'CENTRAL', departmentId = null, numeração MANUAL
      let effectiveSector: string
      let resolvedDepartmentId: string | null = null

      if (isNormativo) {
        effectiveSector = 'CENTRAL'
        // O número vem do usuário, não de uma sequência do sistema
        body.numberingType = OfficialDocumentNumberingType.MANUAL
      } else {
        // COMUNICACAO: departmentId é obrigatório
        if (!body.departmentId) {
          return reply.code(400).send({ error: 'Validation Error', message: 'departmentId é obrigatório para documentos de comunicação' })
        }
        const dept = await prisma.department.findFirst({
          where: { id: body.departmentId, organizationId },
          select: { id: true, code: true },
        })
        if (!dept) {
          return reply.code(404).send({ error: 'Not Found', message: 'Departamento não encontrado nesta organização' })
        }
        effectiveSector = dept.code.toUpperCase()
        resolvedDepartmentId = dept.id
      }

      let sequenceNumber: number | null = null

      if (isNormativo) {
        // Numeração manual: o número vem do usuário. Checagem prévia para devolver a
        // mensagem de negócio; a garantia real sob concorrência é o índice único
        // parcial no banco, tratado no catch do create abaixo.
        sequenceNumber = body.sequenceNumber!

        const duplicate = await prisma.officialDocument.findFirst({
          where: {
            organizationId,
            documentCategory: OfficialDocumentCategory.NORMATIVO,
            documentType:     body.documentType,
            sequenceNumber,
            year,
          },
          select: { id: true },
        })
        if (duplicate) {
          return reply.code(409).send({ error: 'Conflict', message: DUPLICATE_NORMATIVO_MESSAGE })
        }
      } else if (body.numberingType === OfficialDocumentNumberingType.SEQUENTIAL) {
        // Upsert atômico com transação Serializable para evitar race condition.
        // Sob concorrência real, o Postgres pode rejeitar com P2034 (conflito de
        // serialização) — retenta em vez de propagar como erro 500 opaco.
        const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
          return tx.sequenceControl.upsert({
            where: {
              organizationId_sector_documentType_year: {
                organizationId,
                sector:       effectiveSector,
                documentType: body.documentType,
                year,
              },
            },
            create: {
              organizationId,
              documentCategory: body.documentCategory,
              documentType:     body.documentType,
              sector:           effectiveSector,
              departmentId:     resolvedDepartmentId,
              year,
              currentNumber:    1,
            },
            update: {
              currentNumber: { increment: 1 },
            },
          })
        }, { isolationLevel: 'Serializable' }))
        sequenceNumber = result.currentNumber
      }

      const formattedNumber = buildFormattedNumber(
        body.documentType,
        sequenceNumber,
        year,
        effectiveSector,
        body.documentCategory,
      )

      let doc
      try {
        doc = await prisma.officialDocument.create({
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
            departmentId:     resolvedDepartmentId,
            status:           OfficialDocumentStatus.RESERVADO,
          },
          include: {
            creator: { select: { id: true, firstName: true, lastName: true } },
          },
        })
      } catch (err) {
        // Índice único parcial (ver prisma/sql/001-unique-normativo-number.sql):
        // fecha a janela de corrida entre a checagem acima e este insert. Traduzido
        // para a mesma mensagem de negócio — o usuário nunca vê o erro técnico.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(409).send({ error: 'Conflict', message: DUPLICATE_NORMATIVO_MESSAGE })
        }
        throw err
      }

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

      const effectiveYear = query.year ?? currentYear()

      // Regra de visibilidade compartilhada com o relatório — ver
      // utils/protocol-access.util.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = await buildProtocolVisibilityFilter({
        organizationId,
        userId,
        isSuperAdmin,
        permissions,
      })
      if (query.documentCategory) where.documentCategory = query.documentCategory
      if (query.documentType)     where.documentType     = query.documentType
      if (query.status)           where.status           = query.status
      if (query.year)             where.year             = query.year
      if (query.sector)           where.sector           = query.sector

      // Filtro de mês (server-side range em createdAt)
      if (query.month) {
        const start = new Date(effectiveYear, query.month - 1, 1)
        const end   = new Date(effectiveYear, query.month, 1)
        where.createdAt = { gte: start, lt: end }
      }

      if (query.search) {
        // AND, e NÃO `where.OR = ...`: a atribuição direta sobrescrevia a
        // restrição de departamento montada acima, e um usuário comum que
        // buscasse passava a enxergar documentos de outros setores.
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { formattedNumber: { contains: query.search, mode: 'insensitive' } },
              { subject:         { contains: query.search, mode: 'insensitive' } },
            ],
          },
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

      const orgFilter = isSuperAdmin ? {} : { organizationId }
      const existing = await prisma.officialDocument.findFirst({ where: { id, ...orgFilter } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      const hasAdmin = (request as unknown as { user: { permissions?: string[] } })
        .user.permissions?.includes('protocols:admin') || isSuperAdmin
      const isCreator = existing.creatorId === (request as unknown as RequestUser).user.id

      if (!hasAdmin && !isCreator) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Apenas o criador ou um administrador pode alterar o status deste documento.' })
      }

      if (body.status === 'CANCELADO' && !body.cancelReason) {
        return reply.code(400).send({ error: 'Validation Error', message: 'cancelReason é obrigatório ao cancelar um documento.' })
      }

      const updated = await prisma.officialDocument.update({
        where: { id },
        data: {
          status:            body.status,
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

      const orgFilter = isSuperAdmin ? {} : { organizationId }
      const existing = await prisma.officialDocument.findFirst({ where: { id, ...orgFilter } })
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

  /**
   * GET /api/v1/protocols/report — relatório em PDF.
   *
   * Responde com o binário do PDF. O registro para validação pública acontece
   * dentro do serviço, então o arquivo entregue já é conferível pelo QR Code.
   */
  async report(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId, isSuperAdmin, permissions } = (request as unknown as RequestUser).user
      const query = reportQuerySchema.parse(request.query)

      const { bytes, publicId } = await protocolReportService.generate(
        {
          startDate: query.startDate,
          endDate: query.endDate,
          documentCategory: query.documentCategory,
          documentType: query.type,
        },
        { organizationId, userId, isSuperAdmin, permissions },
      )

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="relatorio-protocolos-${publicId}.pdf"`)
        .send(Buffer.from(bytes))
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: err.issues })
      }
      request.log.error(err, 'Falha ao gerar relatório de protocolos')
      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível gerar o relatório.',
      })
    }
  },

  async getSequences(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const orgFilter = isSuperAdmin ? {} : { organizationId }
      const year = z.object({ year: z.coerce.number().int().optional() }).parse(request.query).year ?? currentYear()

      const sequences = await prisma.sequenceControl.findMany({
        where: { ...orgFilter, year },
        orderBy: [{ documentCategory: 'asc' }, { documentType: 'asc' }, { sector: 'asc' }],
      })

      return reply.send(sequences)
    } catch (err: unknown) {
      return reply.code(500).send({ error: 'Query Failed', message: (err as Error).message })
    }
  },
}
