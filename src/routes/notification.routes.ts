import { FastifyInstance } from 'fastify'
import { NotificationController } from '../controllers/notification.controller.js'
import { authMiddleware, requirePermission } from '../middleware/auth.middleware.js'

const notificationController = new NotificationController()

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get('/stream', notificationController.stream)
  app.get('/', { preHandler: requirePermission(['notifications:read']) }, notificationController.list)
  app.patch('/preferences', { preHandler: requirePermission(['notifications:write']) }, notificationController.updatePreferences)
  app.patch('/read-all', { preHandler: requirePermission(['notifications:write']) }, notificationController.markAllRead)
  app.patch('/:id/read', { preHandler: requirePermission(['notifications:write']) }, notificationController.markAsRead)
  app.delete('/', { preHandler: requirePermission(['notifications:manage']) }, notificationController.deleteAll)
  app.delete('/:id', { preHandler: requirePermission(['notifications:manage']) }, notificationController.delete)
}