import { FastifyInstance } from 'fastify'
import { councilController } from '@/controllers/council.controller.js'
import { meetingController } from '@/controllers/council-meeting.controller.js'
import { documentController } from '@/controllers/council-document.controller.js'
import { signingController } from '@/controllers/govbr-signing.controller.js'
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

  // ─── Reuniões ───────────────────────────────────────────────────────────────

  app.get('/:councilId/meetings',
    { preHandler: [requireAnyPermission(READ)] },
    meetingController.list,
  )

  app.post('/:councilId/meetings',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.create,
  )

  app.get('/:councilId/meetings/:id',
    { preHandler: [requireAnyPermission(READ)] },
    meetingController.get,
  )

  app.put('/:councilId/meetings/:id',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.update,
  )

  app.delete('/:councilId/meetings/:id',
    { preHandler: [requireAnyPermission(ADMIN)] },
    meetingController.remove,
  )

  app.patch('/:councilId/meetings/:id/status',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.updateStatus,
  )

  // ─── Pautas ─────────────────────────────────────────────────────────────────

  app.post('/:councilId/meetings/:id/agenda',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.addAgendaItem,
  )

  app.put('/:councilId/meetings/:id/agenda/:itemId',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.updateAgendaItem,
  )

  app.delete('/:councilId/meetings/:id/agenda/:itemId',
    { preHandler: [requireAnyPermission(ADMIN)] },
    meetingController.removeAgendaItem,
  )

  // ─── Presença ───────────────────────────────────────────────────────────────

  app.get('/:councilId/meetings/:id/attendance',
    { preHandler: [requireAnyPermission(READ)] },
    meetingController.getAttendance,
  )

  app.put('/:councilId/meetings/:id/attendance',
    { preHandler: [requireAnyPermission(WRITE)] },
    meetingController.saveAttendance,
  )

  // ─── Documentos ─────────────────────────────────────────────────────────────

  app.get('/:councilId/meetings/:meetingId/documents',
    { preHandler: [requireAnyPermission(READ)] },
    documentController.list,
  )

  app.post('/:councilId/meetings/:meetingId/documents',
    { preHandler: [requireAnyPermission(WRITE)] },
    documentController.upload,
  )

  app.get('/:councilId/meetings/:meetingId/documents/:docId/download',
    { preHandler: [requireAnyPermission(READ)] },
    documentController.download,
  )

  app.delete('/:councilId/meetings/:meetingId/documents/:docId',
    { preHandler: [requireAnyPermission(ADMIN)] },
    documentController.remove,
  )

  // ─── Assinatura Gov.br (protegidas) ─────────────────────────────────────────

  app.post('/sign/initiate',
    { preHandler: [requireAnyPermission(['councils:sign', 'councils:admin'])] },
    signingController.initiate,
  )

  app.get('/sign/:requestId/status',
    { preHandler: [requireAnyPermission([...READ, 'councils:sign'])] },
    signingController.status,
  )
}

// Rota pública — sem authMiddleware, sem requireModule.
// O callback do OAuth2 é autenticado pela validação do state (CSRF one-time token).
export async function councilPublicRoutes(app: FastifyInstance) {
  app.get('/sign/callback', signingController.callback)
}
