import { FastifyRequest, FastifyReply } from 'fastify'
import path from 'node:path'
import crypto from 'node:crypto'
import r2 from '../lib/r2.js'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export class UploadController {
  async upload(request: FastifyRequest, reply: FastifyReply) {
    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ message: 'Nenhum arquivo enviado' })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const fileBuffer = Buffer.concat(chunks)

    const fileHash = crypto.randomBytes(16).toString('hex')
    const ext = path.extname(data.filename)
    const fileName = `${fileHash}${ext}`

    const orgId = (request.user as any)?.organizationId ?? 'global'
    const r2Key = `organizations/${orgId}/uploads/${fileName}`

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: data.mimetype,
    }))

    const fileUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: r2Key }),
      { expiresIn: 3600 }
    )

    return reply.send({
      fileName: data.filename,
      fileUrl,
      fileType: data.mimetype,
      fileSize: fileBuffer.length,
    })
  }
}
