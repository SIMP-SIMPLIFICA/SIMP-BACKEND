import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { CreateDocumentInput, UpdateDocumentInput } from '@/schemas/communication.schemas'
import { ProtocolService } from '@/services/protocol.service'
// import { emailService } from '@/services/email.service' // REMOVIDO
import { notificationService } from '@/services/notification.service'
import crypto from 'node:crypto'

export class CommunicationController {
  // HELPER PRIVADO: Extrai o ID do usuário de forma segura
  private getUserId(request: FastifyRequest): string {
    const user = request.user as any
    // Tenta ler .id, se não existir, tenta .sub (padrão JWT)
    const userId = user.id || user.sub

    if (!userId) {
      throw new Error('ID do usuário não encontrado no token')
    }
    return userId
  }

  async create(request: FastifyRequest<{ Body: CreateDocumentInput }>, reply: FastifyReply) {
    try {
      // Recebendo documentNumber do corpo da requisição
      const { title, documentNumber, content, documentType, priority, departmentId, recipients, sendEmailNotif } = request.body
      const userId = this.getUserId(request)

      const document = await prisma.communicationDocument.create({
        data: {
          title,
          documentNumber, // ATUALIZAÇÃO: Salvando o número oficial (ex: MEMORANDO Nº 01/2026)
          content,
          documentType,
          priority,
          status: 'DRAFT',
          createdBy: userId,
          departmentId,
          recipients: {
            create: recipients?.map(recipient => ({
              userId: recipient.userId,
              role: recipient.role,
              canView: true,
              canSign: false
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
          }
        }
      })

      // 3. (Novo) Enviar notificação in-app (substituindo e-mail)
      if (recipients && recipients.length > 0) {
        try {
          const recipientIds = recipients.map(r => r.userId)
          const distinctUserIds = [...new Set(recipientIds)]

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

    const drafts = await prisma.communicationDocument.findMany({
      where: {
        createdBy: userId,
        status: 'DRAFT'
      },
      orderBy: {
        updatedAt: 'desc'
      },
      include: {
        department: true,
        _count: {
          select: { recipients: true }
        }
      }
    })

    return reply.send(drafts)
  }

  // --- NOVOS MÉTODOS PARA LISTAGEM ---

  async listReceived(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)

    const documents = await prisma.communicationDocument.findMany({
      where: {
        recipients: {
          some: {
            userId: userId
          }
        },
        status: {
          in: ['SENT', 'READ', 'SIGNED', 'ARCHIVED'] // Não mostrar drafts de outros
        }
      },
      orderBy: {
        sentAt: 'desc'
      },
      include: {
        creator: {
          select: { id: true, username: true, firstName: true, lastName: true }
        },
        department: true,
        recipients: { // Include para saber status de leitura do próprio usuário
          where: { userId: userId },
          select: { readAt: true, signedAt: true }
        }
      }
    })

    return reply.send(documents)
  }

  async listSent(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)

    const documents = await prisma.communicationDocument.findMany({
      where: {
        createdBy: userId,
        status: {
          not: 'DRAFT'
        }
      },
      orderBy: {
        sentAt: 'desc'
      },
      include: {
        department: true,
        _count: {
          select: {
            recipients: true,
            signatures: true
          }
        }
      }
    })

    return reply.send(documents)
  }

  async getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const document = await prisma.communicationDocument.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, firstName: true, lastName: true }
        },
        department: true,
        recipients: {
          include: {
            user: {
              select: { id: true, username: true, firstName: true, lastName: true, avatar: true }
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

    // Validação de acesso: Criador ou Destinatário
    const isCreator = document.createdBy === userId
    const recipientRecord = document.recipients.find(r => r.userId === userId)
    const isRecipient = !!recipientRecord

    if (!isCreator && !isRecipient) {
      return reply.code(403).send({ message: 'Sem permissão para visualizar este documento' })
    }

    // --- AUTO-ASSINATURA E LEITURA ---
    if (isRecipient && recipientRecord) {
      const docWithSignatures = document as any
      const now = new Date()
      let updated = false

      // 1. Marca como LIDO se ainda não foi
      if (!recipientRecord.readAt) {
        await prisma.documentRecipient.update({
          where: { id: recipientRecord.id },
          data: {
            readAt: now,
            readIp: request.ip,
            readUserAgent: request.headers['user-agent']
          }
        })

        // Notifica leitura
        await notificationService.notify({
          userId: document.createdBy,
          title: 'Documento Visualizado',
          message: `${(request.user as any)?.username || 'Um usuário'} visualizou ${document.protocolNumber || document.title}`,
          type: 'DOCUMENT_VIEWED',
          link: `/communication/${document.id}`
        })

        updated = true
      }

      // 2. AUTO-ASSINATURA (Ao visualizar, assina automaticamente)
      // Verifica se já assinou
      const alreadySigned = docWithSignatures.signatures.some((s: any) => s.userId === userId)

      if (!alreadySigned) {
        // Cria assinatura
        await prisma.documentSignature.create({
          data: {
            documentId: document.id,
            userId: userId,
            signatureType: 'DIGITAL', // Pode ser alterado conforme regra
            ipAddress: request.ip,
            signedAt: now,
            isValid: true,
            certificateData: {
              userAgent: request.headers['user-agent'],
              autoSigned: true
            }
          }
        })

        // Atualiza recipient com signedAt
        await prisma.documentRecipient.update({
          where: { id: recipientRecord.id },
          data: { signedAt: now }
        })

        // Notifica assinatura
        await notificationService.notify({
          userId: document.createdBy,
          title: 'Documento Assinado',
          message: `${(request.user as any)?.username || 'Um usuário'} assinou o documento ${document.protocolNumber}`,
          type: 'DOCUMENT_SIGNED',
          link: `/communication/${document.id}`
        })

        updated = true
      }

      // Se houve atualizações, recarrega assinaturas para retornar atualizado
      if (updated) {
        const updatedSignatures = await prisma.documentSignature.findMany({
          where: { documentId: id },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } }
          }
        })
        docWithSignatures.signatures = updatedSignatures
      }
    }

    // --- DADOS DE VERIFICAÇÃO (STAMP) ---
    const verificationData = {
      protocol: document.protocolNumber,
      hash: document.originalHash,
      // URL pública para validação (ajustar conforme domínio real)
      url: `${process.env.APP_URL || 'https://simp-system.com'}/verify/${document.originalHash || ''}`,
      timestamp: document.sentAt,
      valid: !!document.originalHash
    }

    return reply.send({
      ...document,
      verification: verificationData
    })
  }

  async update(request: FastifyRequest<{ Params: { id: string }, Body: UpdateDocumentInput }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)
    const data = request.body

    const existingDoc = await prisma.communicationDocument.findUnique({
      where: { id }
    })

    if (!existingDoc) {
      return reply.code(404).send({ message: 'Documento não encontrado' })
    }

    if (existingDoc.createdBy !== userId) {
      return reply.code(403).send({ message: 'Apenas o criador pode editar este rascunho' })
    }

    if (existingDoc.status !== 'DRAFT') {
      return reply.code(400).send({ message: 'Apenas rascunhos podem ser editados' })
    }

    // Extrai documentNumber para garantir que ele seja atualizado
    const { recipients, documentNumber, ...simpleData } = data

    // Se houve alteração de recipients, precisamos tratar (remover/adicionar)
    // Por simplificação no rascunho, poderiamos deletar e recriar, mas o prisma update aninhado é chato
    // Vamos apenas atualizar os dados básicos por enquanto, assumindo que recipients não mudam no update simples ou tratando separado
    // TODO: Implementar atualização completa de recipients se necessário

    const updatedDoc = await prisma.communicationDocument.update({
      where: { id },
      data: {
        ...simpleData,
        documentNumber // Incluindo na query de update
      }
    })

    return reply.send(updatedDoc)
  }

