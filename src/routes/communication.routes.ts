import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CommunicationController } from '@/controllers/communication.controller'
import { createDocumentSchema, updateDocumentSchema, documentIdSchema } from '@/schemas/communication.schemas'

const listFiltersSchema = z.object({
  type: z.enum(['ALL', 'MENSAGEM', 'DOCUMENTO']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  personId: z.string().optional()
})

export async function communicationRoutes(app: FastifyInstance) {
  const controller = new CommunicationController()

  // Validator compiler is now set globally in plugins.ts

  // Middleware de autenticação
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify()

      // Garante compatibilidade: copia sub -> id para os controllers (igual ao authenticate middleware)
      const user = request.user as any
      if (user && user.sub && !user.id) {
        user.id = user.sub
      }
    } catch (err) {
      reply.send(err)
    }
  })

  // POST (Criar Rascunho)
  app.post('/documents', {
    schema: {
      body: createDocumentSchema,
      tags: ['Communication'],
      description: 'Create a new draft document'
    }
  }, controller.create.bind(controller))

  // GET (Listar Meus Rascunhos)
  app.get('/drafts', {
    schema: {
      querystring: listFiltersSchema,
      tags: ['Communication'],
      description: 'List user drafts'
    }
  }, controller.listDrafts.bind(controller))

  // GET (Caixa de Entrada - Recebidos)
  app.get('/received', {
    schema: {
      querystring: listFiltersSchema,
      tags: ['Communication'],
      description: 'List received documents (Inbox)'
    }
  }, controller.listReceived.bind(controller))

  // GET (Enviados)
  app.get('/sent', {
    schema: {
      querystring: listFiltersSchema,
      tags: ['Communication'],
      description: 'List sent documents'
    }
  }, controller.listSent.bind(controller))

  // GET (Listar Destinatários Elegíveis)
  app.get('/recipients', {
    schema: {
      tags: ['Communication'],
      description: 'List eligible document recipients'
    }
  }, controller.getRecipients.bind(controller))

  // GET (Detalhes)
  app.get('/documents/:id', {
    schema: {
      params: documentIdSchema,
      tags: ['Communication']
    }
  }, controller.getById.bind(controller))

  // PUT (Atualizar)
  app.put('/documents/:id', {
    schema: {
      params: documentIdSchema,
      body: updateDocumentSchema,
      tags: ['Communication']
    }
  }, controller.update.bind(controller))

  // DELETE (Excluir)
  app.delete('/documents/:id', {
    schema: {
      params: documentIdSchema,
      tags: ['Communication']
    }
  }, controller.delete.bind(controller))

  app.post('/documents/:id/send', {
    schema: {
      params: documentIdSchema,
      tags: ['Communication'],
      description: 'Gera protocolo e envia o documento'
    }
  }, controller.send.bind(controller))

  app.post('/documents/:id/sign', {
    schema: {
      params: documentIdSchema,
      tags: ['Communication'],
      description: 'Assina o documento digitalmente'
    }
  }, controller.sign.bind(controller))

  // GET (Download de Anexo Específico)
  app.get('/documents/:id/attachments/:attachmentId/download', {
    schema: {
      params: z.object({
        id: z.string(),
        attachmentId: z.string()
      }),
      tags: ['Communication'],
      description: 'Download secure attachment'
    }
  }, controller.downloadAttachment.bind(controller))

  // GET (Download do Documento Principal - PDF do Protocolo)
  app.get('/documents/:id/download', {
    schema: {
      params: z.object({
        id: z.string()
      }),
      tags: ['Communication'],
      description: 'Download the main protocol PDF of the document'
    }
  }, controller.downloadDocument.bind(controller))
}