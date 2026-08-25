/**
 * HoneypotTrap — rotas-isca e bloqueio global de IPs banidos.
 *
 * Duas peças:
 *
 *  1. `honeypotGuard` — hook `onRequest` global. Recusa com 403, antes de qualquer
 *     processamento, todo IP que já esteja na lista de banidos.
 *  2. `registerHoneypotRoutes` — rotas que não existem no produto e que nenhum
 *     cliente legítimo pediria (`/.env`, `/wp-admin`). Quem as acessa está
 *     varrendo o servidor, e é banido na hora.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppServer } from '@/types/server'
import { config } from '@/config/config.js'
import { logSecurity } from '@/utils/logger.js'
import { banIp, isIpBanned, registerStrike } from '@/services/ip-ban.service.js'

/**
 * Caminhos-isca. Todos são alvos clássicos de scanner automatizado e nenhum
 * corresponde a funcionalidade real do SIMP.
 *
 * Não incluir aqui nada parecido com rota legítima: um caminho ambíguo
 * transformaria um erro de digitação do frontend num banimento de 24h.
 */
export const HONEYPOT_PATHS = [
  '/.env',
  '/.env.local',
  '/.git/config',
  '/wp-admin',
  '/wp-login.php',
  '/phpmyadmin',
  '/api/v1/wp-admin',
  '/api/v1/debug/env',
  '/api/v1/debug/config',
  '/actuator/env',
  '/config.json',
  '/.aws/credentials',
] as const

/**
 * Rotas isentas do bloqueio.
 *
 * `/health` fica de fora para que um banimento acidental do IP do monitoramento
 * não faça o serviço parecer fora do ar e dispare um rollback automático.
 */
const EXEMPT_PATHS = new Set(['/health', '/status'])

/**
 * Nome do campo-isca no formulário de login.
 *
 * Escolhido para parecer plausível a um bot que preenche tudo que encontra, sem
 * ser um tipo que o autofill do navegador reconheça (evitar `phone`, `tel`,
 * `address` puros, que gerenciadores de senha preenchem sozinhos).
 */
export const HONEYPOT_FIELD = 'phone_fax'

/** Hook global: corta requisições de IPs banidos antes de qualquer trabalho. */
export async function honeypotGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!config.honeypot.enabled) return

  const path = request.url.split('?')[0]
  if (EXEMPT_PATHS.has(path)) return

  // `request.ip` — resolvido pelo trustProxy numérico da Task 1.3. Ler o IP de
  // header aqui seria pior que inútil: um atacante escolheria qual IP banir e
  // poderia tirar terceiros do ar.
  if (await isIpBanned(request.ip)) {
    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Acesso bloqueado.',
      requestId: request.id,
    })
  }
}

/**
 * Registra as rotas-isca. Devem ser registradas ANTES do notFoundHandler para
 * que a captura aconteça em vez de um 404 comum.
 */
export function registerHoneypotRoutes(server: AppServer) {
  if (!config.honeypot.enabled) return

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    logSecurity('Honeypot acessado', 'high', {
      ip: request.ip,
      path: request.url,
      method: request.method,
      userAgent: request.headers['user-agent'],
    })

    await banIp(request.ip, `Acesso a rota-isca ${request.url}`)

    // 403 e não 404: o objetivo não é fingir que a rota não existe (o scanner já
    // sabe o que pediu), e sim já sinalizar o bloqueio. A resposta é idêntica à
    // de um IP banido, então não há como distinguir uma coisa da outra sondando.
    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Acesso bloqueado.',
      requestId: request.id,
    })
  }

  for (const path of HONEYPOT_PATHS) {
    server.route({ method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'], url: path, handler })
  }
}

/**
 * Verifica o campo-isca no corpo de um formulário.
 *
 * Sinal AMBÍGUO — por isso acumula strikes em vez de banir na primeira. Alguns
 * gerenciadores de senha preenchem campos ocultos, e um falso positivo aqui
 * tiraria um servidor público inteiro do ar por 24 horas.
 *
 * @returns `true` quando a requisição deve ser recusada.
 */
export async function checkHoneypotField(request: FastifyRequest): Promise<boolean> {
  if (!config.honeypot.enabled) return false

  const body = request.body as Record<string, unknown> | undefined
  const value = body?.[HONEYPOT_FIELD]

  if (typeof value !== 'string' || value.trim() === '') return false

  await registerStrike(request.ip, `Campo-isca "${HONEYPOT_FIELD}" preenchido`)
  return true
}

/** preHandler para formulários públicos que expõem o campo-isca. */
export async function honeypotFieldGuard(request: FastifyRequest, reply: FastifyReply) {
  if (await checkHoneypotField(request)) {
    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Acesso bloqueado.',
      requestId: request.id,
    })
  }
}
