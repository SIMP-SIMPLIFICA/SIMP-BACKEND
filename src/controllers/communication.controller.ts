import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { CreateMessageInput, UpdateMessageInput } from '@/schemas/communication.schemas'
import { notificationService } from '@/services/notification.service'
import fs from 'node:fs'
import path from 'node:path'

export class CommunicationController {
  private getUserId(request: FastifyRequest): string {
    const user = request.user as any
    const userId = user.id || user.sub
    if (!userId) throw new Error('ID do usuário não encontrado no token')
    return userId
  }

  async create(request: FastifyRequest<{ Body: CreateMessageInput }>, reply: FastifyReply) {
    try {
      const { subject, body, recipients, attachments } = request.body
      const userId = this.getUserId(request)

      const message = await prisma.communicationDocument.create({
        data: {
          title: subject,
          content: body,
          status: 'SENT',
          sentAt: new Date(),
          createdBy: userId,
          recipients: {
            create: recipients
              .filter(r => r.userId !== userId)
              .map(r => ({
                userId: r.userId,
                role: r.role,
                canView: true
              }))
          },
          attachments: {
            create: attachments?.map(att => ({
              fileName: att.fileName,
              fileUrl: att.fileUrl,
              fileType: att.fileType,
              fileSize: att.fileSize
            })) ?? []
          }
        },
        include: {
          recipients: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } }
            }
          },
          attachments: true
        }
      })

      // Notify recipients
      const recipientIds = recipients.filter(r => r.userId !== userId).map(r => r.userId)
      if (recipientIds.length > 0) {
        const distinctIds = [...new Set(recipientIds)] as string[]
        await notificationService.notifyMany(distinctIds, {
          title: 'Nova Mensagem',
          message: `Você recebeu uma nova mensagem: ${subject}`,
          type: 'DOCUMENT_RECEIVED',
          link: `/communication/${message.id}`
        }).catch(err => request.log.error({ err }, 'Falha ao enviar notificações'))
      }

      return reply.code(201).send(message)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'Erro ao criar mensagem', error })
    }
  }

  async listInbox(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { startDate, endDate, personId } = request.query as any

    const where: any = {
      recipients: { some: { userId } },
      status: { in: ['SENT', 'READ', 'ARCHIVED'] }
    }

    if (startDate && endDate) {
      where.sentAt = { gte: new Date(startDate), lte: new Date(endDate) }
    }
    if (personId) where.createdBy = personId

    const messages = await prisma.communicationDocument.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        id: true, title: true, status: true, sentAt: true,
        creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        recipients: { where: { userId }, select: { readAt: true } }
      }
    })

    return reply.send(messages.map(m => ({
      ...m,
      isRead: !!m.recipients[0]?.readAt
    })))
  }

  async listSent(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { startDate, endDate, personId } = request.query as any

    const where: any = {
      createdBy: userId,
      status: { not: 'DRAFT' }
    }

    if (startDate && endDate) {
      where.sentAt = { gte: new Date(startDate), lte: new Date(endDate) }
    }
    if (personId) where.recipients = { some: { userId: personId } }

    const messages = await prisma.communicationDocument.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        id: true, title: true, status: true, sentAt: true,
        recipients: {
          select: {
            userId: true, role: true, readAt: true,
            user: { select: { id: true, firstName: true, lastName: true, avatar: true } }
          }
        }
      }
    })

    return reply.send(messages)
  }

  async getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const message = await prisma.communicationDocument.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
        attachments: true,
        recipients: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } }
          }
        }
      }
    })

    if (!message) return reply.code(404).send({ message: 'Mensagem não encontrada' })

    const isCreator = message.createdBy === userId
    const recipientRecord = message.recipients.find(r => r.userId === userId)

    if (!isCreator && !recipientRecord) {
      return reply.code(403).send({ message: 'Sem permissão para visualizar esta mensagem' })
    }

    // Mark as read
    if (recipientRecord && !recipientRecord.readAt) {
      await prisma.documentRecipient.update({
        where: { id: recipientRecord.id },
        data: { readAt: new Date() }
      })

      await notificationService.notify({
        userId: message.createdBy,
        title: 'Mensagem Lida',
        message: `${(request.user as any)?.username || 'Um usuário'} leu sua mensagem: ${message.title}`,
        type: 'DOCUMENT_VIEWED',
        link: `/communication/${message.id}`
      }).catch(err => request.log.error({ err }, 'Falha ao notificar leitura'))
    }

    return reply.send({ ...message, isCreator, isRecipient: !!recipientRecord })
  }

  async update(request: FastifyRequest<{ Params: { id: string }, Body: UpdateMessageInput }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)
    const data = request.body as any

    const existing = await prisma.communicationDocument.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Mensagem não encontrada' })
    if (existing.createdBy !== userId) return reply.code(403).send({ message: 'Apenas o criador pode editar' })
    if (existing.status !== 'DRAFT') return reply.code(400).send({ message: 'Apenas rascunhos podem ser editados' })

    const { recipients, attachments, subject, body, ...rest } = data

    const updated = await prisma.communicationDocument.update({
      where: { id },
      data: {
        ...(subject ? { title: subject } : {}),
        ...(body ? { content: body } : {}),
        ...rest,
        recipients: recipients ? {
          deleteMany: {},
          create: recipients.map((r: any) => ({ userId: r.userId, role: r.role, canView: true }))
        } : undefined,
        attachments: attachments?.length ? {
          deleteMany: {},
          create: attachments.map((a: any) => ({
            fileName: a.fileName, fileUrl: a.fileUrl, fileType: a.fileType, fileSize: a.fileSize
          }))
        } : undefined
      }
    })

    return reply.send(updated)
  }

  async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const existing = await prisma.communicationDocument.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Mensagem não encontrada' })
    if (existing.createdBy !== userId) return reply.code(403).send({ message: 'Apenas o criador pode excluir' })
    if (existing.status !== 'DRAFT') return reply.code(400).send({ message: 'Apenas rascunhos podem ser excluídos' })

    await prisma.communicationDocument.delete({ where: { id } })
    return reply.code(204).send()
  }

  async getRecipients(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { search } = request.query as { search?: string }

    const where: any = {
      isActive: true,
      id: { not: userId }
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } }
      ]
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, username: true, firstName: true, lastName: true,
        email: true, avatar: true,
        roles: { select: { role: { select: { displayName: true } } } }
      },
      orderBy: { firstName: 'asc' },
      take: 20
    })

    return reply.send(users.map(u => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      username: u.username,
      email: u.email,
      avatar: u.avatar,
      role: u.roles[0]?.role?.displayName || 'Usuário'
    })))
  }

  async downloadAttachment(request: FastifyRequest<{ Params: { id: string, attachmentId: string } }>, reply: FastifyReply) {
    const { id, attachmentId } = request.params
    const userId = this.getUserId(request)

    const message = await prisma.communicationDocument.findUnique({
      where: { id },
      include: { recipients: true }
    })

    if (!message) return reply.code(404).send({ message: 'Mensagem não encontrada' })

    const isCreator = message.createdBy === userId
    const isRecipient = message.recipients.some(r => r.userId === userId)
    if (!isCreator && !isRecipient) return reply.code(403).send({ message: 'Sem permissão para baixar este anexo' })

    const attachment = await prisma.communicationAttachment.findFirst({
      where: { id: attachmentId, documentId: id }
    })

    if (!attachment) return reply.code(404).send({ message: 'Anexo não encontrado' })

    const fileUrl = attachment.fileUrl.startsWith('/') ? attachment.fileUrl.slice(1) : attachment.fileUrl
    const filePath = path.resolve(process.cwd(), fileUrl)

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ message: 'Arquivo não encontrado no servidor' })
    }

    reply.header('Content-Disposition', `attachment; filename="${attachment.fileName}"`)
    reply.header('Content-Type', attachment.fileType)
    return reply.send(fs.createReadStream(filePath))
  }
}
