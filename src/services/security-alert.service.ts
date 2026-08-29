import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { redis } from '@/utils/redis.js'
import { safeFetch } from '@/utils/url-security.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import type { Prisma } from '@prisma/client'

/**
 * Alertas de anomalia comportamental (Épico 2, Task 2.3).
 *
 * Avalia cada login em busca de sinais de acesso indevido e notifica o Super
 * Admin por webhook (futuramente ligado ao WhatsApp/Telegram).
 *
 * PRINCÍPIO — ALERTA NUNCA DERRUBA LOGIN:
 *   Todo o fluxo é fire-and-forget. Se o Redis estiver fora, se o webhook
 *   demorar ou responder erro, o login do usuário segue normalmente e a falha
 *   vira log. Uma proteção que impede o servidor da prefeitura de autenticar
 *   quando um serviço externo cai é pior que a ameaça que ela combate.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AnomalyType = 'EARLY_MORNING_LOGIN' | 'IMPOSSIBLE_TRAVEL'

export interface LoginContext {
  userId: string
  email: string
  ip: string
  userAgent?: string | null
  organizationId?: string | null
  /** Injetável para testes; default é o instante atual. */
  timestamp?: Date
}

export interface Anomaly {
  type: AnomalyType
  description: string
  details: Record<string, unknown>
}

/** Último acesso registrado por usuário, guardado no Redis. */
interface LastAccess {
  ip: string
  timestampISO: string
}

const LAST_ACCESS_PREFIX = 'security:last-access:'
/** 30 dias: tempo suficiente para comparar logins esparsos sem inchar o Redis. */
const LAST_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60

// ─── Regras de detecção ───────────────────────────────────────────────────────

/**
 * Login em horário atípico (madrugada).
 *
 * A comparação usa a hora LOCAL do servidor de propósito: "madrugada" é um
 * conceito do fuso de quem opera o sistema, não do UTC. Um servidor rodando em
 * UTC classificaria 22h de Brasília como 01h e alertaria em pleno expediente.
 */
export function detectEarlyMorningLogin(timestamp: Date): Anomaly | null {
  const hour = timestamp.getHours()
  const start = config.alerts.earlyMorningStartHour
  const end = config.alerts.earlyMorningEndHour

  // Suporta janelas que cruzam a meia-noite (ex.: 23h–05h).
  const isWithinWindow = start <= end
    ? hour >= start && hour <= end
    : hour >= start || hour <= end

  if (!isWithinWindow) return null

  return {
    type: 'EARLY_MORNING_LOGIN',
    description: `Login realizado as ${String(hour).padStart(2, '0')}h, dentro da janela de madrugada (${start}h-${end}h).`,
    details: { hour, windowStart: start, windowEnd: end },
  }
}

/**
 * Deslocamento impossível — troca de IP em intervalo curto demais.
 *
 * LIMITAÇÃO ASSUMIDA: sem base de geolocalização offline, não há como medir
 * distância real nem comparar ASN. A aproximação viável é olhar o IP anterior:
 * se mudou dentro da janela configurada, alerta. Isso gera falso positivo
 * legítimo (trocar de Wi-Fi para 4G, por exemplo) — e é justamente por isso que
 * o resultado é ALERTA e nunca bloqueio. Com geolocalização disponível, esta
 * função é o único ponto a evoluir.
 */
export function detectImpossibleTravel(
  currentIp: string,
  previous: LastAccess | null,
  now: Date,
): Anomaly | null {
  if (!previous || previous.ip === currentIp) return null

  const minutesSinceLast = (now.getTime() - new Date(previous.timestampISO).getTime()) / 60000
  if (minutesSinceLast > config.alerts.travelWindowMinutes) return null

  return {
    type: 'IMPOSSIBLE_TRAVEL',
    description:
      `Login de um IP diferente ${Math.round(minutesSinceLast)} minuto(s) apos o acesso anterior - ` +
      'intervalo curto demais para um deslocamento fisico real.',
    details: {
      previousIp: previous.ip,
      currentIp,
      minutesSinceLastAccess: Math.round(minutesSinceLast),
      configuredWindowMinutes: config.alerts.travelWindowMinutes,
    },
  }
}

// ─── Envio do alerta ──────────────────────────────────────────────────────────

