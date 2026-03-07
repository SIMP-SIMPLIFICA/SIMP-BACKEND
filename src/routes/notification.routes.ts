import { FastifyInstance } from 'fastify';
import { NotificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const notificationController = new NotificationController();

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/stream', notificationController.stream);
  app.get('/', notificationController.list);
  app.patch('/:id/read', notificationController.markAsRead);
  app.patch('/read-all', notificationController.markAllRead);
  app.delete('/', notificationController.deleteAll);
  app.delete('/:id', notificationController.delete);
}