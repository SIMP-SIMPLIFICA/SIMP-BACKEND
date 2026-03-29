import { FastifyInstance } from 'fastify'
import { UploadController } from '../controllers/upload.controller.js'

export async function uploadRoutes(app: FastifyInstance) {
  const controller = new UploadController()

  app.post('/upload', {
    schema: {
      tags: ['Upload'],
      description: 'Upload de arquivos (Multipart)',
      // params: ...
      // body: ...
      // response: { ... }
    }
  }, controller.upload.bind(controller))
}