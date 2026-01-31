import { FastifyInstance } from 'fastify';
import { TaskController } from '../controllers/task.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const taskController = new TaskController();

export async function taskRoutes(app: FastifyInstance) {
  // --- REMOVI O CÓDIGO DE STATIC DAQUI POIS JÁ ESTÁ NO PLUGINS.TS ---

  app.addHook('preHandler', authenticate);

  // Rotas de Tasks ligadas ao Workspace
  app.post('/workspaces/:workspaceId/tasks', taskController.create);
  app.get('/workspaces/:workspaceId/tasks', taskController.list);

  // Rotas diretas de Task
  app.get('/tasks/:id', taskController.details);
  app.put('/tasks/:id', taskController.update);
  app.delete('/tasks/:id', taskController.delete);
  app.patch('/tasks/:id/status', taskController.toggleStatus);
  
  // Checklist e Notas
  app.post('/tasks/:id/checklist', taskController.addChecklistItem);
  app.put('/checklist/:itemId', taskController.updateChecklistItem);
  app.post('/tasks/:id/notes', taskController.addNote);

  // Anexos (Upload & Delete)
  app.post('/tasks/:id/attachments', taskController.uploadAttachment);
  app.delete('/attachments/:attachmentId', taskController.deleteAttachment);
}