import type { FastifyInstance } from 'fastify'
import { fleetController } from '@/controllers/fleet.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

/**
 * Simplifica Frotas — rotas autenticadas sob /api/v1/fleet (TASK 1).
 *
 * Guardas na ordem: autenticação (JWT + fingerprint) → módulo `fleet` ligado na
 * organização (403 MODULE_DISABLED) → permissão `fleet:*` reconsultada no banco.
 * O escopo por departamento é aplicado no service.
 */
const READ = ['fleet:read', 'fleet:manage']
const MANAGE = ['fleet:manage']

export async function fleetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('fleet'))

  app.get('/vehicles', { preHandler: [requireAnyPermission(READ)] }, fleetController.listVehicles)
  app.get('/vehicles/:id', { preHandler: [requireAnyPermission(READ)] }, fleetController.getVehicle)
  app.post('/vehicles', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.createVehicle)
  app.patch('/vehicles/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.updateVehicle)
  app.delete('/vehicles/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.deleteVehicle)

  app.get('/drivers', { preHandler: [requireAnyPermission(READ)] }, fleetController.listDrivers)
  // CPF no corpo, nunca na URL (a query string aparece no log de requisição).
  // Limite próprio e baixo: a máscara + a localização formariam um oráculo de
  // CPF por força bruta sem ele.
  app.post(
    '/drivers/lookup',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, preHandler: [requireAnyPermission(READ)] },
    fleetController.lookupDriver
  )
  app.get('/drivers/:id', { preHandler: [requireAnyPermission(READ)] }, fleetController.getDriver)
  app.post('/drivers', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.createDriver)
  app.patch('/drivers/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.updateDriver)
  app.delete('/drivers/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.deleteDriver)
}