/**
 * Dispara o webhook.
 *
 * safeFetch (e não fetch cru) é obrigatório: a URL vem de variável de ambiente e
 * um POST para destino configurável é exatamente o padrão de SSRF que o CodeQL
 * apontou no túnel do Sentry. Sem essa guarda, um webhook mal configurado
 * apontando para a rede interna transformaria o alerta num scanner da rede da
 * prefeitura — e a resposta de cada tentativa revelaria o que existe lá dentro.
 */
async function sendWebhook(anomalies: Anomaly[], context: LoginContext): Promise<void> {
  const url = config.alerts.webhookUrl
  if (!url) return // alertas desligados

  const body = {
    event: 'SUSPICIOUS_ACCESS',
    occurredAt: (context.timestamp ?? new Date()).toISOString(),
    user: { id: context.userId, email: context.email },
    organizationId: context.organizationId ?? null,
    origin: { ip: context.ip, userAgent: context.userAgent ?? null },
    anomalies: anomalies.map(a => ({
      type: a.type,
      description: a.description,
      details: a.details,
    })),
  }

  // Timeout curto: o alerta não pode segurar recurso do servidor esperando um
  // destino lento. Sem redirecionamento — um webhook legítimo não redireciona,
  // e seguir 30x seria mais uma porta para SSRF.
  await safeFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: 3000, maxRedirects: 0 },
  )
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const securityAlertService = {
  /**
   * Avalia um login e dispara alerta se houver anomalia.
   *
   * NÃO deve ser aguardado pelo fluxo de login (fire-and-forget): nunca lança e
   * nunca bloqueia. Qualquer falha interna vira log em pt-BR.
   */
  async evaluateLogin(context: LoginContext): Promise<void> {
    try {
      const now = context.timestamp ?? new Date()
      const key = `${LAST_ACCESS_PREFIX}${context.userId}`

      // Falha do Redis não pode impedir a regra de horário, que não depende dele.
      let previous: LastAccess | null = null
      try {
        previous = await redis.getJSON<LastAccess>(key)
      } catch (error) {
        logger.warn({ error }, 'Nao foi possivel ler o ultimo acesso no Redis; seguindo sem a regra de deslocamento')
      }

      const anomalies = [
        detectEarlyMorningLogin(now),
        detectImpossibleTravel(context.ip, previous, now),
      ].filter((a): a is Anomaly => a !== null)

      // Registra o acesso atual mesmo sem anomalia — é a base de comparação do
      // próximo login.
      try {
        await redis.setJSON(
          key,
          { ip: context.ip, timestampISO: now.toISOString() } satisfies LastAccess,
          LAST_ACCESS_TTL_SECONDS,
        )
      } catch (error) {
        logger.warn({ error }, 'Nao foi possivel registrar o ultimo acesso no Redis')
      }

      if (anomalies.length === 0) return

      logger.warn(
        {
          userId: context.userId,
          email: context.email,
          ip: context.ip,
          anomalies: anomalies.map(a => a.type),
        },
        'Acesso suspeito detectado',
      )

      // A trilha de auditoria guarda o alerta mesmo que o webhook falhe — o
      // registro imutável é a fonte de verdade, o webhook é só a notificação.
      await auditLedgerService.record({
        userId: context.userId,
        action: 'SUSPICIOUS_ACCESS_DETECTED',
        resource: 'SECURITY',
        resourceId: context.userId,
        ip: context.ip,
        organizationId: context.organizationId ?? null,
        userAgent: context.userAgent ?? null,
        // JSON.parse(JSON.stringify(...)) normaliza para o InputJsonValue do
        // Prisma, que não aceita tipos estruturais diretamente.
        details: JSON.parse(JSON.stringify({ anomalies })) as Prisma.InputJsonValue,
      })

      try {
        await sendWebhook(anomalies, context)
      } catch (error) {
        // Webhook fora do ar, lento ou apontando para rede interna (recusado
        // pelo safeFetch): nada disso pode afetar o login já concluído.
        logger.error(
          { error, userId: context.userId },
          'Falha ao enviar alerta de seguranca para o webhook',
        )
      }
    } catch (error) {
      // Rede de segurança final: nenhuma exceção escapa deste serviço.
      logger.error({ error }, 'Falha inesperada ao avaliar anomalias de login')
    }
  },
}
