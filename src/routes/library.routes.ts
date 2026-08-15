import { FastifyInstance } from 'fastify'
import { authMiddleware, requirePermission } from '@/middleware/auth.middleware.js'
import { libraryController } from '@/controllers/library.controller.js'

export async function libraryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // Upload de documento (PDF)
  app.post(
    '/upload',
    { preHandler: [requirePermission(['library:write'])] },
    libraryController.upload.bind(libraryController)
  )

  // Listagem com busca e filtro de clearanceLevel
  app.get(
    '/',
    { preHandler: [requirePermission(['library:read'])] },
    libraryController.list.bind(libraryController)
  )

  // Download via signed URL
  app.get(
    '/:id/download',
    { preHandler: [requirePermission(['library:read'])] },
    libraryController.download.bind(libraryController)
  )

  // Soft delete
  app.delete(
    '/:id',
    { preHandler: [requirePermission(['library:delete'])] },
    libraryController.delete.bind(libraryController)
  )

  // Download em lote (ZIP)
  app.post(
    '/download-zip',
    { preHandler: [requirePermission(['library:read'])] },
    libraryController.downloadZip.bind(libraryController)
  )

  // Audit log de acessos
  app.get(
    '/logs',
    { preHandler: [requirePermission(['library:logs'])] },
    libraryController.logs.bind(libraryController)
  )

  // Categorias
  app.get(
    '/categories',
    { preHandler: [requirePermission(['library:read'])] },
    libraryController.listCategories.bind(libraryController)
  )

  app.post(
    '/categories',
    { preHandler: [requirePermission(['library:write'])] },
    libraryController.createCategory.bind(libraryController)
  )

  app.delete(
    '/categories/:id',
    { preHandler: [requirePermission(['library:write'])] },
    libraryController.deleteCategory.bind(libraryController)
  )
}
