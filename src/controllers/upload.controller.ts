import { FastifyRequest, FastifyReply } from 'fastify'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const pump = promisify(pipeline)

// Correção para __dirname em ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class UploadController {
  async upload(request: FastifyRequest, reply: FastifyReply) {
    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ message: 'Nenhum arquivo enviado' })
    }

    // Gera nome único
    const fileHash = crypto.randomBytes(16).toString('hex')
    const ext = path.extname(data.filename)
    const fileName = `${fileHash}${ext}`
    
    // Caminho: src/controllers/../../uploads -> raiz/uploads
    const uploadDir = path.join(__dirname, '../../uploads')
    
    // Garante que a pasta existe
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
    }

    const savePath = path.join(uploadDir, fileName)

    // Salva o arquivo
    await pump(data.file, fs.createWriteStream(savePath))

    // Constrói a URL pública
    // Em produção, isso deve ser ajustado para o domínio real definido no .env
    const protocol = request.protocol
    const host = request.hostname
    const fileUrl = `${protocol}://${host}/uploads/${fileName}`

    return reply.send({
      fileName: data.filename,
      fileUrl: fileUrl,
      fileType: data.mimetype,
      fileSize: 0 // Multipart stream não calcula tamanho total facilmente antes do fim
    })
  }
}