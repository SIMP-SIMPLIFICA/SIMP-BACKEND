import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { CreateDocumentInput, UpdateDocumentInput } from '@/schemas/communication.schemas'
import { ProtocolService } from '@/services/protocol.service'
import { notificationService } from '@/services/notification.service'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { signatureService } from '@/services/signature.service'
import { documentService } from '@/services/document.service'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class CommunicationController {
  private getUserId(request: FastifyRequest): string {
    const user = request.user as any
    const userId = user.id || user.sub

    if (!userId) {
      throw new Error('ID do usuário não encontrado no token')
    }
    return userId
  }

  async create(request: FastifyRequest<{ Body: CreateDocumentInput }>, reply: FastifyReply) {
    try {
      const { title, documentNumber, content, documentType, priority, departmentId, recipients, attachments, metadata } = request.body as any
      const userId = this.getUserId(request)

      const document = await prisma.communicationDocument.create({
        data: {
          title,
          documentNumber,
          content, // Mantém o texto corrido para busca simples
          documentType,
          priority,
          status: 'DRAFT',
          createdBy: userId,
          departmentId,
          metadata: metadata || {}, // Salva o JSON com a lista de parágrafos estruturada
          recipients: {
            create: [
              // Adiciona APENAS os destinatários que vieram do payload, filtrados
              ...(recipients || [])
                .filter((r: any) => r.userId !== userId)
                .map((recipient: any) => ({
                  userId: recipient.userId,
                  // Mapeia SIGNER para TO, mantendo apenas TO/CC/BCC validos se existirem, mas priorizando TO conforme solicitado
                  // "Force SEMPRE: role: 'TO'"
                  role: 'TO',
                  canView: true,
                  // FORÇADO: Todo destinatário pode assinar (Regra de Negócio Atualizada)
                  canSign: true
                }))
            ]
          },
          attachments: {
            create: attachments?.map((att: any) => ({
              fileName: att.fileName,
              fileUrl: att.fileUrl,
              fileType: att.fileType,
              fileSize: att.fileSize
            }))
          }
        },
        include: {
          recipients: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          attachments: true
        }
      })

      if (recipients && recipients.length > 0) {
        try {
          const recipientIds = recipients.map((r: any) => r.userId)
          const distinctUserIds = [...new Set(recipientIds)] as string[]

          await notificationService.notifyMany(distinctUserIds, {
            title: 'Nova Comunicação Recebida',
            message: `Você recebeu uma nova comunicação: ${documentType} - ${title}`,
            type: 'DOCUMENT_RECEIVED',
            link: `/communication/${document.id}`
          })

        } catch (notifError) {
          request.log.error({ err: notifError }, 'Falha ao enviar notificações in-app')
        }
      }

      return reply.code(201).send(document)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'Erro ao criar documento', error })
    }
  }

  async listDrafts(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { type, startDate, endDate } = request.query as any

    const whereClause: any = {
      createdBy: userId,
      status: 'DRAFT'
    }

    if (type === 'MENSAGEM') {
      whereClause.documentType = 'MENSAGEM'
    } else if (type === 'DOCUMENTO') {
      whereClause.documentType = { not: 'MENSAGEM' }
    }

    if (startDate && endDate) {
      whereClause.createdAt = { gte: new Date(startDate), lte: new Date(endDate) }
    }

    const drafts = await prisma.communicationDocument.findMany({
      where: whereClause,
      orderBy: {
        updatedAt: 'desc'
      },
      take: 50,
      select: { id: true, title: true, documentType: true, status: true, updatedAt: true }
    })

    return reply.send(drafts)
  }

  async listReceived(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { type, startDate, endDate, personId } = request.query as any

    const whereClause: any = {
      recipients: {
        some: {
          userId: userId
        }
      },
      status: {
        in: ['SENT', 'READ', 'SIGNED', 'ARCHIVED']
      }
    }

    if (type === 'MENSAGEM') {
      whereClause.documentType = 'MENSAGEM'
    } else if (type === 'DOCUMENTO') {
      whereClause.documentType = { not: 'MENSAGEM' }
    }

    if (startDate && endDate) {
      whereClause.sentAt = { gte: new Date(startDate), lte: new Date(endDate) }
    }

    if (personId) {
      whereClause.createdBy = personId
    }

    const documents = await prisma.communicationDocument.findMany({
      where: whereClause,
      orderBy: {
        sentAt: 'desc'
      },
      take: 50,
      select: {
        id: true, title: true, documentType: true, documentNumber: true, protocolNumber: true, status: true, sentAt: true,
        creator: { select: { id: true, username: true, firstName: true, lastName: true } },
        recipients: { where: { userId: userId }, select: { readAt: true, signedAt: true } }
      }
    })

    const docsWithStatus = documents.map(doc => {
      const recipient = doc.recipients[0]
      let userStatus = 'PENDING'
      if (recipient?.signedAt) userStatus = 'SIGNED'
      else if (recipient?.readAt) userStatus = 'READ'

      return {
        ...doc,
        userStatus
      }
    })

    return reply.send(docsWithStatus)
  }

  async listSent(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)
    const { type, startDate, endDate, personId } = request.query as any

    const whereClause: any = {
      createdBy: userId,
      status: {
        not: 'DRAFT'
      }
    }

    if (type === 'MENSAGEM') {
      whereClause.documentType = 'MENSAGEM'
    } else if (type === 'DOCUMENTO') {
      whereClause.documentType = { not: 'MENSAGEM' }
    }

    if (startDate && endDate) {
      whereClause.sentAt = { gte: new Date(startDate), lte: new Date(endDate) }
    }

    if (personId) {
      whereClause.recipients = { some: { userId: personId } }
    }

    const documents = await prisma.communicationDocument.findMany({
      where: whereClause,
      orderBy: {
        sentAt: 'desc'
      },
      take: 50,
      select: {
        id: true, title: true, documentType: true, documentNumber: true, protocolNumber: true, status: true, sentAt: true,
        recipients: {
          select: {
            role: true, readAt: true, signedAt: true,
            user: { select: { id: true, firstName: true, lastName: true, avatar: true } }
          }
        }
      }
    })

    const docsWithStatus = documents.map(doc => {
      let aggregatedStatus = 'PENDING'

      if (doc.recipients.length > 0) {
        const allRead = doc.recipients.every(r => r.readAt)
        const allSigned = doc.recipients.every(r => r.signedAt)

        if (allSigned) aggregatedStatus = 'SIGNED'
        else if (allRead) aggregatedStatus = 'READ'
        else aggregatedStatus = 'WAITING'
      }

      return {
        ...doc,
        aggregatedStatus
      }
    })

    return reply.send(docsWithStatus)
  }

  async getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const document = await prisma.communicationDocument.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, firstName: true, lastName: true, jobTitle: true }
        },
        department: true,
        attachments: true,
        recipients: {
          include: {
            user: {
              select: { id: true, username: true, firstName: true, lastName: true, avatar: true, jobTitle: true }
            }
          }
        },
        signatures: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, roles: { select: { role: { select: { displayName: true } } } } }
            }
          }
        }
      }
    })

    if (!document) {
      return reply.code(404).send({ message: 'Documento não encontrado' })
    }

    const isCreator = document.createdBy === userId
    const recipientRecord = document.recipients.find(r => r.userId === userId)
    const isRecipient = !!recipientRecord

    if (!isCreator && !isRecipient) {
      return reply.code(403).send({ message: 'Sem permissão para visualizar este documento' })
    }

    if (isRecipient && recipientRecord) {
      const now = new Date()

      if (!recipientRecord.readAt) {
        await prisma.documentRecipient.update({
          where: { id: recipientRecord.id },
          data: {
            readAt: now,
            readIp: request.ip,
            readUserAgent: request.headers['user-agent']
          }
        })

        await notificationService.notify({
          userId: document.createdBy,
          title: 'Documento Visualizado',
          message: `${(request.user as any)?.username || 'Um usuário'} visualizou ${document.protocolNumber || document.title}`,
          type: 'DOCUMENT_VIEWED',
          link: `/communication/${document.id}`
        })
      }
    }

    const verificationData = {
      protocol: document.protocolNumber,
      hash: document.originalHash,
      url: `${process.env.APP_URL || 'https://simp-system.com'}/verify/${document.originalHash || ''}`,
      timestamp: document.sentAt,
      valid: !!document.originalHash
    }

    // AUDIT TRAIL
    const auditTrail: any[] = []

    if (document.createdAt) {
      auditTrail.push({
        event: 'CREATED',
        timestamp: document.createdAt,
        description: 'Documento criado',
        user: document.creator
      })
    }

    if (document.sentAt) {
      auditTrail.push({
        event: 'SENT',
        timestamp: document.sentAt,
        description: 'Documento protocolado e enviado',
        user: document.creator
      })
    }

    document.recipients.forEach((rec: any) => {
      if (rec.readAt) {
        auditTrail.push({
          event: 'READ',
          timestamp: rec.readAt,
          description: 'Documento visualizado',
          user: rec.user
        })
      }
      if (rec.signedAt) {
        auditTrail.push({
          event: 'SIGNED',
          timestamp: rec.signedAt,
          description: 'Documento assinado digitalmente',
          user: rec.user
        })
      }
    })

    auditTrail.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return reply.send({
      ...document,
      verification: verificationData,
      auditTrail
    })
  }

  async update(request: FastifyRequest<{ Params: { id: string }, Body: UpdateDocumentInput }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)
    const data = request.body as any

    const existingDoc = await prisma.communicationDocument.findUnique({
      where: { id }
    })

    if (!existingDoc) return reply.code(404).send({ message: 'Documento não encontrado' })
    if (existingDoc.createdBy !== userId) return reply.code(403).send({ message: 'Apenas o criador pode editar este rascunho' })
    if (existingDoc.status !== 'DRAFT') return reply.code(400).send({ message: 'Apenas rascunhos podem ser editados' })

    const { recipients, attachments, documentNumber, metadata, ...simpleData } = data

    const updatedDoc = await prisma.communicationDocument.update({
      where: { id },
      data: {
        ...simpleData,
        documentNumber,
        metadata: metadata || existingDoc.metadata || {},
        recipients: recipients ? {
          deleteMany: {},
          create: recipients.map((recipient: any) => ({
            userId: recipient.userId,
            role: recipient.role,
            canView: true,
            canSign: recipient.canSign
          }))
        } : undefined,
        attachments: attachments ? {
          deleteMany: {},
          create: attachments.map((att: any) => ({
            fileName: att.fileName,
            fileUrl: att.fileUrl,
            fileType: att.fileType,
            fileSize: att.fileSize
          }))
        } : undefined
      }
    })

    return reply.send(updatedDoc)
  }

  async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const existingDoc = await prisma.communicationDocument.findUnique({ where: { id } })

    if (!existingDoc) return reply.code(404).send({ message: 'Documento não encontrado' })
    if (existingDoc.createdBy !== userId) return reply.code(403).send({ message: 'Apenas o criador pode excluir este documento' })
    if (existingDoc.status !== 'DRAFT') return reply.code(400).send({ message: 'Apenas rascunhos podem ser excluídos' })

    await prisma.communicationDocument.delete({ where: { id } })
    return reply.code(204).send()
  }

  // --- MÉTODO SEND REESCRITO E CORRIGIDO (PDF + ASSINATURA DIGITAL) ---
  // --- MÉTODO SEND REESCRITO (AGORA DELEGADO AO SERVICE) ---
  async send(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    try {
      const result = await documentService.protocolAndSend(id, userId)

      // Auto-assinatura: Assina automaticamente o documento caso não seja MENSAGEM
      const doc = await prisma.communicationDocument.findUnique({ where: { id } })
      if (doc && doc.documentType !== 'MENSAGEM') {
        await documentService.sign(id, userId, request.ip)
      }

      return reply.send({
        message: 'Documento protocolado, gerado e enviado com sucesso!',
        protocol: result.protocol,
        hash: result.hash
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.code(400).send({ message: error.message || 'Erro ao enviar documento' })
    }
  }

  // --- NOVO MÉTODO SIGN ---
  async sign(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)
    const ipAddress = request.ip

    try {
      const result = await documentService.sign(id, userId, ipAddress)

      return reply.send(result)
    } catch (error: any) {
      request.log.error(error)
      return reply.code(400).send({ message: error.message || 'Erro ao assinar documento' })
    }
  }

  async getRecipients(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)

    const eligibleRoles = await prisma.role.findMany({
      where: {
        isActive: true,
        OR: [
          { permissions: { array_contains: ['documents:read'] } },
          { permissions: { array_contains: ['documents:manage'] } },
          { permissions: { array_contains: ['system:admin'] } },
          { isSystem: true, name: 'admin' }
        ]
      },
      select: { id: true }
    })

    const roleIds = eligibleRoles.map(r => r.id)

    const { search } = request.query as { search?: string }
    const userWhereClause: any = {
      isActive: true,
      roles: {
        some: {
          roleId: { in: roleIds }
        }
      },
      id: { not: userId }
    }

    if (search) {
      userWhereClause.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } }
      ]
    }

    const usersFull = await prisma.user.findMany({
      where: userWhereClause,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        roles: {
          select: {
            role: { select: { displayName: true, name: true } }
          }
        }
      },
      orderBy: { firstName: 'asc' },
      take: 20
    })

    const formattedUsers = usersFull.map(user => ({
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      role: user.roles[0]?.role?.displayName || 'Usuário'
    }))

    return reply.send(formattedUsers)
  }

  async downloadAttachment(request: FastifyRequest<{ Params: { id: string, attachmentId: string } }>, reply: FastifyReply) {
    const { id, attachmentId } = request.params
    const userId = this.getUserId(request)

    const document = await prisma.communicationDocument.findUnique({
      where: { id },
      include: {
        recipients: true
      }
    })

    if (!document) return reply.code(404).send({ message: 'Documento não encontrado' })

    const isCreator = document.createdBy === userId
    const isRecipient = document.recipients.some(r => r.userId === userId)

    if (!isCreator && !isRecipient) {
      return reply.code(403).send({ message: 'Sem permissão para baixar este anexo' })
    }

    const attachment = await prisma.communicationAttachment.findUnique({
      where: { id: attachmentId, documentId: id }
    })

    if (!attachment) return reply.code(404).send({ message: 'Anexo não encontrado' })

    const urlParts = attachment.fileUrl.split('/')
    const diskFileName = urlParts[urlParts.length - 1]

    const uploadDir = path.join(__dirname, '../../uploads')
    const filePath = path.join(uploadDir, diskFileName)

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ message: 'Arquivo físico não encontrado no servidor' })
    }

    reply.header('Content-Disposition', `attachment; filename="${attachment.fileName}"`)
    reply.header('Content-Type', attachment.fileType)

    const stream = fs.createReadStream(filePath)
    return reply.send(stream)
  }
}