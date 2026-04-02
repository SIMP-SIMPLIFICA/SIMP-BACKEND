import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  createVirtualProcessCategorySchema,
  updateVirtualProcessCategorySchema,
} from '../schemas/virtual-process.schemas.js'

export class VirtualProcessCategoryController {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessCategorySchema.parse(request.body)
    const userId = request.user.id

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: data.workspaceId, userId } },
    })
    if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' })

    const category = await prisma.virtualProcessCategory.create({
      data: { workspaceId: data.workspaceId, name: data.name },
    })

    return reply.status(201).send(category)
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params)
    const userId = request.user.id

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' })

    const categories = await prisma.virtualProcessCategory.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    })

    return reply.send(categories)
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessCategorySchema.parse(request.body)
    const userId = request.user.id

    const category = await prisma.virtualProcessCategory.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' })

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: category.workspaceId, userId } },
    })
    if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' })

    const updated = await prisma.virtualProcessCategory.update({ where: { id }, data })
    return reply.send(updated)
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const userId = request.user.id

    const category = await prisma.virtualProcessCategory.findUnique({ where: { id } })
    if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' })

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: category.workspaceId, userId } },
    })
    if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' })

    await prisma.virtualProcessCategory.delete({ where: { id } })
    return reply.status(204).send()
  }
}

export const virtualProcessCategoryController = new VirtualProcessCategoryController()
