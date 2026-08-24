import { FastifyReply, FastifyRequest } from 'fastify'
import { getFileUrl, saveFile } from '../services/storage.service.js'
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'

export class UploadController {
  async upload(request: FastifyRequest, reply: FastifyReply) {
    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ message: 'Nenhum arquivo enviado' })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const fileBuffer = Buffer.concat(chunks)

    // Este endpoint era genérico e NÃO validava tipo algum — qualquer binário podia
    // ser gravado e depois baixado por URL direta (/uploads/ é servido sem auth).
    const detected = assertAllowedFile(fileBuffer, {
      policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT,
      declaredMime: data.mimetype,
      fileName: data.filename,
    })

    const fileKey = await saveFile(fileBuffer, {
      organizationId: (request.user as any)?.organizationId ?? null,
      scope: 'uploads',
      originalName: data.filename,
    })

    return reply.send({
      fileName: data.filename,
      fileUrl: getFileUrl(fileKey),
      // Persiste o tipo REAL, não o que o cliente declarou
      fileType: detected.mime,
      fileSize: fileBuffer.length,
    })
  }
}
