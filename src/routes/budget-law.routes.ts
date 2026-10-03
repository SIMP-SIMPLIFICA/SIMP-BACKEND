import type { FastifyInstance } from 'fastify'
import { budgetLawController } from '@/controllers/budget-law.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

/** Rotas de Leis Orçamentárias — LOA, PPA e LDO (Épico 4, Fase 2). */
export async function budgetLawRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['departments:read', 'departments:write'])] },
    budgetLawController.list
  )

  // POST faz upsert: um card por tipo na tela, sem distinção de criar/editar.
  app.post(
    '/',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    budgetLawController.upsert
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['departments:write'])] },
    budgetLawController.remove
  )
}
