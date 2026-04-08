import { FastifyInstance } from 'fastify'
import { organizationController } from '../controllers/organization.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'

export function organizationRoutes(app: FastifyInstance) {
  // Super admin only — lista todas as organizações
  app.get('/', { preHandler: [authenticate] },
    organizationController.list.bind(organizationController)
  )

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
