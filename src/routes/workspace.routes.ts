import { FastifyInstance } from 'fastify'
import { WorkspaceController } from '../controllers/workspace.controller.js'
import { TaskController } from '../controllers/task.controller.js'
import { authMiddleware, requirePermission } from '../middleware/auth.middleware.js'

const workspaceController = new WorkspaceController()
const taskController = new TaskController()

export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // --- Rotas de Workspace ---
  app.post('/', { preHandler: requirePermission(['workspaces:write', 'system:admin']) }, workspaceController.create)
  app.get('/', workspaceController.list) // Lista workspaces que o usuário pertence (filtrado no controller)
  app.get('/:id', { preHandler: requirePermission(['workspaces:read']) }, workspaceController.getById)
  app.delete('/:id', { preHandler: requirePermission(['workspaces:manage', 'system:admin']) }, workspaceController.delete)

  // --- Membros ---
  app.post('/:id/members', { preHandler: requirePermission(['workspaces:manage']) }, workspaceController.addMember)
  app.delete('/:id/members/:userId', { preHandler: requirePermission(['workspaces:manage']) }, workspaceController.removeMember)

  // Lista de usuários atribuíveis (Correção anterior)
  app.get('/:workspaceId/assignable-users', workspaceController.listAssignableUsers)

  // --- TAREFAS VINCULADAS AO WORKSPACE (A CORREÇÃO DO 404) ---
  // Como estamos dentro do prefixo '/workspaces', a URL final fica: /workspaces/:workspaceId/tasks
  app.post('/:workspaceId/tasks', taskController.create)
  app.get('/:workspaceId/tasks', taskController.list)
}