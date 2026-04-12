import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { config } from '@/config/config.js'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import r2 from '@/lib/r2.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
// pdf-parse tem problemas crônicos de exportação CJS/ESM — força require e detecta a forma em runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

export interface OcrJobData {
  documentId: string
  fileKey: string
}

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {})
  }
}

const connection = buildRedisConnection()

export const documentOcrQueue = new Queue<OcrJobData>('document-ocr', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 }
  }
})

export function createDocumentOcrWorker() {
  const worker = new Worker<OcrJobData>(
    'document-ocr',
    async (job: Job<OcrJobData>) => {
      const { documentId, fileKey } = job.data

      // 1. Baixa o PDF do R2
      const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileKey
      })
      const response = await r2.send(command)

      if (!response.Body) {
        throw new Error(`R2 returned empty body for key: ${fileKey}`)
      }

      // Converte o stream do R2 para Buffer
      const chunks: Uint8Array[] = []
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      const buffer = Buffer.concat(chunks)

      // 2. Extrai texto com pdf-parse — detecta forma de exportação em runtime
      let ocrText: string
      try {
        let data: { text: string }
        if (typeof pdfParse === 'function') {
          data = await pdfParse(buffer)
        } else if (pdfParse && typeof pdfParse.default === 'function') {
          data = await pdfParse.default(buffer)
        } else {
          throw new Error(
            `pdfParse export is uncallable. Type: ${typeof pdfParse}, Keys: ${Object.keys(pdfParse ?? {}).join(',')}`
          )
        }
        ocrText = data.text.trim()
      } catch (err) {
        logger.error({ err, documentId }, 'OCR extraction failed')
        throw err
      }

      const trimmed = ocrText

      // 3. Salva textContent no banco
      await prisma.libraryDocument.update({
        where: { id: documentId },
        data: { textContent: trimmed || null }
      })

      logger.info({ documentId, chars: trimmed.length }, 'OCR completed for library document')
    },
    { connection, concurrency: 2 }
  )

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, 'Document OCR job completed')
  })

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'Document OCR job failed')
  })

  return worker
}
