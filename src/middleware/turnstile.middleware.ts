/**
 * Middleware de verificação anti-bot (Cloudflare Turnstile).
 *
 * Use como `preHandler` nas rotas públicas sensíveis. Retorna 403 quando o token
 * está ausente, é inválido ou já foi usado.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { logSecurity } from '@/utils/logger.js'
import {
  TURNSTILE_HEADER,
  TurnstileConfigError,
  verifyTurnstileToken,
} from '@/services/turnstile.service.js'

/**
 * Lê o token do header `x-turnstile-token` ou, como alternativa, do corpo
 * (`turnstileToken`).
 *
 * Aceitar os dois é prático: formulários que já mandam JSON não precisam montar um
 * header extra, e clientes que preferem header não precisam alterar o payload. O
 * header tem precedência.
 */
function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers[TURNSTILE_HEADER]
  if (typeof header === 'string' && header.trim()) return header.trim()

  const body = request.body as { turnstileToken?: unknown } | undefined
  if (typeof body?.turnstileToken === 'string' && body.turnstileToken.trim()) {
    return body.turnstileToken.trim()
  }

  return undefined
}

export async function turnstileMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(request)

  try {
    // `request.ip` e não header: com o trustProxy numérico da Task 1.3 este valor
    // é o que o proxy confiável observou. Passar um IP forjado para a Cloudflare
    // enfraqueceria a própria análise dela.
    const result = await verifyTurnstileToken(token, request.ip)

    if (result.skipped) return
    if (result.success) return

    logSecurity('Turnstile verification failed', 'medium', {
      ip: request.ip,
      url: request.url,
      errorCodes: result.errorCodes,
    })

    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Falha na verificação de segurança. Recarregue a página e tente novamente.',
      requestId: request.id,
    })
  } catch (err) {
    if (err instanceof TurnstileConfigError) {
      // 500, não 403: o problema é nosso. Ver comentário em turnstile.service.ts.
      return reply.code(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Verificação de segurança temporariamente indisponível. Tente novamente.',
        requestId: request.id,
      })
    }
    throw err
  }
}
