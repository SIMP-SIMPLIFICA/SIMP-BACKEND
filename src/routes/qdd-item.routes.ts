import type { FastifyInstance } from 'fastify'
import { qddItemController } from '@/controllers/qdd-item.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

/**
 * Rotas do QDD — Quadro de Detalhamento da Despesa (Épico 4, Fase 2).
 *
 * Permissões de DEPARTAMENTO, não de diárias: a dotação é cadastro do setor e
 * quem a mantém é o contador, que nem sempre emite diária. Amarrá-la a
 * `dailyAllowances:write` obrigaria a dar ao contador um poder que não é dele.
 */
export async function qddItemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['departments:read', 'departments:write'])] },
    qddItemController.list
  )

  app.get(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:read', 'departments:write'])] },
    qddItemController.getById
  )

  app.post(
    '/',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    qddItemController.create
  )

  app.patch(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    qddItemController.update
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    qddItemController.remove
  )
}
