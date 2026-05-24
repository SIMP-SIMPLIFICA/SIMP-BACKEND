import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { SupportStatus, SupportType, Prisma } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestUser {
  user: {
    id: string
    organizationId: string | null
    isSuperAdmin: boolean
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const createSchema = z.object({
  type:    z.nativeEnum(SupportType),
  subject: z.string().min(1).max(255).optional(),
  message: z.string().min(1),
})

const listQuerySchema = z.object({
  status: z.nativeEnum(SupportStatus).optional(),
  type:   z.nativeEnum(SupportType).optional(),
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
})

const addMessageSchema = z.object({
  content: z.string().min(1),
})

const updateStatusSchema = z.object({
  status: z.nativeEnum(SupportStatus),
})

const idParamSchema = z.object({
  id: z.string().min(1),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SENDER_SELECT = {
  id: true, firstName: true, lastName: true, avatar: true,
} as const

// ─── Controller ───────────────────────────────────────────────────────────────

export const supportController = {

  // POST /support — cria o ticket/chat e a primeira mensagem atomicamente
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id: authorId, organizationId, isSuperAdmin } = (request as unknown as RequestUser).user

      if (isSuperAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'SuperAdmins não abrem chamados de suporte.' })
      }

      if (!organizationId) {
        return reply.code(422).send({ error: 'Missing Org', message: 'Usuário sem organização não pode abrir chamados.' })
      }

      const body = createSchema.parse(request.body)

      if (body.type === SupportType.TICKET && !body.subject) {
        return reply.code(400).send({ error: 'Validation Error', message: 'subject é obrigatório para tickets.' })
      }

      const supportRequest = await prisma.$transaction(async (tx) => {
        const req = await tx.supportRequest.create({
          data: { authorId, organizationId: organizationId!, type: body.type, subject: body.subject ?? null },
        })
        await tx.supportMessage.create({
          data: { requestId: req.id, senderId: authorId, content: body.message },
        })
        return req
      })

      return reply.code(201).send(supportRequest)
    } catch (err) {
      request.log.error(err)
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (err as Error).message })
    }
  },

  // GET /support — superAdmin vê tudo; usuário vê apenas seus próprios
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id: userId, organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const query = listQuerySchema.parse(request.query)

      if (!isSuperAdmin && !organizationId) {
        return reply.code(422).send({ error: 'Missing Org', message: 'Usuário sem organização não pode listar chamados.' })
      }

      const where: Prisma.SupportRequestWhereInput = isSuperAdmin
        ? {}
        : { authorId: userId, organizationId: organizationId! }

      if (query.status) where.status = query.status
      if (query.type)   where.type   = query.type

      const page  = Number(query.page)
      const limit = Number(query.limit)
      const skip  = (page - 1) * limit

      const [total, items] = await prisma.$transaction([
        prisma.supportRequest.count({ where }),
        prisma.supportRequest.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
          include: {
            author:   { select: SENDER_SELECT },
            _count:   { select: { messages: true } },
          },
        }),
      ])

      return reply.send({
        data: items,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      })
    } catch (err) {
      request.log.error(err)
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Failed', message: (err as Error).message })
    }
  },

  // GET /support/:id/messages — 403 se usuário comum tentar acessar ticket alheio
  async getMessages(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id: userId, organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { id } = idParamSchema.parse(request.params)

      const supportRequest = await prisma.supportRequest.findUnique({ where: { id } })
      if (!supportRequest) return reply.code(404).send({ error: 'Not Found' })

      if (!isSuperAdmin && (supportRequest.authorId !== userId || supportRequest.organizationId !== organizationId)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Acesso negado.' })
      }

      // Admin lendo: marca mensagens do usuário como lidas
      if (isSuperAdmin) {
        await prisma.supportMessage.updateMany({
          where: { requestId: id, isRead: false, senderId: { not: userId } },
          data:  { isRead: true },
        })
      }

      const messages = await prisma.supportMessage.findMany({
        where:   { requestId: id },
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: SENDER_SELECT } },
      })

      return reply.send({ data: messages, request: supportRequest })
    } catch (err) {
      request.log.error(err)
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Get Messages Failed', message: (err as Error).message })
    }
  },

  // POST /support/:id/messages — 403 se usuário comum tentar responder ticket alheio
  async addMessage(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id: senderId, organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { id } = idParamSchema.parse(request.params)
      const body = addMessageSchema.parse(request.body)

      const supportRequest = await prisma.supportRequest.findUnique({ where: { id } })
      if (!supportRequest) return reply.code(404).send({ error: 'Not Found' })

      if (!isSuperAdmin && (supportRequest.authorId !== senderId || supportRequest.organizationId !== organizationId)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Acesso negado.' })
      }

      if (supportRequest.status === SupportStatus.CLOSED) {
        return reply.code(422).send({ error: 'Ticket Closed', message: 'Este ticket está encerrado e não aceita mais mensagens.' })
      }

      // Admin respondendo pela primeira vez: avança status OPEN → IN_PROGRESS
      const shouldAdvance = isSuperAdmin && supportRequest.status === SupportStatus.OPEN

      const message = await prisma.$transaction(async (tx) => {
        const msg = await tx.supportMessage.create({
          data:    { requestId: id, senderId, content: body.content },
          include: { sender: { select: SENDER_SELECT } },
        })
        if (shouldAdvance) {
          await tx.supportRequest.update({
            where: { id },
            data:  { status: SupportStatus.IN_PROGRESS },
          })
        }
        return msg
      })

      return reply.code(201).send(message)
    } catch (err) {
      request.log.error(err)
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Add Message Failed', message: (err as Error).message })
    }
  },

  // GET /support/insights — superAdmin exclusivo
  async insights(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { isSuperAdmin } = (request as unknown as RequestUser).user

      if (!isSuperAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Apenas superAdmins podem ver insights.' })
      }

      const [byStatus, byType] = await Promise.all([
        prisma.supportRequest.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.supportRequest.groupBy({ by: ['type'],   _count: { _all: true } }),
      ])

      return reply.send({
        byStatus: byStatus.map(r => ({ status: r.status, count: r._count._all })),
        byType:   byType.map(r => ({ type: r.type,       count: r._count._all })),
      })
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({ error: 'Insights Failed', message: (err as Error).message })
    }
  },

  // PATCH /support/:id/status — superAdmin exclusivo
  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { isSuperAdmin } = (request as unknown as RequestUser).user

      if (!isSuperAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Apenas superAdmins podem alterar o status.' })
      }

      const { id } = idParamSchema.parse(request.params)
      const body = updateStatusSchema.parse(request.body)

      const existing = await prisma.supportRequest.findUnique({ where: { id } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      const updated = await prisma.supportRequest.update({
        where: { id },
        data:  { status: body.status },
      })

      return reply.send(updated)
    } catch (err) {
      request.log.error(err)
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Status Failed', message: (err as Error).message })
    }
  },
}
