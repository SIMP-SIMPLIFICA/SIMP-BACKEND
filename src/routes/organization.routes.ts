import { FastifyInstance } from 'fastify'
import { organizationController } from '../controllers/organization.controller.js'

export function organizationRoutes(app: FastifyInstance) {
  // Rota pública — sem autenticação (onboarding de novo cliente)
  app.post('/', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, organizationController.create.bind(organizationController))
}
