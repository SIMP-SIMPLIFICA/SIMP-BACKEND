/**
 * Banimento de IP com armazenamento em Redis e cache local.
 *
 * DUAS CAMADAS, de propósito:
 *
 *  - **Redis** é a fonte compartilhada. Sem ele, um ban aplicado numa instância do
 *    Render não valeria nas outras — o atacante simplesmente cairia noutro processo
 *    no próximo request.
 *  - **Memória local** serve como cache (evita ida ao Redis a cada requisição, e a
 *    verificação roda em TODAS elas) e como plano B quando o Redis está fora.
 *
 * FALHA ABERTA por decisão explícita: se o Redis cair, requisições passam. O
 * inverso (negar tudo que não conseguimos verificar) transformaria uma queda de
 * cache numa indisponibilidade total do sistema para prefeituras inteiras — dano
 * muito maior do que deixar um bot passar por alguns minutos.
 */

import { config } from '@/config/config.js'
import { logSecurity, logger } from '@/utils/logger.js'
import { redisClient } from '@/utils/redis.js'
import { isPrivateAddress } from '@/utils/url-security.js'

const BAN_PREFIX = 'honeypot:ban:'
const STRIKE_PREFIX = 'honeypot:strike:'

/** Cache local: ip -> instante (epoch ms) em que o ban expira. */
const localBans = new Map<string, number>()

/** Strikes em memória, para quando o Redis não estiver disponível. */
const localStrikes = new Map<string, { count: number; expiresAt: number }>()

/**
 * Por quanto tempo um resultado do Redis vale no cache local.
 *
 * Curto de propósito: um ban aplicado em outra instância precisa se propagar
 * rápido, e um desbanimento manual não pode demorar minutos para valer.
 */
const LOCAL_CACHE_TTL_MS = 30_000

export interface BanInfo {
  reason: string
  bannedAt: string
  expiresAt: string
}

function redisAvailable(): boolean {
  return redisClient.isOpen && redisClient.isReady
}

/** Remove entradas vencidas para o Map não crescer sem limite. */
function pruneLocal(now: number): void {
  for (const [ip, expiresAt] of localBans) {
    if (expiresAt <= now) localBans.delete(ip)
  }
  for (const [ip, entry] of localStrikes) {
    if (entry.expiresAt <= now) localStrikes.delete(ip)
  }
}

/**
 * IPs que nunca devem ser banidos.
 *
 * Além da allowlist configurada, endereços privados/loopback são sempre isentos:
 * banir 127.0.0.1 ou a faixa interna derrubaria health checks e o próprio tráfego
 * entre serviços.
 */
export function isBanExempt(ip: string): boolean {
  if (!ip) return true
  if (config.honeypot.allowlist.includes(ip)) return true
  return isPrivateAddress(ip)
}

export async function isIpBanned(ip: string): Promise<boolean> {
  if (!config.honeypot.enabled) return false
  if (isBanExempt(ip)) return false

  const now = Date.now()

  const cached = localBans.get(ip)
  if (cached !== undefined) {
    if (cached > now) return true
    localBans.delete(ip)
  }

  if (!redisAvailable()) return false // falha aberta — ver cabeçalho

  try {
    const exists = await redisClient.exists(BAN_PREFIX + ip)
    if (exists) {
      // Guarda no cache local só pelo TTL curto, não pelo TTL do ban: assim um
      // desbanimento manual no Redis se propaga em segundos.
      localBans.set(ip, now + LOCAL_CACHE_TTL_MS)
      return true
    }
    return false
  } catch (err) {
    logger.error({ err, ip }, 'Honeypot: falha ao consultar ban no Redis')
    return false
  }
}

export async function banIp(ip: string, reason: string, ttlSeconds = config.honeypot.banTtl): Promise<boolean> {
  if (!config.honeypot.enabled) return false

  if (isBanExempt(ip)) {
    logSecurity('Honeypot trap ignorada para IP isento', 'low', { ip, reason })
    return false
  }

  const now = Date.now()
  const info: BanInfo = {
    reason,
    bannedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  }

  localBans.set(ip, now + ttlSeconds * 1000)
  pruneLocal(now)

  if (redisAvailable()) {
    try {
      await redisClient.setEx(BAN_PREFIX + ip, ttlSeconds, JSON.stringify(info))
    } catch (err) {
      logger.error({ err, ip }, 'Honeypot: falha ao gravar ban no Redis (ban vale só nesta instância)')
    }
  }

  logSecurity('IP banido por honeypot', 'high', { ip, reason, expiresAt: info.expiresAt })
  return true
}

export async function unbanIp(ip: string): Promise<void> {
  localBans.delete(ip)
  if (!redisAvailable()) return
  try {
    await redisClient.del(BAN_PREFIX + ip)
    await redisClient.del(STRIKE_PREFIX + ip)
  } catch (err) {
    logger.error({ err, ip }, 'Honeypot: falha ao remover ban do Redis')
  }
}

export async function getBanInfo(ip: string): Promise<BanInfo | null> {
  if (!redisAvailable()) return null
  try {
    const raw = await redisClient.get(BAN_PREFIX + ip)
    return raw ? (JSON.parse(raw) as BanInfo) : null
  } catch {
    return null
  }
}

/**
 * Registra um strike e bane quando o limite é atingido.
 *
 * Usado pelos sinais AMBÍGUOS (campo-isca preenchido). Ver comentário de
 * HONEYPOT_FIELD_STRIKES em config.ts para o porquê de não banir na primeira.
 *
 * @returns `true` se este strike causou o banimento.
 */
export async function registerStrike(
  ip: string,
  reason: string,
  limit = config.honeypot.fieldStrikes,
): Promise<boolean> {
  if (!config.honeypot.enabled) return false
  if (isBanExempt(ip)) return false

  const now = Date.now()
  const windowSeconds = config.honeypot.banTtl
  let count: number

  if (redisAvailable()) {
    try {
      count = await redisClient.incr(STRIKE_PREFIX + ip)
      if (count === 1) await redisClient.expire(STRIKE_PREFIX + ip, windowSeconds)
    } catch (err) {
      logger.error({ err, ip }, 'Honeypot: falha ao contar strike no Redis')
      count = bumpLocalStrike(ip, now, windowSeconds)
    }
  } else {
    count = bumpLocalStrike(ip, now, windowSeconds)
  }

  logSecurity('Honeypot strike registrado', 'medium', { ip, reason, count, limit })

  if (count >= limit) {
    await banIp(ip, `${reason} (${count} ocorrências)`)
    return true
  }
  return false
}

function bumpLocalStrike(ip: string, now: number, windowSeconds: number): number {
  const entry = localStrikes.get(ip)
  if (entry && entry.expiresAt > now) {
    entry.count += 1
    return entry.count
  }
  localStrikes.set(ip, { count: 1, expiresAt: now + windowSeconds * 1000 })
  pruneLocal(now)
  return 1
}

/** Só para testes — zera o estado em memória entre casos. */
export function __resetLocalState(): void {
  localBans.clear()
  localStrikes.clear()
}
