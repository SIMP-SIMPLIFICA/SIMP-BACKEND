import { FastifyInstance } from 'fastify'
import { departmentController } from '@/controllers/department.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

export async function departmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get('/', departmentController.list)

  app.post('/', { preHandler: [requireAnyPermission(['departments:write'])] }, departmentController.create)
  app.patch('/:id', { preHandler: [requireAnyPermission(['departments:write'])] }, departmentController.update)
  app.delete('/:id', { preHandler: [requireAnyPermission(['departments:delete'])] }, departmentController.remove)

  // Member management
  app.get('/:id/members', departmentController.listMembers)
  app.post('/:id/members', { preHandler: [requireAnyPermission(['departments:write'])] }, departmentController.addMembers)
  app.delete('/:id/members/:userId', { preHandler: [requireAnyPermission(['departments:write'])] }, departmentController.removeMember)
}
