import { FastifyInstance } from 'fastify'
import { protocolController } from '@/controllers/protocol.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

export async function protocolRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('protocols'))

  // Gerar número oficial (RESERVADO)
  app.post(
    '/generate',
    { preHandler: [requireAnyPermission(['protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao'])] },
    protocolController.generate,
  )

  // Listar documentos emitidos
  app.get(
    '/',
    { preHandler: [requireAnyPermission(['protocols:read', 'protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao'])] },
    protocolController.list,
  )

  // Atualizar status — lógica fina (admin vs. criador) fica no controller
  app.patch(
    '/:id/status',
    { preHandler: [requireAnyPermission(['protocols:read', 'protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao'])] },
    protocolController.updateStatus,
  )

  // Excluir documento — lógica fina (admin vs. criador, apenas RESERVADO) fica no controller
  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['protocols:read', 'protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao'])] },
    protocolController.delete,
  )

  // Relatório em PDF — mesma permissão de leitura, pois não altera nada.
  app.get(
    '/report',
    { preHandler: [requireAnyPermission(['protocols:read', 'protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao'])] },
    protocolController.report,
  )

  // Ver contadores de sequência por ano
  app.get(
    '/sequences',
    { preHandler: [requireAnyPermission(['protocols:admin'])] },
    protocolController.getSequences,
  )
}
