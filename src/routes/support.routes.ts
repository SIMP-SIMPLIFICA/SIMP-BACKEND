import { FastifyInstance } from 'fastify'
import { supportController } from '@/controllers/support.controller.js'
import { authMiddleware } from '@/middleware/auth.middleware.js'

export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.post('/',                  supportController.create)
  app.get('/',                   supportController.list)
  app.get('/insights',           supportController.insights)    // must precede /:id routes
  app.get('/:id/messages',       supportController.getMessages)
  app.post('/:id/messages',      supportController.addMessage)
  app.patch('/:id/status',       supportController.updateStatus)
}
