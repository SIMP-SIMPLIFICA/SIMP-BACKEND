import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'

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
  // OCR temporariamente desabilitado — pdf-parse instável + custo de CPU no servidor principal
  const worker = new Worker<OcrJobData>(
    'document-ocr',
    async (job: Job<OcrJobData>) => {
      logger.info({ jobId: job.id }, 'OCR disabled — job discarded')
    },
    { connection, concurrency: 1 }
  )

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, 'Document OCR job completed')
  })

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'Document OCR job failed')
  })

  return worker
}
