import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/auth.middleware.js'
import { adminController } from '../controllers/admin.controller.js'
import { organizationBrandingController } from '../controllers/organization-branding.controller.js'

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

  // --- White-label: logo do tenant (Épico 3, Task 3.4) ---
  // Restrito ao Super Admin (verificado no controller, como no resto deste
  // módulo): a logo carimba a autoria de documento oficial.
  app.post('/organizations/:id/logo',   organizationBrandingController.uploadLogo)
  app.delete('/organizations/:id/logo', organizationBrandingController.removeLogo)

  // --- Impersonation ---
  app.post('/organizations/:id/impersonate', adminController.impersonate.bind(adminController))
}
