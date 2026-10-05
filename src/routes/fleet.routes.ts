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
// PDF: geração pesada (motor + QR + hash) — limite próprio. A chave é o IP
// (keyGenerator global): o limite roda antes da autenticação, sem usuário.
const EXPORT_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } }

export async function fleetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('fleet'))

  app.get('/vehicles', { preHandler: [requireAnyPermission(READ)] }, fleetController.listVehicles)
  // Exportações são POST: filtros (busca) no corpo, nunca na URL.
  app.post('/vehicles/export', { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(READ)] }, fleetController.exportVehicles)
  app.post(
    '/vehicles/:id/export',
    { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(READ)] },
    fleetController.exportVehicleSheet
  )
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
  // Matrícula no corpo: a tela não distingue matrícula numérica de CPF
  // incompleto. Sem oráculo de CPF aqui (busca parcial por matrícula), então o
  // limite é o de uso normal com digitação + debounce.
  app.post(
    '/drivers/search-by-registration',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, preHandler: [requireAnyPermission(READ)] },
    fleetController.searchDriversByRegistration
  )
  app.post('/drivers/export', { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(READ)] }, fleetController.exportDrivers)
  app.post(
    '/drivers/:id/export',
    { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(READ)] },
    fleetController.exportDriverSheet
  )
  app.get('/drivers/:id', { preHandler: [requireAnyPermission(READ)] }, fleetController.getDriver)
  app.post('/drivers', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.createDriver)
  app.patch('/drivers/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.updateDriver)
  app.delete('/drivers/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetController.deleteDriver)
}
