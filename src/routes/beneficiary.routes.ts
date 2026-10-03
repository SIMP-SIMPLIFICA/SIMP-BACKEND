import type { FastifyInstance } from 'fastify'
import { beneficiaryController } from '@/controllers/beneficiary.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

/**
 * Rotas do cadastro de beneficiários de diárias.
 *
 * Além da autenticação, ficam atrás do MÓDULO e das PERMISSÕES de diárias. A
 * especificação pedia apenas o middleware de auth, mas sem esse cerco qualquer
 * usuário autenticado — de qualquer setor — poderia listar e apagar a lista de
 * servidores da prefeitura. Como o cadastro só existe para alimentar as
 * diárias, herdar as permissões delas é o cerco natural, sem inventar um
 * conjunto novo de permissões para gerenciar.
 */
export async function beneficiaryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('dailyAllowances'))

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:read', 'dailyAllowances:write'])] },
    beneficiaryController.list
  )

  app.post(
    '/',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    beneficiaryController.create
  )

  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['dailyAllowances:write'])] },
    beneficiaryController.remove
  )
}
