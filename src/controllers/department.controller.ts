import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'

// ─── Validation ───────────────────────────────────────────────────────────────

const createSchema = z.object({
  name:        z.string().min(1).max(150).trim(),
  code:        z.string().min(1).max(20).trim().toUpperCase(),
  description: z.string().max(500).trim().optional(),
})

const updateSchema = z.object({
  name:        z.string().min(1).max(150).trim().optional(),
  code:        z.string().min(1).max(20).trim().toUpperCase().optional(),
  description: z.string().max(500).trim().nullable().optional(),
  isActive:    z.boolean().optional(),
  managerId:   z.string().nullable().optional(),
})

const listSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(200).default(20),
  search: z.string().optional(),
})

const addMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function orgId(request: FastifyRequest): string {
  return (request.user as { organizationId: string }).organizationId
}

const deptSelect = { _count: { select: { members: true } } } as const

// ─── Controller ───────────────────────────────────────────────────────────────

export const departmentController = {

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = request.user as { organizationId: string | null, isSuperAdmin: boolean }
      const query = listSchema.parse(request.query)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const where = {
        ...orgFilter,
        ...(query.search ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { code: { contains: query.search, mode: 'insensitive' as const } },
          ],
        } : {}),
      }

      const [data, total] = await Promise.all([
        prisma.department.findMany({
          where,
          orderBy: { name: 'asc' },
          skip:  (query.page - 1) * query.limit,
          take:  query.limit,
          include: {
            ...deptSelect,
            manager: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        prisma.department.count({ where }),
      ])

      return reply.send({
        data,
        meta: {
          total,
          page:       query.page,
          limit:      query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Failed', message: (err as Error).message })
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const body = createSchema.parse(request.body)

      if (body.code === 'CENTRAL') {
        return reply.code(422).send({ error: 'Unprocessable', message: 'O código "CENTRAL" é reservado pelo sistema para numeração de atos normativos. Escolha outro código.' })
      }

      const existing = await prisma.department.findFirst({
        where: { organizationId, code: body.code },
      })
      if (existing) {
        return reply.code(409).send({ error: 'Conflict', message: `Já existe um departamento com o código "${body.code}" nesta organização.` })
      }

      const department = await prisma.department.create({
        data: {
          organizationId,
          name:        body.name,
          code:        body.code,
          description: body.description ?? null,
          isActive:    true,
        },
        include: { ...deptSelect, manager: { select: { id: true, firstName: true, lastName: true } } },
      })

      return reply.code(201).send(department)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (err as Error).message })
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
      const body = updateSchema.parse(request.body)

      const existing = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      if (body.code && body.code !== existing.code) {
        if (body.code === 'CENTRAL') {
          return reply.code(422).send({ error: 'Unprocessable', message: 'O código "CENTRAL" é reservado pelo sistema para numeração de atos normativos.' })
        }
        const conflict = await prisma.department.findFirst({ where: { organizationId, code: body.code } })
        if (conflict) {
          return reply.code(409).send({ error: 'Conflict', message: `Já existe um departamento com o código "${body.code}".` })
        }
      }

      // Validar managerId: se fornecido, o usuário deve pertencer à org
      if (body.managerId) {
        const managerUser = await prisma.user.findFirst({
          where: { id: body.managerId, organizationId },
        })
        if (!managerUser) {
          return reply.code(400).send({ error: 'Bad Request', message: 'Usuário não encontrado nesta organização.' })
        }
      }

      const updated = await prisma.department.update({
        where: { id },
        data: {
          ...(body.name        !== undefined ? { name:        body.name }        : {}),
          ...(body.code        !== undefined ? { code:        body.code }        : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive    !== undefined ? { isActive:    body.isActive }    : {}),
          ...(body.managerId   !== undefined ? { managerId:   body.managerId }   : {}),
        },
        include: { ...deptSelect, manager: { select: { id: true, firstName: true, lastName: true } } },
      })

      return reply.send(updated)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

      const existing = await prisma.department.findFirst({
        where: { id, organizationId },
        include: { _count: { select: { members: true } } },
      })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      if (existing._count.members > 0) {
        return reply.code(409).send({
          error:   'Conflict',
          message: `Este departamento possui ${existing._count.members} usuário(s) vinculado(s). Desvincule-os antes de excluir.`,
        })
      }

      const protocolCount = await prisma.officialDocument.count({
        where: { organizationId, sector: existing.code },
      })
      if (protocolCount > 0) {
        return reply.code(409).send({
          error:   'Conflict',
          message: `Este departamento possui ${protocolCount} protocolo(s) emitido(s) com este código de setor. Não é possível excluí-lo.`,
        })
      }

      await prisma.department.delete({ where: { id } })
      return reply.send({ message: 'Departamento excluído com sucesso.' })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Delete Failed', message: (err as Error).message })
    }
  },

  // ─── Member endpoints ────────────────────────────────────────────────────────

  async listMembers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      const members = await prisma.user.findMany({
        where:   { departments: { some: { id } }, organizationId },
        select:  { id: true, firstName: true, lastName: true, email: true, avatar: true, username: true },
        orderBy: { firstName: 'asc' },
      })

      return reply.send(members)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Members Failed', message: (err as Error).message })
    }
  },

  async addMembers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
      const { userIds } = addMembersSchema.parse(request.body)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      const validUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, organizationId },
        select: { id: true },
      })
      await prisma.department.update({
        where: { id },
        data:  { members: { connect: validUsers.map(u => ({ id: u.id })) } },
      })

      return reply.send({ updated: validUsers.length })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Add Members Failed', message: (err as Error).message })
    }
  },

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id, userId } = z.object({ id: z.string().min(1), userId: z.string().min(1) }).parse(request.params)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      await prisma.department.update({
        where: { id },
        data:  { members: { disconnect: { id: userId } } },
      })

      if (dept.managerId === userId) {
        await prisma.department.update({ where: { id }, data: { managerId: null } })
      }

      return reply.send({ message: 'Membro removido do departamento.' })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Member Failed', message: (err as Error).message })
    }
  },
}