  async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    const existingDoc = await prisma.communicationDocument.findUnique({
      where: { id }
    })

    if (!existingDoc) {
      return reply.code(404).send({ message: 'Documento não encontrado' })
    }

    if (existingDoc.createdBy !== userId) {
      return reply.code(403).send({ message: 'Apenas o criador pode excluir este documento' })
    }

    if (existingDoc.status !== 'DRAFT') {
      return reply.code(400).send({ message: 'Apenas rascunhos podem ser excluídos' })
    }

    await prisma.communicationDocument.delete({
      where: { id }
    })

    return reply.code(204).send()
  }

  async send(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = request.params
    const userId = this.getUserId(request)

    // 1. Busca o documento
    const document = await prisma.communicationDocument.findUnique({
      where: { id }
    })

    if (!document) {
      return reply.code(404).send({ message: 'Documento não encontrado' })
    }

    // 2. Validações
    if (document.createdBy !== userId) {
      return reply.code(403).send({ message: 'Apenas o criador pode enviar este documento' })
    }

    if (document.status !== 'DRAFT') {
      return reply.code(400).send({ message: 'Este documento já foi enviado ou finalizado.' })
    }

    // 3. Gera o Protocolo Interno (controle do sistema)
    const protocolNumber = await ProtocolService.generate()
    const now = new Date()

    // 4. Gera o Hash Original (SHA-256)
    // Concatena dados imutáveis do documento para garantir integridade
    const dataToHash = `${protocolNumber}|${document.title}|${document.content}|${document.documentType}|${now.toISOString()}|${userId}`
    const originalHash = crypto.createHash('sha256').update(dataToHash).digest('hex')

    // 5. Atualiza para ENVIADO (SENT)
    const updatedDoc = await prisma.communicationDocument.update({
      where: { id },
      data: {
        status: 'SENT',
        protocolNumber: protocolNumber,
        sentAt: now,
        originalHash: originalHash
      }
    })

    return reply.send({
      message: 'Documento protocolado com sucesso!',
      protocol: protocolNumber,
      hash: originalHash,
      document: {
        ...updatedDoc,
        verification: {
          protocol: protocolNumber,
          hash: originalHash,
          url: `${process.env.APP_URL || 'https://simp-system.com'}/verify/${originalHash}`,
          timestamp: now,
          valid: true
        }
      }
    })
  }

  async getRecipients(request: FastifyRequest, reply: FastifyReply) {
    const userId = this.getUserId(request)

    // 1. Buscar roles que têm permissão de leitura ou são admin
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

    // Parse da query string para busca
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

    // 2. Buscar usuários que têm esses roles com paginação/limite
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
      take: 20 // Limite para não sobrecarregar em pesquisas vazias
    })

    // 3. Formatar resposta para o frontend
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
}