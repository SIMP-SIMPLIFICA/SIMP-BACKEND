import type { FastifyInstance } from 'fastify'
import { fleetFuelingController } from '@/controllers/fleet-fueling.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

/**
 * Rotas de Abastecimento de Frota (Épico 3, Task 3.2).
 *
 * Mesma separação de permissões da Task 3.1: `fleetFuelings:issue` é distinta de
 * `write` porque emitir gera documento oficial com hash público e congela o
 * registro — não é a mesma coisa que lançar um abastecimento no sistema.
 */
export async function fleetFuelingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('fleetFuelings'))

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['fleetFuelings:read'])] },
    fleetFuelingController.list
  )

  app.post(
    '/',
    { preHandler: [requireAnyPermission(['fleetFuelings:write'])] },
    fleetFuelingController.create
  )

  app.post(
    '/:id/issue',
    { preHandler: [requireAnyPermission(['fleetFuelings:issue'])] },
    fleetFuelingController.issue
  )

  app.get(
    '/:id/pdf',
    { preHandler: [requireAnyPermission(['fleetFuelings:read'])] },
    fleetFuelingController.downloadPdf
  )

  app.get(
    '/:id',
    { preHandler: [requireAnyPermission(['fleetFuelings:read'])] },
    fleetFuelingController.getById
  )

  app.patch(
    '/:id',
    { preHandler: [requireAnyPermission(['fleetFuelings:write'])] },
    fleetFuelingController.update
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['fleetFuelings:delete'])] },
    fleetFuelingController.remove
  )
}
