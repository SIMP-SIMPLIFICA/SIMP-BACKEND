import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  createVirtualProcessCategorySchema,
  updateVirtualProcessCategorySchema,
} from '../schemas/virtual-process.schemas.js'
import { HARD_QUERY_CAP } from '@/constants/pagination.js'

export class VirtualProcessCategoryController {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessCategorySchema.parse(request.body)
    const organizationId = request.user.organizationId
    if (!organizationId && !request.user.isSuperAdmin) {
      return reply.status(403).send({ message: 'Usuário sem organização' })
    }
    const category = await prisma.virtualProcessCategory.create({
      data: { organizationId: organizationId, name: data.name },
    })
    return reply.status(201).send(category)
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const categories = await prisma.virtualProcessCategory.findMany({
      // Teto de memoria: esta listagem nao expoe paginacao ao cliente.
      take: HARD_QUERY_CAP,
      where: orgFilter,
      orderBy: { name: 'asc' },
    })
    return reply.send(categories)
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessCategorySchema.parse(request.body)

    const category = await prisma.virtualProcessCategory.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' })

    if (!request.user.isSuperAdmin && category.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Categoria não encontrada' })
    }

    const updated = await prisma.virtualProcessCategory.update({ where: { id }, data })
    return reply.send(updated)
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const category = await prisma.virtualProcessCategory.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' })

    if (!request.user.isSuperAdmin && category.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Categoria não encontrada' })
    }

    await prisma.virtualProcessCategory.delete({ where: { id } })
    return reply.status(204).send()
  }
}

export const virtualProcessCategoryController = new VirtualProcessCategoryController()
