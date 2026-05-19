import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { CouncilMemberRole } from '@prisma/client'

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

const createCouncilSchema = z.object({
  name:        z.string().min(3).max(300),
  acronym:     z.string().min(1).max(20).optional(),
  description: z.string().max(2000).optional(),
  legalBasis:  z.string().max(500).optional(),
})

const updateCouncilSchema = createCouncilSchema.partial().extend({
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
  search:   z.string().optional(),
  isActive: z.coerce.boolean().optional(),
})

const addMemberSchema = z.object({
  userId:    z.string().min(1),
  role:      z.nativeEnum(CouncilMemberRole).default(CouncilMemberRole.MEMBRO_TITULAR),
  startDate: z.coerce.date().optional(),
  endDate:   z.coerce.date().optional(),
})

const updateMemberSchema = z.object({
  role:      z.nativeEnum(CouncilMemberRole).optional(),
  startDate: z.coerce.date().optional(),
  endDate:   z.coerce.date().optional(),
  isActive:  z.boolean().optional(),
})

const idParamSchema         = z.object({ id: z.string().min(1) })
const membershipParamSchema = z.object({ id: z.string().min(1), membershipId: z.string().min(1) })

// ─── Controller ───────────────────────────────────────────────────────────────

export const councilController = {

  // ─── Conselhos ──────────────────────────────────────────────────────────────

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const query = listQuerySchema.parse(request.query)

      const where: Record<string, unknown> = { organizationId }
      if (query.isActive !== undefined) where.isActive = query.isActive
      if (query.search) {
        where.OR = [
          { name:    { contains: query.search, mode: 'insensitive' } },
          { acronym: { contains: query.search, mode: 'insensitive' } },
        ]
      }

      const [data, total] = await Promise.all([
        prisma.council.findMany({
          where,
          orderBy: { name: 'asc' },
          skip:  (query.page - 1) * query.limit,
          take:  query.limit,
          include: {
            _count: { select: { memberships: { where: { isActive: true } } } },
          },
        }),
        prisma.council.count({ where }),
      ])

      return reply.send({
        data,
        meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
      })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Failed', message: (err as Error).message })
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const body = createCouncilSchema.parse(request.body)

      if (body.acronym) {
        const existing = await prisma.council.findUnique({
          where: { organizationId_acronym: { organizationId, acronym: body.acronym } },
        })
        if (existing) {
          return reply.code(409).send({ error: 'Conflict', message: 'Já existe um conselho com esta sigla.' })
        }
      }

      const council = await prisma.council.create({
        data: {
          organizationId,
          name:        body.name,
          acronym:     body.acronym     ?? null,
          description: body.description ?? null,
          legalBasis:  body.legalBasis  ?? null,
        },
      })

      return reply.code(201).send(council)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (err as Error).message })
    }
  },

  async get(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParamSchema.parse(request.params)

      const council = await prisma.council.findFirst({
        where: { id, organizationId },
        include: {
          memberships: {
            where: { isActive: true },
            include: { user: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } } },
            orderBy: { role: 'asc' },
          },
          meetings: {
            where: { status: { in: ['AGENDADA', 'EM_ANDAMENTO'] } },
            orderBy: { scheduledAt: 'asc' },
            take: 5,
          },
        },
      })

      if (!council) return reply.code(404).send({ error: 'Not Found' })

      return reply.send(council)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Get Failed', message: (err as Error).message })
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParamSchema.parse(request.params)
      const body = updateCouncilSchema.parse(request.body)

      const existing = await prisma.council.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      if (body.acronym && body.acronym !== existing.acronym) {
        const conflict = await prisma.council.findUnique({
          where: { organizationId_acronym: { organizationId, acronym: body.acronym } },
        })
        if (conflict) {
          return reply.code(409).send({ error: 'Conflict', message: 'Já existe um conselho com esta sigla.' })
        }
      }

      const updated = await prisma.council.update({ where: { id }, data: body })
      return reply.send(updated)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParamSchema.parse(request.params)

      const existing = await prisma.council.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      // Soft delete — preserva histórico de reuniões e atas
      await prisma.council.update({ where: { id }, data: { isActive: false } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Failed', message: (err as Error).message })
    }
  },

  // ─── Membros ────────────────────────────────────────────────────────────────

  async listMembers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id: councilId } = idParamSchema.parse(request.params)

      const council = await prisma.council.findFirst({ where: { id: councilId, organizationId } })
      if (!council) return reply.code(404).send({ error: 'Not Found' })

      const members = await prisma.councilMembership.findMany({
        where: { councilId, organizationId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, avatar: true } },
        },
        orderBy: [{ isActive: 'desc' }, { role: 'asc' }],
      })

      return reply.send({ data: members })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Members Failed', message: (err as Error).message })
    }
  },

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id: councilId } = idParamSchema.parse(request.params)
      const body = addMemberSchema.parse(request.body)

      const [council, user] = await Promise.all([
        prisma.council.findFirst({ where: { id: councilId, organizationId } }),
        prisma.user.findFirst({ where: { id: body.userId, organizationId } }),
      ])
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })
      if (!user)    return reply.code(404).send({ error: 'Not Found', message: 'Usuário não encontrado nesta organização.' })

      const existing = await prisma.councilMembership.findUnique({
        where: { councilId_userId_role: { councilId, userId: body.userId, role: body.role } },
      })
      if (existing) {
        return reply.code(409).send({ error: 'Conflict', message: 'Este usuário já possui este cargo neste conselho.' })
      }

      const membership = await prisma.councilMembership.create({
        data: {
          organizationId,
          councilId,
          userId:    body.userId,
          role:      body.role,
          startDate: body.startDate ?? null,
          endDate:   body.endDate ?? null,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      })

      return reply.code(201).send(membership)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Add Member Failed', message: (err as Error).message })
    }
  },

  async updateMember(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id: councilId, membershipId } = membershipParamSchema.parse(request.params)
      const body = updateMemberSchema.parse(request.body)

      const membership = await prisma.councilMembership.findFirst({
        where: { id: membershipId, councilId, organizationId },
      })
      if (!membership) return reply.code(404).send({ error: 'Not Found' })

      const updated = await prisma.councilMembership.update({
        where: { id: membershipId },
        data:  body,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      })

      return reply.send(updated)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Member Failed', message: (err as Error).message })
    }
  },

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id: councilId, membershipId } = membershipParamSchema.parse(request.params)

      const membership = await prisma.councilMembership.findFirst({
        where: { id: membershipId, councilId, organizationId },
      })
      if (!membership) return reply.code(404).send({ error: 'Not Found' })

      await prisma.councilMembership.delete({ where: { id: membershipId } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Member Failed', message: (err as Error).message })
    }
  },
}
