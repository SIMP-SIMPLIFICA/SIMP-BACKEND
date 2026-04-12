import cron from 'node-cron'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'

/**
 * Deleta notificações JÁ LIDAS mais antigas que autoClearDays de cada usuário.
 * Só afeta usuários com autoClearDays > 0.
 *
 * Roda uma vez por dia à meia-noite (configurável via CLEAR_NOTIFICATIONS_CRON).
 * Padrão cron: '0 0 * * *'
 */
export function startClearNotificationsJob() {
  const schedule = process.env.CLEAR_NOTIFICATIONS_CRON ?? '0 0 * * *'

  cron.schedule(schedule, async () => {
    logger.info('[clear-notifications] Iniciando limpeza de notificações antigas...')

    try {
      const users = await prisma.user.findMany({
        where: { autoClearDays: { gt: 0 } },
        select: { id: true, autoClearDays: true }
      })

      if (users.length === 0) {
        logger.info('[clear-notifications] Nenhum usuário com limpeza automática configurada.')
        return
      }

      let totalDeleted = 0

      const results = await Promise.allSettled(
        users.map(async user => {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - user.autoClearDays)

          const result = await prisma.notification.deleteMany({
            where: {
              userId: user.id,
              read: true,
              createdAt: { lt: cutoff }
            }
          })

          return result.count
        })
      )

      results.forEach(r => {
        if (r.status === 'fulfilled') totalDeleted += r.value
      })

      logger.info(`[clear-notifications] ${totalDeleted} notificação(ões) removida(s).`)
    } catch (error) {
      logger.error(error, '[clear-notifications] Erro na limpeza de notificações')
    }
  })

  logger.info(`[clear-notifications] Job agendado com schedule: "${schedule}"`)
}
