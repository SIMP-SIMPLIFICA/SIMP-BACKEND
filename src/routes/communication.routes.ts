import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CommunicationController } from '@/controllers/communication.controller'
import { createMessageSchema, updateMessageSchema, messageIdSchema } from '@/schemas/communication.schemas'

const listFiltersSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  personId: z.string().optional()
})

export async function communicationRoutes(app: FastifyInstance) {
  const controller = new CommunicationController()

  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify()
      const user = request.user as any
      if (user && user.sub && !user.id) {
        user.id = user.sub
      }
    } catch (err) {
      reply.send(err)
    }
  })

  // POST — Criar e enviar mensagem
  app.post('/messages', {
    schema: {
      body: createMessageSchema,
      tags: ['Communication'],
      description: 'Criar e enviar uma nova mensagem interna'
    }
  }, controller.create.bind(controller))

  // GET — Caixa de entrada
  app.get('/inbox', {
    schema: {
      querystring: listFiltersSchema,
      tags: ['Communication'],
      description: 'Listar mensagens recebidas (inbox)'
    }
  }, controller.listInbox.bind(controller))

  // GET — Enviados
  app.get('/sent', {
    schema: {
      querystring: listFiltersSchema,
      tags: ['Communication'],
      description: 'Listar mensagens enviadas'
    }
  }, controller.listSent.bind(controller))

  // GET — Destinatários elegíveis
  app.get('/recipients', {
    schema: {
      querystring: z.object({ search: z.string().optional() }),
      tags: ['Communication'],
      description: 'Listar destinatários disponíveis'
    }
  }, controller.getRecipients.bind(controller))

  // GET — Detalhe de mensagem
  app.get('/messages/:id', {
    schema: {
      params: messageIdSchema,
      tags: ['Communication']
    }
  }, controller.getById.bind(controller))

  // PUT — Atualizar rascunho
  app.put('/messages/:id', {
    schema: {
      params: messageIdSchema,
      body: updateMessageSchema,
      tags: ['Communication']
    }
  }, controller.update.bind(controller))

  // DELETE — Excluir rascunho
  app.delete('/messages/:id', {
    schema: {
      params: messageIdSchema,
      tags: ['Communication']
    }
  }, controller.delete.bind(controller))

  // GET — Download de anexo
  app.get('/messages/:id/attachments/:attachmentId/download', {
    schema: {
      params: z.object({ id: z.string(), attachmentId: z.string() }),
      tags: ['Communication'],
      description: 'Download de anexo de mensagem'
    }
  }, controller.downloadAttachment.bind(controller))
}
