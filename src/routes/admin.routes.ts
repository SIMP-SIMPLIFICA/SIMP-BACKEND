import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/auth.middleware.js'
import { adminController } from '../controllers/admin.controller.js'

export async function adminRoutes(app: FastifyInstance) {
    app.addHook('onRequest', authenticate)

    app.get('/organizations', adminController.listOrganizations.bind(adminController))
    app.post('/organizations/:id/impersonate', adminController.impersonate.bind(adminController))
}
