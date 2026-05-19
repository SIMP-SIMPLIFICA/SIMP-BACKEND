import { FastifyInstance } from 'fastify'
import { councilController } from '@/controllers/council.controller.js'
import { authMiddleware, requireAnyPermission, requireModule } from '@/middleware/auth.middleware.js'

const READ  = ['councils:read', 'councils:write', 'councils:admin']
const WRITE = ['councils:write', 'councils:admin']
const ADMIN = ['councils:admin']

export async function councilRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('councils'))

  // ─── Conselhos ──────────────────────────────────────────────────────────────

  app.get('/',
    { preHandler: [requireAnyPermission(READ)] },
    councilController.list,
  )

  app.post('/',
    { preHandler: [requireAnyPermission(WRITE)] },
    councilController.create,
  )

  app.get('/:id',
    { preHandler: [requireAnyPermission(READ)] },
    councilController.get,
  )

  app.put('/:id',
    { preHandler: [requireAnyPermission(WRITE)] },
    councilController.update,
  )

  app.delete('/:id',
    { preHandler: [requireAnyPermission(ADMIN)] },
    councilController.remove,
  )

  // ─── Membros ────────────────────────────────────────────────────────────────

  app.get('/:id/members',
    { preHandler: [requireAnyPermission(READ)] },
    councilController.listMembers,
  )

  app.post('/:id/members',
    { preHandler: [requireAnyPermission(WRITE)] },
    councilController.addMember,
  )

  app.put('/:id/members/:membershipId',
    { preHandler: [requireAnyPermission(WRITE)] },
    councilController.updateMember,
  )

  app.delete('/:id/members/:membershipId',
    { preHandler: [requireAnyPermission(ADMIN)] },
    councilController.removeMember,
  )
}
