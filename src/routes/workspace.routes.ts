import { FastifyInstance } from 'fastify';
import { WorkspaceController } from '../controllers/workspace.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const workspaceController = new WorkspaceController();

export async function workspaceRoutes(app: FastifyInstance) {
  // Protege todas as rotas
  app.addHook('preHandler', authenticate);

  // Rotas Básicas
  app.post('/', workspaceController.create);       // Criação
  app.get('/', workspaceController.list);          // Listagem
  app.get('/:id', workspaceController.getById);    // Detalhes

  // Membros
  app.post('/:id/members', workspaceController.addMember); // Adicionar membro

  // Exclusão
  app.delete('/:id', workspaceController.delete);  // Deletar workspace
}