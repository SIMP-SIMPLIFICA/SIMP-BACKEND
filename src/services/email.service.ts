import type { Transporter } from 'nodemailer'
import { createTransport } from 'nodemailer'
import { config } from '@/config/config.js'
import { emailLogger, logger } from '@/utils/logger.js'

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{
    filename: string
    content: string | Buffer
    contentType?: string
  }>
}

class EmailService {
  private transporter: Transporter

  constructor() {
    this.transporter = createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth:
        config.email.user && config.email.pass
          ? {
            user: config.email.user,
            pass: config.email.pass
          }
          : undefined,
      ...(config.isDevelopment && {
        // ignoreTLS: true, // REMOVIDO: Isso impede o upgrade para TLS (STARTTLS)
        requireTLS: false,
        tls: {
          rejectUnauthorized: false
        }
      })
    })

    this.verifyConnection().catch((error: any) => {
      logger.error(error, 'Failed to verify email connection')
    })
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify()
      emailLogger.info('✅ Email service connected successfully')
    } catch (error: any) {
      emailLogger.error(error, '❌ Email service connection failed')
    }
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: `${config.email.fromName} <${config.email.from}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments as any
      })

      emailLogger.info(
        {
          to: options.to,
          subject: options.subject,
          messageId: info.messageId
        },
        'Email sent successfully'
      )
    } catch (error: any) {
      emailLogger.error({ error, to: options.to }, 'Failed to send email')
      throw error
    }
  }

  private generateEmailTemplate(title: string, content: string, actionButton?: { text: string; url: string }): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .container { background: white; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { text-align: center; color: #007bff; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>${title}</h1></div>
          <div>${content}</div>
          ${actionButton ? `<div style="text-align: center;"><a href="${actionButton.url}" class="button">${actionButton.text}</a></div>` : ''}
        </div>
      </body>
      </html>
    `
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${config.urls.frontend}/reset-password?token=${token}`
    const content = `
      <p>Recebemos uma solicitação para redefinir a senha da sua conta SIMP.</p>
      <p>Clique no botão abaixo para criar uma nova senha. O link expira em <strong>1 hora</strong>.</p>
      <p>Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece a mesma.</p>
    `
    await this.sendEmail({
      to: email,
      subject: 'Redefinição de senha — SIMP',
      html: this.generateEmailTemplate(
        'Redefinir senha',
        content,
        { text: 'Redefinir minha senha', url: resetUrl }
      ),
      text: `Acesse o link para redefinir sua senha: ${resetUrl}\n\nO link expira em 1 hora.`
    })
  }

  async sendTempPasswordEmail(email: string, tempPassword: string): Promise<void> {
    const loginUrl = `${config.urls.frontend}/login`
    const content = `
      <p>Uma conta foi criada para você no SIMP.</p>
      <p>Sua senha temporária é: <strong>${tempPassword}</strong></p>
      <p>Por segurança, recomendamos alterá-la assim que fizer o primeiro acesso.</p>
    `
    await this.sendEmail({
      to: email,
      subject: 'Sua conta SIMP foi criada',
      html: this.generateEmailTemplate(
        'Bem-vindo ao SIMP',
        content,
        { text: 'Acessar o sistema', url: loginUrl }
      ),
      text: `Sua senha temporária: ${tempPassword}\n\nAcesse: ${loginUrl}`
    })
  }

  async sendWelcomeEmail(email: string, name?: string): Promise<void> {
    const content = `<p>Hello ${name || ''}! Welcome to SIMP.</p>`
    await this.sendEmail({
      to: email,
      subject: 'Welcome to SIMP',
      html: this.generateEmailTemplate('Welcome!', content)
    })
  }

  async sendBulkEmail(recipients: string[], subject: string, content: string, batchSize: number = 50): Promise<void> {
    const batches: any[] = []
    for (let i = 0; i < recipients.length; i += batchSize) {
      batches.push(recipients.slice(i, i + batchSize))
    }

    for (const batch of batches) {
      const promises = batch.map((recipient: string) =>
        this.sendEmail({ to: recipient, subject, html: content }).catch(error => {
          emailLogger.error({ error, recipient }, 'Bulk email fail')
        })
      )
      await Promise.all(promises)
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }
}

export const emailService = new EmailService()