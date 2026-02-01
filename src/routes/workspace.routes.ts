import { FastifyInstance } from 'fastify';
import { WorkspaceController } from '../controllers/workspace.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const workspaceController = new WorkspaceController();

export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/', workspaceController.create);
  app.get('/', workspaceController.list);
  app.get('/:id', workspaceController.getById);

  app.post('/:id/members', workspaceController.addMember);
  app.delete('/:id/members/:userId', workspaceController.removeMember);

  app.delete('/:id', workspaceController.delete);
}