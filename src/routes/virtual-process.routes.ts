import { FastifyInstance } from 'fastify'
import { virtualProcessController } from '@/controllers/virtual-process.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

export async function virtualProcessRoutes(app: FastifyInstance) {
  // --- Workspace-scoped routes (list + create) ---
  app.get(
    '/workspaces/:workspaceId',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:read', 'processes:write', 'processes:manage'])] },
    virtualProcessController.listProcesses.bind(virtualProcessController)
  )

  app.post(
    '/workspaces/:workspaceId',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:write', 'processes:manage'])] },
    virtualProcessController.createProcess.bind(virtualProcessController)
  )

  // --- Resource-level routes ---
  app.get(
    '/:id',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:read', 'processes:write', 'processes:manage'])] },
    virtualProcessController.getProcessDetails.bind(virtualProcessController)
  )

  app.patch(
    '/:id/status',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:manage'])] },
    virtualProcessController.toggleStatus.bind(virtualProcessController)
  )

  app.patch(
    '/:id/company',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:manage', 'processes:write'])] },
    virtualProcessController.updateCompanyInfo.bind(virtualProcessController)
  )

  app.delete(
    '/:id',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:manage', 'processes:write'])] },
    virtualProcessController.deleteProcess.bind(virtualProcessController)
  )

  app.post(
    '/:id/documents',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:write', 'processes:manage'])] },
    virtualProcessController.uploadDocument.bind(virtualProcessController)
  )

  app.get(
    '/:id/documents/:documentId/download',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:download', 'processes:write', 'processes:manage'])] },
    virtualProcessController.downloadDocument.bind(virtualProcessController)
  )

  app.delete(
    '/:id/documents/:documentId',
    { preHandler: [authMiddleware, requireAnyPermission(['processes:manage', 'processes:write'])] },
    virtualProcessController.deleteDocument.bind(virtualProcessController)
  )
}
