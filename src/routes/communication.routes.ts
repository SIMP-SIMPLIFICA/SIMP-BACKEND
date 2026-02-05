import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CommunicationController } from '@/controllers/communication.controller'
import { createDocumentSchema, updateDocumentSchema, documentIdSchema } from '@/schemas/communication.schemas'

export async function communicationRoutes(app: FastifyInstance) {
  const controller = new CommunicationController()

  // Configuração manual do Zod
  app.setValidatorCompiler(({ schema }) => {
    return (data) => {
      const result = (schema as z.ZodType<any>).safeParse(data)
      if (result.success) {
        return { value: result.data }
      } else {
        return { error: result.error }
      }
    }
  })

  // Middleware de autenticação
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify()
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
      tags: ['Communication'],
      description: 'List user drafts'
    }
  }, controller.listDrafts.bind(controller))

  // GET (Caixa de Entrada - Recebidos)
  app.get('/received', {
    schema: {
      tags: ['Communication'],
      description: 'List received documents (Inbox)'
    }
  }, controller.listReceived.bind(controller))

  // GET (Enviados)
  app.get('/sent', {
    schema: {
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
}