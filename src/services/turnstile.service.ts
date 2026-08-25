/**
 * Cloudflare Turnstile — verificação server-side do token anti-bot.
 *
 * O widget no frontend produz um token opaco e de uso único. Esse token só tem
 * valor quando o SERVIDOR o troca com a Cloudflare: o frontend pode ser modificado
 * à vontade por quem controla o navegador, então "o widget passou" nunca é prova
 * de nada. A prova é a resposta do /siteverify.
 *
 * Sem dependências novas: usa `safeFetch` (Task 1.1), que já garante que o destino
 * é público e que nenhum redirecionamento leva à rede interna.
 */

import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { safeFetch } from '@/utils/url-security.js'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Header onde o frontend envia o token. */
export const TURNSTILE_HEADER = 'x-turnstile-token'

export interface TurnstileResult {
  success: boolean
  /** Códigos de erro da Cloudflare, quando houver. */
  errorCodes: string[]
  /** `true` quando a verificação foi pulada por estar desabilitada. */
  skipped: boolean
}

interface SiteverifyResponse {
  success?: boolean
  'error-codes'?: string[]
  challenge_ts?: string
  hostname?: string
  action?: string
}

/**
 * Erros que indicam problema de CONFIGURAÇÃO nossa, não bot.
 * Devem virar 500 e alarme, não 403 — senão um segredo errado no deploy aparece
 * como "todos os usuários viraram robôs" e ninguém descobre a causa.
 */
const CONFIG_ERROR_CODES = new Set([
  'invalid-input-secret',
  'missing-input-secret',
  'bad-request',
])

export class TurnstileConfigError extends Error {
  readonly statusCode = 500
  constructor(public readonly errorCodes: string[]) {
    super('Falha de configuração na verificação anti-bot.')
    this.name = 'TurnstileConfigError'
  }
}

/**
 * Troca o token com a Cloudflare.
 *
 * @param token   Valor recebido do frontend.
 * @param remoteIp IP do cliente resolvido por `request.ip` (já saneado pelo
 *                 trustProxy numérico da Task 1.3 — nunca ler de header aqui).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!config.turnstile.enabled) {
    return { success: true, errorCodes: [], skipped: true }
  }

  const secret = config.turnstile.secretKey
  if (!secret) {
    // Em produção o config.ts já teria abortado o boot. Aqui é dev/staging com
    // TURNSTILE_ENABLED=true e segredo faltando: falha explícita, não silenciosa.
    throw new TurnstileConfigError(['missing-input-secret'])
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'], skipped: false }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  let payload: SiteverifyResponse
  try {
    const res = await safeFetch(
      SITEVERIFY_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      { maxRedirects: 0, timeoutMs: 5000 },
    )

    if (!res.ok) {
      throw new Error(`siteverify respondeu HTTP ${res.status}`)
    }

    payload = (await res.json()) as SiteverifyResponse
  } catch (err) {
    // Indisponibilidade da Cloudflare NÃO pode virar 403: seria um bloqueio total
    // do login por causa de rede. Vira 500 para o cliente poder repetir, e alarme
    // para nós. Fail-closed sem transformar incidente de terceiro em "sua conta
    // foi bloqueada".
    logger.error({ err }, 'Turnstile: falha ao contatar o siteverify')
    throw new TurnstileConfigError(['network-error'])
  }

  const errorCodes = payload['error-codes'] ?? []

  if (errorCodes.some(code => CONFIG_ERROR_CODES.has(code))) {
    logger.error({ errorCodes }, 'Turnstile: erro de configuração (segredo inválido?)')
    throw new TurnstileConfigError(errorCodes)
  }

  return { success: payload.success === true, errorCodes, skipped: false }
}
