import { FastifyInstance } from 'fastify';
import { WorkspaceController } from '../controllers/workspace.controller.js';
// CORREÇÃO AQUI: Ajustado para a pasta 'middleware' e arquivo 'auth.middleware.js'
import { authenticate } from '../middleware/auth.middleware.js'; 

const workspaceController = new WorkspaceController();

export async function workspaceRoutes(app: FastifyInstance) {
  // Protege todas as rotas deste arquivo
  app.addHook('preHandler', authenticate);

  app.post('/', workspaceController.create);
  app.get('/', workspaceController.list);
  app.post('/:id/members', workspaceController.addMember);
  app.get('/:id', workspaceController.getById); // Adicionando getById se faltar
}