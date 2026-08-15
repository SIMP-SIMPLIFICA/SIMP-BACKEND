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
  recipientName?: string
  senderName?: string
  messageSubject?: string
  messageBody?: string
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
      const { to, subject, message, link, recipientName, senderName, messageSubject, messageBody } = job.data

      const greeting = recipientName ? `Olá, ${recipientName}` : 'Olá'
      const contextLine = senderName
        ? `Você recebeu uma comunicação no <strong>Sistema Simplifica</strong> de <strong>${senderName}</strong>.`
        : message

      const subjectBlock = messageSubject
        ? `<div style="background:#f1f5f9;border-left:4px solid #10b981;border-radius:6px;padding:12px 16px;margin:16px 0;">
            <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:600;">Assunto</p>
            <p style="margin:6px 0 0;font-size:16px;font-weight:700;color:#0f172a;">${messageSubject}</p>
          </div>`
        : ''

      const bodyBlock = messageBody
        ? `<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:600;margin-bottom:8px;">Mensagem</p>
            <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${messageBody.length > 500 ? messageBody.slice(0, 500) + '…' : messageBody}</p>
          </div>`
        : ''

      const fullLink = link
        ? (link.startsWith('http') ? link : `${process.env.FRONTEND_URL ?? ''}${link}`)
        : null

      const ctaBlock = fullLink
        ? `<div style="text-align:center;margin:28px 0;">
            <a href="${fullLink}"
               style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 28px;border-radius:8px;letter-spacing:0.01em;">
              Acessar Comunicação no SIMP
            </a>
          </div>`
        : ''

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

          <!-- Logo / Brand -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <span style="font-size:20px;font-weight:800;color:#10b981;letter-spacing:-0.5px;">SIMP</span>
              <span style="font-size:13px;color:#94a3b8;margin-left:6px;">Sistema Integrado Municipal</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:32px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${greeting}</p>
              <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">${contextLine}</p>

              ${subjectBlock}
              ${bodyBlock}
              ${ctaBlock}

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #f1f5f9;margin:24px 0;">

              <!-- Footer -->
              <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
                Mensagem automática enviada pelo sistema SIMP. Não responda a este e-mail.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

      await emailService.sendEmail({
        to,
        subject,
        html,
        text: `${greeting}\n\n${contextLine}${messageSubject ? `\n\nAssunto: ${messageSubject}` : ''}${messageBody ? `\n\n${messageBody}` : ''}${fullLink ? `\n\nAcessar: ${fullLink}` : ''}\n\n—\nMensagem automática do SIMP. Não responda a este e-mail.`
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
