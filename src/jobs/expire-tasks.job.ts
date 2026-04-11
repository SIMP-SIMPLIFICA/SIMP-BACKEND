import cron from 'node-cron'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import { notificationService } from '@/services/notification.service.js'

/**
 * Marca como EXPIRED todas as tarefas cujo dueDate já passou
 * e que ainda não estejam DONE ou EXPIRED.
 *
 * Roda a cada hora (configurável via TASK_EXPIRY_CRON).
 * Padrão cron: '0 * * * *' → no início de cada hora.
 */
export function startExpireTasksJob() {
  const schedule = process.env.TASK_EXPIRY_CRON ?? '0 * * * *'

  cron.schedule(schedule, async () => {
    logger.info('[expire-tasks] Verificando tarefas expiradas...')

    try {
      const now = new Date()

      // Busca todas as tarefas elegíveis antes de atualizar,
      // para poder notificar os responsáveis.
      const expiredTasks = await prisma.task.findMany({
        where: {
          dueDate: { lt: now },
          status: { notIn: ['DONE', 'EXPIRED'] },
        },
        include: {
          assignees: true,
          workspace: { select: { name: true } },
        },
      })

      if (expiredTasks.length === 0) {
        logger.info('[expire-tasks] Nenhuma tarefa expirada encontrada.')
        return
      }

      // Atualiza todas de uma vez (batch update)
      const result = await prisma.task.updateMany({
        where: {
          id: { in: expiredTasks.map(t => t.id) },
        },
        data: { status: 'EXPIRED' },
      })

      logger.info(`[expire-tasks] ${result.count} tarefa(s) marcada(s) como EXPIRED.`)

      // Registra histórico e notifica responsáveis de cada tarefa
      await Promise.allSettled(
        expiredTasks.map(async task => {
          // Histórico
          await prisma.taskHistory.create({
            data: {
              taskId: task.id,
              userId: task.creatorId,
              action: 'Tarefa expirada automaticamente pelo sistema',
            },
          })

          // Notifica criador + responsáveis
          const recipients = new Set<string>([task.creatorId])
          task.assignees.forEach(a => recipients.add(a.userId))

          if (recipients.size > 0) {
            await notificationService.notifyMany(Array.from(recipients), {
              title: 'Tarefa Expirada',
              message: `[${task.workspace.name}] A tarefa "${task.title}" expirou e foi movida automaticamente.`,
              type: 'TASK_STATUS',
              link: `/workspaces/${task.workspaceId}?taskId=${task.id}`,
              entityId: task.id,
            })
          }
        })
      )
    } catch (error) {
      logger.error(error, '[expire-tasks] Erro ao expirar tarefas')
    }
  })

  logger.info(`[expire-tasks] Job agendado com schedule: "${schedule}"`)
}
