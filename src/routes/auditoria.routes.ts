import type { FastifyInstance } from 'fastify'
import { auditoriaController } from '@/controllers/auditoria.controller.js'
import { authenticate, requireAnyPermission } from '@/middleware/auth.middleware.js'

/**
 * Rotas do Painel de Auditoria (Épico 2, Task 2.1).
 *
 * Apenas GET: a trilha é imutável e não há rota que altere ou remova registros.
 * Usa `audit:read`, permissão que já existe no catálogo.
 */
export async function auditoriaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get(
    '/',
    { preHandler: [requireAnyPermission(['audit:read', 'audit:export'])] },
    auditoriaController.listar
  )
}
