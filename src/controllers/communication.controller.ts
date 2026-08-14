import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { CreateMessageInput, UpdateMessageInput } from '@/schemas/communication.schemas'
import { notificationService } from '@/services/notification.service'
import { saveFile, getFileUrl } from '@/services/storage.service.js'

export class CommunicationController {
  private getUserId(request: FastifyRequest): string {
    const user = request.user as any
    const userId = user.id || user.sub
    if (!userId) throw new Error('ID do usuário não encontrado no token')
    return userId
  }

  /**
   * Resolve o filtro de organização de forma fail-closed: super admin vê tudo,
   * usuário comum precisa ter organizationId presente ou a requisição é rejeitada
   * (nunca cai para "sem filtro" por engano). Retorna `null` quando já respondeu 403.
   */
  private getOrgFilter(
    request: FastifyRequest,
    reply: FastifyReply
  ): { organizationId: string } | Record<string, never> | null {
    const user = request.user as any
    if (user.isSuperAdmin) return {}

    if (!user.organizationId) {
      reply.code(403).send({ message: 'Usuário sem organização associada.' })
      return null
    }

    return { organizationId: user.organizationId as string }
  }

  async create(request: FastifyRequest<{ Body: CreateMessageInput }>, reply: FastifyReply) {
    try {
      const { subject, body, recipients, attachments } = request.body
      const userId = this.getUserId(request)
      const organizationId = request.user.organizationId

      // Validar que todos os destinatários pertencem à mesma org (non-superAdmin)
      if (!request.user.isSuperAdmin && organizationId && recipients?.length) {
        const recipientUserIds = recipients.filter(r => r.userId !== userId).map(r => r.userId)
        if (recipientUserIds.length > 0) {
          const validCount = await prisma.user.count({
            where: { id: { in: recipientUserIds }, organizationId }
          })
          if (validCount !== recipientUserIds.length) {
            return reply.code(403).send({ message: 'Um ou mais destinatários não pertencem a esta organização.' })
          }
        }
      }

      const message = await prisma.communicationDocument.create({
        data: {
          title: subject,
          content: body,
          status: 'SENT',
          sentAt: new Date(),
          createdBy: userId,
          organizationId,
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
        const senderFirstName = request.user['firstName'] as string | undefined ?? ''
        const senderLastName = request.user['lastName'] as string | undefined ?? ''
        const senderName = `${senderFirstName} ${senderLastName}`.trim() || undefined

        await notificationService.notifyMany(distinctIds, {
          title: 'Nova Mensagem',
          message: `Você recebeu uma nova mensagem: ${subject}`,
          type: 'DOCUMENT_RECEIVED',
          link: `/communication?msgId=${message.id}`,
          entityId: message.id,
          senderName,
          messageSubject: subject,
          messageBody: body,
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

    const orgFilter = this.getOrgFilter(request, reply)
    if (orgFilter === null) return

    const where: any = {
      recipients: { some: { userId } },
      status: { in: ['SENT', 'READ', 'ARCHIVED'] },
      ...orgFilter
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

    const orgFilter = this.getOrgFilter(request, reply)
    if (orgFilter === null) return

    const where: any = {
      createdBy: userId,
      status: { not: 'DRAFT' },
      ...orgFilter
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

    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const message = await prisma.communicationDocument.findFirst({
      where: { id, ...orgFilter },
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
        link: `/communication/${message.id}`,
        entityId: message.id,
      }).catch(err => request.log.error({ err }, 'Falha ao notificar leitura'))
    }

    return reply.send({ ...message, isCreator, isRecipient: !!recipientRecord })
  }

  async update(request: FastifyRequest<{ Params: { id: string }, Body: UpdateMessageInput }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)
    const data = request.body as any

    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const existing = await prisma.communicationDocument.findFirst({ where: { id, ...orgFilter } })
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

    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const existing = await prisma.communicationDocument.findFirst({ where: { id, ...orgFilter } })
    if (!existing) return reply.code(404).send({ message: 'Mensagem não encontrada' })
    if (existing.createdBy !== userId) return reply.code(403).send({ message: 'Apenas o criador pode excluir' })
    if (existing.status !== 'DRAFT') return reply.code(400).send({ message: 'Apenas rascunhos podem ser excluídos' })

    await prisma.communicationDocument.delete({ where: { id } })
    return reply.code(204).send()
  }

  async getRecipients(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { search } = request.query as { search?: string }

    const orgFilter = this.getOrgFilter(request, reply)
    if (orgFilter === null) return

    const where: any = {
      isActive: true,
      id: { not: userId },
      ...orgFilter
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

  async uploadAttachment(request: FastifyRequest, reply: FastifyReply) {
    try {
      const orgId = (request.user as any).organizationId as string | null

      const data = await request.file()
      if (!data) return reply.code(400).send({ message: 'Nenhum arquivo enviado' })

      const allowedMimeTypes = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv'
      ]
      if (!allowedMimeTypes.includes(data.mimetype)) {
        return reply.code(400).send({ message: 'Tipo de arquivo não permitido.' })
      }

      const buffer = await data.toBuffer()

      if (buffer.length > 10 * 1024 * 1024) {
        return reply.code(400).send({ message: 'Arquivo muito grande. O limite é 10MB.' })
      }

      // fileUrl passa a guardar o fileKey completo (antes guardava só o nome, e a
      // chave era remontada no download) — evita duplicar a convenção de caminho.
      const fileKey = await saveFile(buffer, {
        organizationId: orgId,
        scope: 'communication',
        originalName: data.filename,
      })

      return reply.code(201).send({
        fileName: data.filename,
        fileUrl: fileKey,
        fileType: data.mimetype,
        fileSize: buffer.length
      })
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'Erro ao fazer upload do arquivo' })
    }
  }

  async downloadAttachment(request: FastifyRequest<{ Params: { id: string, attachmentId: string } }>, reply: FastifyReply) {
    const { id, attachmentId } = request.params
    const userId = this.getUserId(request)

    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const message = await prisma.communicationDocument.findFirst({
      where: { id, ...orgFilter },
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

    const url = getFileUrl(attachment.fileUrl)

    return reply.send({ url, fileName: attachment.fileName, fileType: attachment.fileType })
  }
}
