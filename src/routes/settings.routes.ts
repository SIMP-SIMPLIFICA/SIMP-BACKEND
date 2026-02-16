import { FastifyInstance } from 'fastify'
import { settingsController } from '../controllers/settings.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'


export async function settingsRoutes(app: FastifyInstance) {
    // Public settings (e.g., Header info)
    app.get('/public', {
        schema: {
            tags: ['Settings'],
            description: 'Get public system settings'
        }
    }, settingsController.getPublicSettings)

    // Protected settings (Admin only - for now just authenticated)
    app.put('/', {
        preHandler: authenticate,

    }, settingsController.updateSettings)
}
