import cron from 'node-cron'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'

export function startCleanupGovBrStatesJob() {
  const schedule = process.env.GOVBR_CLEANUP_CRON ?? '*/30 * * * *'

  cron.schedule(schedule, async () => {
    try {
      const result = await prisma.govBrOAuthState.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })

      if (result.count > 0) {
        logger.info(`[cleanup-govbr-states] ${result.count} state(s) expirado(s) removido(s).`)
      }
    } catch (error) {
      logger.error(error, '[cleanup-govbr-states] Erro ao limpar states expirados')
    }
  })

  logger.info(`[cleanup-govbr-states] Job agendado com schedule: "${schedule}"`)
}
