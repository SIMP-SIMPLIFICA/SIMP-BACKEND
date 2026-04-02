import { FastifyInstance } from 'fastify'
import { virtualProcessController } from '@/controllers/virtual-process.controller.js'
import { virtualProcessCategoryController } from '@/controllers/virtual-process-category.controller.js'
import { sourceController, companyController } from '@/controllers/virtual-process-config.controller.js'
import { authMiddleware, requireAnyPermission } from '@/middleware/auth.middleware.js'

export async function virtualProcessRoutes(app: FastifyInstance) {
  // --- Category routes (auth only — workspace member check is done in controller) ---
  app.post(
    '/workspaces/:workspaceId/categories',
    { preHandler: [authMiddleware] },
    virtualProcessCategoryController.create.bind(virtualProcessCategoryController)
  )

  app.get(
    '/workspaces/:workspaceId/categories',
    { preHandler: [authMiddleware] },
    virtualProcessCategoryController.list.bind(virtualProcessCategoryController)
  )

  app.put(
    '/categories/:id',
    { preHandler: [authMiddleware] },
    virtualProcessCategoryController.update.bind(virtualProcessCategoryController)
  )

  app.delete(
    '/categories/:id',
    { preHandler: [authMiddleware] },
    virtualProcessCategoryController.delete.bind(virtualProcessCategoryController)
  )

  // --- Source routes (Origens do Recurso) ---
  app.post('/workspaces/:workspaceId/sources', { preHandler: [authMiddleware] }, sourceController.create)
  app.get('/workspaces/:workspaceId/sources', { preHandler: [authMiddleware] }, sourceController.list)
  app.put('/sources/:id', { preHandler: [authMiddleware] }, sourceController.update)
  app.delete('/sources/:id', { preHandler: [authMiddleware] }, sourceController.delete)

  // --- Company routes (Empresas Contratadas) ---
  app.post('/workspaces/:workspaceId/companies', { preHandler: [authMiddleware] }, companyController.create)
  app.get('/workspaces/:workspaceId/companies', { preHandler: [authMiddleware] }, companyController.list)
  app.put('/companies/:id', { preHandler: [authMiddleware] }, companyController.update)
  app.delete('/companies/:id', { preHandler: [authMiddleware] }, companyController.delete)

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
