import { initSentry } from '@/config/sentry.js'
initSentry()

import Fastify from 'fastify'
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { gracefulShutdown } from '@/utils/graceful-shutdown.js'
import { db } from '@/utils/database.js'
import { AppServer } from '@/types/server'
import * as crypto from 'node:crypto'
import { registerRoutes } from './config/routes.js'
import { registerPlugins } from './config/plugins.js'

const server: AppServer = Fastify({
  loggerInstance: logger,
  trustProxy: true,
  bodyLimit: config.server.maxBodySize,
  keepAliveTimeout: 30000,
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  genReqId: () => crypto.randomUUID()
})

async function start() {
  try {
    logger.info('🚀 Starting server...')

    logger.info('📦 Registering plugins...')
    await registerPlugins(server)
    logger.info('✅ Plugins registered successfully')

    logger.info('🗄️ Connecting to database...')
    await db.connect()
    logger.info('✅ Database connected successfully')

    logger.info('🛣️ Registering routes...')
    await registerRoutes(server)
    logger.info('✅ Routes registered successfully')

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

    const shutdown = gracefulShutdown(server)
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

await start()
