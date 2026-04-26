import { FastifyInstance } from 'fastify'
import { departmentController } from '@/controllers/department.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

export async function departmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // Listar departamentos — qualquer usuário autenticado pode ver (para selects)
  app.get('/', departmentController.list)

  // Criar departamento
  app.post(
    '/',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    departmentController.create,
  )

  // Editar departamento
  app.patch(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    departmentController.update,
  )

  // Excluir departamento
  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:delete'])] },
    departmentController.remove,
  )
}
