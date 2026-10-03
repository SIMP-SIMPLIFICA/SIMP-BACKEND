import type { FastifyInstance } from 'fastify'
import { holidayController } from '@/controllers/holiday.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

/**
 * Rotas de feriados (Épico 8, FR-020) — gated pelo módulo `dailyAllowances`,
 * porque é a única funcionalidade que hoje consome o calendário; não existe
 * caso de uso para cadastrar feriado sem o módulo de diárias habilitado.
 */
export async function holidayRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('dailyAllowances'))

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:read'])] },
    holidayController.list
  )

  app.post(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    holidayController.create
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    holidayController.remove
  )
}
