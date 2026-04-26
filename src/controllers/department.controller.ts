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
})

const listSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(200).default(20),
  search: z.string().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function orgId(request: FastifyRequest): string {
  return (request.user as { organizationId: string }).organizationId
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const departmentController = {

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = request.user as { organizationId: string }
      const query = listSchema.parse(request.query)

      const where = {
        organizationId,
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
          include: { _count: { select: { users: true } } },
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

      // Código único por organização
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
        include: { _count: { select: { users: true } } },
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

      const existing = await prisma.department.findFirst({
        where: { id, organizationId },
      })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      // Se está mudando o código, verificar unicidade
      if (body.code && body.code !== existing.code) {
        const conflict = await prisma.department.findFirst({
          where: { organizationId, code: body.code },
        })
        if (conflict) {
          return reply.code(409).send({ error: 'Conflict', message: `Já existe um departamento com o código "${body.code}".` })
        }
      }

      const updated = await prisma.department.update({
        where: { id },
        data: {
          ...(body.name        !== undefined ? { name: body.name }               : {}),
          ...(body.code        !== undefined ? { code: body.code }               : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive    !== undefined ? { isActive: body.isActive }       : {}),
        },
        include: { _count: { select: { users: true } } },
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
        include: { _count: { select: { users: true } } },
      })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      // Bloquear exclusão se há usuários vinculados
      if (existing._count.users > 0) {
        return reply.code(409).send({
          error:   'Conflict',
          message: `Este departamento possui ${existing._count.users} usuário(s) vinculado(s). Desvincule-os antes de excluir.`,
        })
      }

      // Bloquear exclusão se há protocolos vinculados ao setor
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
}
