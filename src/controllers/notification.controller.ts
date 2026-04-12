import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { notificationService } from '../services/notification.service.js'
import { z } from 'zod'

export class NotificationController {

  stream(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id

    const origin = request.headers.origin || '*'

    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true'
    }

    reply.hijack()
    reply.raw.writeHead(200, headers)
    reply.raw.write('retry: 10000\n\n')

    notificationService.addClient(userId, reply)
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.notification.count({
        where: { userId, read: false }
      })
    ])

    return reply.send({ data: notifications, unreadCount })
  }

  async markAsRead(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const userId = request.user.id

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true }
    })

    if (!notification) {
      return reply.code(404).send({ error: 'Notificação não encontrada' })
    }
    if (notification.userId !== userId) {
      return reply.code(403).send({ error: 'Sem permissão para acessar esta notificação' })
    }

    await prisma.notification.update({ where: { id }, data: { read: true } })

    return reply.send({ success: true })
  }

  async markAllRead(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id

    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    })

    return reply.send({ success: true })
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const userId = request.user.id

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true }
    })

    if (!notification) {
      return reply.code(404).send({ error: 'Notificação não encontrada' })
    }
    if (notification.userId !== userId) {
      return reply.code(403).send({ error: 'Sem permissão para acessar esta notificação' })
    }

    await prisma.notification.delete({ where: { id } })

    return reply.code(204).send()
  }

  async deleteAll(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id

    await prisma.notification.deleteMany({ where: { userId } })

    return reply.code(204).send()
  }

  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id

    const body = z.object({
      emailNotifications: z.boolean().optional(),
      autoClearDays: z.number().int().min(0).max(365).optional()
    }).parse(request.body)

    const updated = await prisma.user.update({
      where: { id: userId },
      data: body,
      select: { emailNotifications: true, autoClearDays: true }
    })

    return reply.send({ data: updated })
  }
}