import { FastifyInstance } from 'fastify'
import { WorkspaceController } from '../controllers/workspace.controller.js'
import { TaskController } from '../controllers/task.controller.js' // Importar TaskController
import { authMiddleware } from '../middleware/auth.middleware.js'

const workspaceController = new WorkspaceController()
const taskController = new TaskController() // Instanciar

export function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // --- Rotas de Workspace ---
  app.post('/', workspaceController.create)
  app.get('/', workspaceController.list)
  app.get('/:id', workspaceController.getById)
  app.delete('/:id', workspaceController.delete)

  // --- Membros ---
  app.post('/:id/members', workspaceController.addMember)
  app.delete('/:id/members/:userId', workspaceController.removeMember)
  
  // Lista de usuários atribuíveis (Correção anterior)
  app.get('/:workspaceId/assignable-users', workspaceController.listAssignableUsers)

  // --- TAREFAS VINCULADAS AO WORKSPACE (A CORREÇÃO DO 404) ---
  // Como estamos dentro do prefixo '/workspaces', a URL final fica: /workspaces/:workspaceId/tasks
  app.post('/:workspaceId/tasks', taskController.create)
  app.get('/:workspaceId/tasks', taskController.list)
}