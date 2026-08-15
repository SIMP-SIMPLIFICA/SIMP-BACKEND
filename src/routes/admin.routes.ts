import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/auth.middleware.js'
import { adminController } from '../controllers/admin.controller.js'

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // --- Organizations CRUD ---
  app.get('/organizations',       adminController.listOrganizations.bind(adminController))
  app.post('/organizations',      adminController.createOrganization.bind(adminController))
  app.get('/organizations/:id',   adminController.getOrganization.bind(adminController))
  app.patch('/organizations/:id', adminController.updateOrganization.bind(adminController))

  // --- Module management ---
  app.get('/organizations/:id/modules',           adminController.listModules.bind(adminController))
  app.patch('/organizations/:id/modules/:module', adminController.toggleModule.bind(adminController))

  // --- Impersonation ---
  app.post('/organizations/:id/impersonate', adminController.impersonate.bind(adminController))
}
