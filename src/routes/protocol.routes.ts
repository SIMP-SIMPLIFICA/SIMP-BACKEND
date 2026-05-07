import { FastifyInstance } from 'fastify'
import { protocolController } from '@/controllers/protocol.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

export async function protocolRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('protocols'))

  // Gerar número oficial (RESERVADO)
  app.post(
    '/generate',
    { preHandler: [requireAnyPermission(['protocols:write', 'protocols:admin'])] },
    protocolController.generate,
  )

  // Listar documentos emitidos
  app.get(
    '/',
    { preHandler: [requireAnyPermission(['protocols:read', 'protocols:write', 'protocols:admin'])] },
    protocolController.list,
  )

  // Atualizar status (EMITIDO / CANCELADO)
  // Criador pode marcar o próprio como EMITIDO; apenas admin pode cancelar.
  // A lógica fina fica no controller — aqui abrimos para quem tem write.
  app.patch(
    '/:id/status',
    { preHandler: [requireAnyPermission(['protocols:write', 'protocols:admin'])] },
    protocolController.updateStatus,
  )

  // Excluir documento — permitido para criador (apenas RESERVADO) ou admin
  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['protocols:write', 'protocols:admin'])] },
    protocolController.delete,
  )

  // Ver contadores de sequência por ano
  app.get(
    '/sequences',
    { preHandler: [requireAnyPermission(['protocols:admin'])] },
    protocolController.getSequences,
  )
}
