import { FastifyInstance } from 'fastify'
import {
  covenantController,
  covenantTypeController,
  convenenteController,
  concedenteController,
} from '@/controllers/covenant.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

export async function covenantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('covenants'))

  // ── CovenantType sub-resource (must come before /:id) ─────────────────────
  app.get(
    '/types',
    { preHandler: [requireAnyPermission(['covenants:read', 'covenants:write', 'covenants:delete'])] },
    covenantTypeController.list.bind(covenantTypeController)
  )
  app.post(
    '/types',
    { preHandler: [requireAnyPermission(['covenants:write'])] },
    covenantTypeController.create.bind(covenantTypeController)
  )
  app.delete(
    '/types/:id',
    { preHandler: [requireAnyPermission(['covenants:delete'])] },
    covenantTypeController.delete.bind(covenantTypeController)
  )

  // ── Convenente sub-resource ───────────────────────────────────────────────
  app.get(
    '/convenentes',
    { preHandler: [requireAnyPermission(['covenants:read', 'covenants:write', 'covenants:delete'])] },
    convenenteController.list.bind(convenenteController)
  )
  app.post(
    '/convenentes',
    { preHandler: [requireAnyPermission(['covenants:write'])] },
    convenenteController.create.bind(convenenteController)
  )
  app.delete(
    '/convenentes/:id',
    { preHandler: [requireAnyPermission(['covenants:delete'])] },
    convenenteController.delete.bind(convenenteController)
  )

  // ── Concedente sub-resource ───────────────────────────────────────────────
  app.get(
    '/concedentes',
    { preHandler: [requireAnyPermission(['covenants:read', 'covenants:write', 'covenants:delete'])] },
    concedenteController.list.bind(concedenteController)
  )
  app.post(
    '/concedentes',
    { preHandler: [requireAnyPermission(['covenants:write'])] },
    concedenteController.create.bind(concedenteController)
  )
  app.delete(
    '/concedentes/:id',
    { preHandler: [requireAnyPermission(['covenants:delete'])] },
    concedenteController.delete.bind(concedenteController)
  )

  // ── Covenant CRUD (/:id must come AFTER static sub-routes) ───────────────
  app.get(
    '/',
    { preHandler: [requireAnyPermission(['covenants:read', 'covenants:write', 'covenants:delete'])] },
    covenantController.list.bind(covenantController)
  )
  app.get(
    '/:id',
    { preHandler: [requireAnyPermission(['covenants:read', 'covenants:write', 'covenants:delete'])] },
    covenantController.getOne.bind(covenantController)
  )
  app.post(
    '/',
    { preHandler: [requireAnyPermission(['covenants:write'])] },
    covenantController.create.bind(covenantController)
  )
  app.put(
    '/:id',
    { preHandler: [requireAnyPermission(['covenants:write'])] },
    covenantController.update.bind(covenantController)
  )
  app.delete(
    '/:id',
    { preHandler: [requireAnyPermission(['covenants:delete'])] },
    covenantController.delete.bind(covenantController)
  )
}
