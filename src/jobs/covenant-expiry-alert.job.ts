import cron from 'node-cron'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import { notificationService } from '@/services/notification.service.js'
import { getUsersWithPermission } from '@/services/rbac.service.js'

/**
 * Alerta de vencimento de convênio — Transferegov (Épico 8, FR-023/FR-024).
 *
 * COMPLEMENTAR ao alerta visual contínuo do Épico 3 (`VirtualProcess.validityDate`,
 * 30/15/7/3 dias), não um substituto: este roda sobre `Covenant.validityEndDate`
 * — campo distinto — e produz NOTIFICAÇÃO ATIVA (`Notification`), não apenas
 * sinal na tela.
 *
 * Roda uma vez por dia (configurável via `COVENANT_EXPIRY_ALERT_CRON`) e
 * dispara exatamente quando faltam 60 ou 30 dias — nunca "60 ou menos", para
 * não reenviar todo dia dentro da janela. O dedupe por (`entityId`, `type`)
 * cobre o caso de o job rodar mais de uma vez no mesmo dia.
 */

interface ExpiryWindow {
  days: number
  type: string
  label: string
}

const EXPIRY_WINDOWS: ExpiryWindow[] = [
  { days: 60, type: 'COVENANT_EXPIRING_60', label: '60 dias' },
  { days: 30, type: 'COVENANT_EXPIRING_30', label: '30 dias' },
]

/** Dias de calendário (UTC) entre hoje e `target` — pode ser negativo. */
function daysUntil(target: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  return Math.round((targetDay - today) / 86_400_000)
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

/**
 * Destinatários do alerta de um convênio: gestor do departamento vinculado
 * (quando houver) + usuários com permissão de escrita em convênios na mesma
 * organização.
 *
 * Simplificação assumida (documentada na spec do Épico 8): a lista de
 * destinatários é resolvida no momento do disparo, não travada no primeiro
 * envio da janela — um usuário que ganhar a permissão depois do disparo de
 * 60 dias só é considerado na janela de 30 dias.
 */
async function resolveRecipients(organizationId: string, departmentManagerId: string | null): Promise<string[]> {
  const orgUsers = await prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: { id: true },
  })

  const permitted = await getUsersWithPermission(orgUsers.map(u => u.id), 'covenants:write')
  const recipients = new Set(permitted)
  if (departmentManagerId) recipients.add(departmentManagerId)

  return Array.from(recipients)
}

/**
 * O corpo do job, exportado separado de `cron.schedule` para ser testável
 * sem depender de agendador nenhum.
 */
export async function runCovenantExpiryCheck(now = new Date()): Promise<void> {
  const covenants = await prisma.covenant.findMany({
    where: { validityEndDate: { not: null } },
    select: {
      id: true,
      number: true,
      organizationId: true,
      validityEndDate: true,
      department: { select: { managerId: true } },
    },
  })

  for (const covenant of covenants) {
    if (!covenant.validityEndDate) continue

    const remaining = daysUntil(covenant.validityEndDate, now)
    const window = EXPIRY_WINDOWS.find(w => w.days === remaining)
    if (!window) continue

    // Dedupe (FR-024): já existe notificação desta janela para este convênio?
    // Um `findFirst` basta — `notifyMany` grava uma linha por destinatário,
    // todas com o mesmo `entityId`+`type`, então uma só já denuncia o envio.
    const alreadyNotified = await prisma.notification.findFirst({
      where: { entityId: covenant.id, type: window.type },
      select: { id: true },
    })
    if (alreadyNotified) continue

    const recipients = await resolveRecipients(covenant.organizationId, covenant.department?.managerId ?? null)
    if (recipients.length === 0) {
      logger.warn(
        `[covenant-expiry-alert] Convênio ${covenant.number} está a ${window.label} do vencimento, ` +
          'mas não há destinatário (nem gestor de setor, nem usuário com covenants:write).'
      )
      continue
    }

    await notificationService.notifyMany(recipients, {
      title: 'Convênio próximo do vencimento',
      message: `O convênio nº ${covenant.number} vence em ${window.label} (${formatDate(covenant.validityEndDate)}). Verifique a necessidade de prestação de contas ou aditivo.`,
      type: window.type,
      link: `/convenios/${covenant.id}`,
      entityId: covenant.id,
    })

    logger.info(`[covenant-expiry-alert] Convênio ${covenant.number} notificado (${window.label}), ${recipients.length} destinatário(s).`)
  }
}

export function startCovenantExpiryAlertJob() {
  const schedule = process.env.COVENANT_EXPIRY_ALERT_CRON ?? '0 6 * * *'

  cron.schedule(schedule, async () => {
    logger.info('[covenant-expiry-alert] Verificando convênios próximos do vencimento...')
    try {
      await runCovenantExpiryCheck()
    } catch (error) {
      logger.error(error, '[covenant-expiry-alert] Erro ao verificar convênios')
    }
  })

  logger.info(`[covenant-expiry-alert] Job agendado com schedule: "${schedule}"`)
}
