import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const honeypotConfig = {
  enabled: true,
  banTtl: 86400,
  fieldStrikes: 3,
  allowlist: [] as string[],
}

vi.mock('@/config/config.js', () => ({
  config: { honeypot: honeypotConfig },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  logSecurity: vi.fn(),
}))

// Redis "fora do ar": exercita o caminho em que só o cache local sustenta o ban.
vi.mock('@/utils/redis.js', () => ({
  redisClient: { isOpen: false, isReady: false },
}))

const { __resetLocalState } = await import('@/services/ip-ban.service.js')
const { honeypotFieldGuard, honeypotGuard, registerHoneypotRoutes } =
  await import('@/middleware/honeypot.middleware.js')

/** Sobe um servidor com o mesmo encadeamento de hooks do routes.ts real. */
async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()

  app.addHook('onRequest', honeypotGuard)
  registerHoneypotRoutes(app as never)

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/v1/qualquer-coisa', async () => ({ ok: true }))
  app.post(
    '/api/v1/auth/login',
    { preHandler: honeypotFieldGuard },
    async () => ({ ok: true }),
  )

  await app.ready()
  return app
}

const ATACANTE = '45.79.12.77'
const LEGITIMO = '45.79.12.10'

let app: FastifyInstance

beforeEach(async () => {
  __resetLocalState()
  honeypotConfig.enabled = true
  honeypotConfig.allowlist = []
  honeypotConfig.fieldStrikes = 3
  app = await buildServer()
})

describe('rotas-isca', () => {
  it.each(['/.env', '/wp-admin', '/api/v1/debug/env', '/.git/config', '/phpmyadmin'])(
    'responde 403 ao acessar %s',
    async path => {
      const res = await app.inject({ method: 'GET', url: path, remoteAddress: ATACANTE })
      expect(res.statusCode).toBe(403)
    },
  )

  it('BANE o IP: rota legítima passa a ser 403 depois da isca', async () => {
    // antes: acesso normal
    const antes = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: ATACANTE,
    })
    expect(antes.statusCode).toBe(200)

    // pisa na isca
    await app.inject({ method: 'GET', url: '/.env', remoteAddress: ATACANTE })

    // depois: bloqueado em TODAS as rotas
    const depois = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: ATACANTE,
    })
    expect(depois.statusCode).toBe(403)
  })

  it('não afeta outros IPs', async () => {
    await app.inject({ method: 'GET', url: '/.env', remoteAddress: ATACANTE })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: LEGITIMO,
    })
    expect(res.statusCode).toBe(200)
  })

  it('/health continua respondendo mesmo para IP banido', async () => {
    await app.inject({ method: 'GET', url: '/.env', remoteAddress: ATACANTE })

    const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: ATACANTE })
    expect(res.statusCode).toBe(200)
  })

  it('a isca responde igual a um IP já banido — não dá para distinguir sondando', async () => {
    const naIsca = await app.inject({ method: 'GET', url: '/.env', remoteAddress: ATACANTE })
    const banido = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: ATACANTE,
    })

    expect(naIsca.json()).toMatchObject({ statusCode: 403, error: 'Forbidden' })
    expect(banido.json()).toMatchObject({ statusCode: 403, error: 'Forbidden' })
  })

  it('captura também em POST', async () => {
    const res = await app.inject({ method: 'POST', url: '/wp-login.php', remoteAddress: ATACANTE })
    expect(res.statusCode).toBe(403)
  })
})

describe('campo-isca no login', () => {
  const credenciais = { email: 'a@b.com', password: 'x' }

  it('deixa passar quando o campo vem vazio — usuário real', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: LEGITIMO,
      payload: { ...credenciais, phone_fax: '' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('deixa passar quando o campo nem existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: LEGITIMO,
      payload: credenciais,
    })
    expect(res.statusCode).toBe(200)
  })

  it('recusa com 403 quando o campo vem preenchido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ATACANTE,
      payload: { ...credenciais, phone_fax: 'http://spam.example' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('NÃO bane na primeira: a rota legítima segue acessível', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ATACANTE,
      payload: { ...credenciais, phone_fax: 'bot' },
    })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: ATACANTE,
    })
    expect(res.statusCode).toBe(200)
  })

  it('bane após atingir o limite de strikes', async () => {
    for (let i = 0; i < honeypotConfig.fieldStrikes; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: ATACANTE,
        payload: { ...credenciais, phone_fax: 'bot' },
      })
    }

    const res = await app.inject({
      method: 'GET', url: '/api/v1/qualquer-coisa', remoteAddress: ATACANTE,
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('honeypot desligado', () => {
  it('não registra as rotas-isca nem bloqueia', async () => {
    honeypotConfig.enabled = false
    const semHoneypot = await buildServer()

    const res = await semHoneypot.inject({
      method: 'GET', url: '/.env', remoteAddress: ATACANTE,
    })
    expect(res.statusCode).toBe(404)
  })
})
