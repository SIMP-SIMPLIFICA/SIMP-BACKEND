import { FastifyRequest, FastifyReply } from 'fastify'
import { saveFile, getFileUrl } from '../services/storage.service.js'

export class UploadController {
  async upload(request: FastifyRequest, reply: FastifyReply) {
    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ message: 'Nenhum arquivo enviado' })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const fileBuffer = Buffer.concat(chunks)

    const fileKey = await saveFile(fileBuffer, {
      organizationId: (request.user as any)?.organizationId ?? null,
      scope: 'uploads',
      originalName: data.filename,
    })

    return reply.send({
      fileName: data.filename,
      fileUrl: getFileUrl(fileKey),
      fileType: data.mimetype,
      fileSize: fileBuffer.length,
    })
  }
}
