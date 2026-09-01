import { initSentry } from '@/config/sentry.js'
initSentry()

import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { gracefulShutdown } from '@/utils/graceful-shutdown.js'
import { db } from '@/utils/database.js'
import { AppServer } from '@/types/server'
import { buildApp } from './app.js'
import { startExpireTasksJob } from './jobs/expire-tasks.job.js'
import { startClearNotificationsJob } from './jobs/clear-notifications.job.js'
import { startCleanupGovBrStatesJob } from './jobs/cleanup-govbr-states.job.js'
import { createEmailNotificationWorker } from './lib/email-queue.js'
import { createDocumentOcrWorker } from './lib/document-queue.js'
import { connectRedis } from './utils/redis.js'

let server: AppServer

async function start() {
  try {
    logger.info('🚀 Starting server...')

    // Monta plugins e rotas. A mesma função é usada pelos testes de integração,
    // então teste e produção servem exatamente a mesma árvore de rotas.
    logger.info('📦 Building application (plugins + routes)...')
    server = await buildApp()
    logger.info('✅ Application built successfully')

    logger.info('🗄️ Connecting to database...')
    await db.connect()
    logger.info('✅ Database connected successfully')

    // Redis alimenta o banimento de IP do honeypot (ip-ban.service.ts).
    // NÃO é fatal: sem Redis o ban vale só nesta instância, e é preferível o
    // sistema no ar com proteção parcial a não subir por causa do cache.
    try {
      await connectRedis()
      logger.info('✅ Redis connected — banimento de IP compartilhado ativo')
    } catch (err) {
      logger.warn({ err }, '⚠️ Redis indisponível — banimento de IP ficará restrito a esta instância')
    }

    startExpireTasksJob()
    startClearNotificationsJob()
    startCleanupGovBrStatesJob()

    const emailWorker = createEmailNotificationWorker()
    logger.info('📧 Email notification worker started')

    const ocrWorker = createDocumentOcrWorker()
    logger.info('📄 Document OCR worker started')

    await server.listen({
      port: config.server.port,
      host: '0.0.0.0'
    })

    const serverUrl = `http://127.0.0.1:${config.server.port}`
    logger.info(`🚀 Server listening at ${serverUrl}`)

    if (config.isDevelopment) {
      logger.info(`📚 Swagger UI available at ${serverUrl}/documentation`)
      logger.info(`🔍 Health check available at ${serverUrl}/health`)
    }

    const shutdown = gracefulShutdown(server, emailWorker, ocrWorker)
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.on('SIGINT', shutdown)
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.on('SIGTERM', shutdown)

  } catch (error) {
    logger.error(error, 'Failed to start server')
    process.exit(1)
  }
}

process.on('uncaughtException', error => {
  logger.fatal(error, 'Uncaught exception')
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled rejection')
  process.exit(1)
})

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})