import { FastifyInstance } from 'fastify'
import { TaskController } from '../controllers/task.controller.js'
import { authMiddleware } from '../middleware/auth.middleware.js'

const taskController = new TaskController()

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // NOTA: As rotas de criar/listar por workspace foram movidas para workspace.routes.ts
  // para respeitar a URL /workspaces/:id/tasks chamada pelo frontend.

  // --- Rotas Diretas da Tarefa (Prefixo /tasks herdado do config) ---
  
  // Detalhes (GET /tasks/:id)
  app.get('/:id', taskController.details)
  
  // Atualizações
  app.put('/:id', taskController.update)
  app.delete('/:id', taskController.delete)
  app.patch('/:id/status', taskController.toggleStatus)

  // Sub-recursos (Checklist, Notas)
  app.post('/:id/checklist', taskController.addChecklistItem)
  app.put('/checklist/:itemId', taskController.updateChecklistItem)
  app.post('/:id/notes', taskController.addNote)
  
  // Anexos
  app.post('/:id/attachments', taskController.uploadAttachment)
  app.delete('/attachments/:attachmentId', taskController.deleteAttachment)

  // Membros (Assignees)
  app.post('/:id/assignees', taskController.addAssignee)
  app.delete('/:id/assignees/:userId', taskController.removeAssignee)
}