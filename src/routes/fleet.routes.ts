import type { FastifyInstance } from 'fastify'
import { fleetController } from '@/controllers/fleet.controller.js'
import { fleetFuelingController } from '@/controllers/fleet-fueling.controller.js'
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
const AUTHORIZE = ['fleet:authorize_fuel']
const CONTRACT_READ = ['fleet:read', 'fleet:manage', 'fleet:authorize_fuel']
const FUELING_READ = ['fleet:read', 'fleet:authorize_fuel', 'fleet:review_fuel']
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

  // ─── Contratos de combustível (TASK 3A, D16) ───────────────────────────────
  // Quem emite autorização precisa ver os contratos para escolher; só fleet:manage cadastra.
  app.get('/contracts', { preHandler: [requireAnyPermission(CONTRACT_READ)] }, fleetFuelingController.listContracts)
  app.get('/contracts/:id', { preHandler: [requireAnyPermission(CONTRACT_READ)] }, fleetFuelingController.getContract)
  app.post('/contracts', { preHandler: [requireAnyPermission(MANAGE)] }, fleetFuelingController.createContract)
  app.patch('/contracts/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetFuelingController.updateContract)
  app.delete('/contracts/:id', { preHandler: [requireAnyPermission(MANAGE)] }, fleetFuelingController.deleteContract)

  // ─── Autorização de abastecimento (TASK 3A) ────────────────────────────────
  app.get('/fuelings', { preHandler: [requireAnyPermission(FUELING_READ)] }, fleetFuelingController.listFuelings)
  app.get('/fuelings/departments', { preHandler: [requireAnyPermission(FUELING_READ)] }, fleetFuelingController.fuelingDepartments)
  app.get('/fuelings/options',{ preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.fuelingOptions)
  app.get('/fuelings/suggestions', { preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.fuelingSuggestions)
  app.get('/fuelings/:id', { preHandler: [requireAnyPermission(FUELING_READ)] }, fleetFuelingController.getFueling)
  // O PDF carrega o QR operacional (token de uso único): download auditado e com limite próprio.
  app.get(
    '/fuelings/:id/pdf',
    { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(FUELING_READ)] },
    fleetFuelingController.downloadFuelingPdf
  )
  app.post('/fuelings', { preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.createFueling)
  app.patch('/fuelings/:id', { preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.updateFueling)
  app.delete('/fuelings/:id', { preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.deleteFueling)
  app.post(
    '/fuelings/:id/issue',
    { config: EXPORT_LIMIT, preHandler: [requireAnyPermission(AUTHORIZE)] },
    fleetFuelingController.issueFueling
  )
  app.post('/fuelings/:id/cancel', { preHandler: [requireAnyPermission(AUTHORIZE)] }, fleetFuelingController.cancelFueling)
}
