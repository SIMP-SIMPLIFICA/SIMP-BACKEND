import type { FastifyInstance } from 'fastify'
import { dailyAllowanceController } from '@/controllers/daily-allowance.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

/**
 * Rotas de Diárias de Servidor (Épico 3, Task 3.1).
 *
 * Emissão tem permissão própria (`dailyAllowances:issue`), separada de `write`:
 * criar um rascunho é rotina administrativa, mas emitir gera documento oficial
 * com hash público e congela o registro — é um ato de outra natureza.
 */
export async function dailyAllowanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('dailyAllowances'))

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:read'])] },
    dailyAllowanceController.list
  )

  app.post(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    dailyAllowanceController.create
  )

  // Sub-rotas antes de /:id genérico não é necessário aqui porque os caminhos
  // são distintos, mas a ordem segue o padrão do projeto.
  app.post(
    '/:id/issue',
    { preHandler: [requireAnyPermission(['dailyAllowances:issue'])] },
    dailyAllowanceController.issue
  )

  app.get(
    '/:id/pdf',
    { preHandler: [requireAnyPermission(['dailyAllowances:read'])] },
    dailyAllowanceController.downloadPdf
  )

  app.get(
    '/:id',
    { preHandler: [requireAnyPermission(['dailyAllowances:read'])] },
    dailyAllowanceController.getById
  )

  app.patch(
    '/:id',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    dailyAllowanceController.update
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['dailyAllowances:delete'])] },
    dailyAllowanceController.remove
  )
}
