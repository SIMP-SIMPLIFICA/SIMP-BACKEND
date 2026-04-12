import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { config } from '@/config/config.js'
import { emailService } from '@/services/email.service.js'
import { logger } from '@/utils/logger.js'

export interface EmailNotificationJobData {
  to: string
  subject: string
  title: string
  message: string
  link?: string
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

export const emailNotificationQueue = new Queue<EmailNotificationJobData>('email-notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 }
  }
})

export function createEmailNotificationWorker() {
  const worker = new Worker<EmailNotificationJobData>(
    'email-notifications',
    async (job: Job<EmailNotificationJobData>) => {
      const { to, subject, title, message, link } = job.data

      const linkHtml = link
        ? `<p><a href="${link}" style="color:#007bff">Ver no SIMP</a></p>`
        : ''

      await emailService.sendEmail({
        to,
        subject,
        html: `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head><meta charset="UTF-8"></head>
          <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
            <h2 style="color:#007bff">${title}</h2>
            <p>${message}</p>
            ${linkHtml}
          </body>
          </html>
        `,
        text: `${message}${link ? `\n\nVer no SIMP: ${link}` : ''}`
      })
    },
    { connection }
  )

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id }, 'Email notification job completed')
  })

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'Email notification job failed')
  })

  return worker
}
