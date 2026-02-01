import { FastifyInstance } from 'fastify';
import { TaskController } from '../controllers/task.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const taskController = new TaskController();

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // Rotas de Tasks ligadas ao Workspace
  app.post('/workspaces/:workspaceId/tasks', taskController.create);
  app.get('/workspaces/:workspaceId/tasks', taskController.list);

  // Rota para listar usuários atribuíveis (NOVA)
  app.get('/workspaces/:workspaceId/assignable-users', taskController.listAssignableUsers);

  // Rotas diretas de Task
  app.get('/tasks/:id', taskController.details);
  app.put('/tasks/:id', taskController.update);
  app.delete('/tasks/:id', taskController.delete);
  app.patch('/tasks/:id/status', taskController.toggleStatus);
  
  // Checklist e Notas
  app.post('/tasks/:id/checklist', taskController.addChecklistItem);
  app.put('/checklist/:itemId', taskController.updateChecklistItem);
  app.post('/tasks/:id/notes', taskController.addNote);

  // Anexos
  app.post('/tasks/:id/attachments', taskController.uploadAttachment);
  app.delete('/attachments/:attachmentId', taskController.deleteAttachment);

  // --- ASSIGNEES (MEMBROS DA TAREFA) - ESTAVAM FALTANDO ---
  app.post('/tasks/:id/assignees', taskController.addAssignee);
  app.delete('/tasks/:id/assignees/:userId', taskController.removeAssignee);
}