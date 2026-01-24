import { FastifyInstance } from 'fastify'
import { db } from '@/utils/database.js'
import { redisClient } from '@/utils/redis.js'
import { logger } from '@/utils/logger.js'

export const gracefulShutdown = (app: FastifyInstance, signal: string = 'SIGTERM') => {
  return async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`)

    try {
      await app.close()
      await db.disconnect()
      
      if (redisClient.isOpen) {
        await redisClient.quit()
      }

      logger.info('Graceful shutdown completed')
      process.exit(0)
    } catch (error) {
      logger.error({ err: error }, `Error during graceful shutdown (${signal})`)
      process.exit(1)
    }
  }
}