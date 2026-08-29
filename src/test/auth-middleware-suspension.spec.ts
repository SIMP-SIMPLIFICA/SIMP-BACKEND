import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Kill switch — bloqueio de organização suspensa no `authenticate`.
 *
 * O prisma é mockado para que estes testes exercitem a REGRA (quem passa, quem é
 * barrado e em que ordem), não a conectividade com o banco.
 */

const findUniqueMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    organizationModule: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

const { authenticate, invalidateOrgStatusCache } = await import('../middleware/auth.middleware.js')
const { calculateFingerprint } = await import('../services/fingerprint.service.js')

const TEST_IP = '203.0.113.10'
const TEST_UA = 'Mozilla/5.0 (Teste)'

/**
 * Request falso. O payload recebe o claim `fp` correspondente ao IP/User-Agent
 * da própria requisição — assim a checagem de fingerprint (Task 2.2) passa e os
 * testes exercitam de fato o kill switch, que é o objeto desta suíte.
 */
function makeRequest(user: Record<string, unknown>, options?: { fp?: string; ip?: string }) {
  const ip = options?.ip ?? TEST_IP
  const fp = options?.fp ?? calculateFingerprint(ip, TEST_UA)

  return {
    method: 'GET',
    query: {},
    headers: { 'user-agent': TEST_UA },
    ip,
    user: { ...user, fp },
    log: { warn: vi.fn() },
    jwtVerify: vi.fn().mockResolvedValue(user),
  } as never
}

/** Reply falso que registra o status e o corpo enviados. */
function makeReply() {
  const state: { statusCode?: number; payload?: Record<string, unknown> } = {}
  const reply = {
    code(status: number) { state.statusCode = status; return reply },
    send(payload: Record<string, unknown>) { state.payload = payload; return reply },
    state,
  }
  return reply as never as { code: (s: number) => unknown; send: (p: unknown) => unknown; state: typeof state }
}

const ORG_ID = 'org-suspensa-1'

describe('Kill switch — organização suspensa em authenticate()', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    // O status é cacheado em memória; sem limpar, um teste contaminaria o outro.
    invalidateOrgStatusCache(ORG_ID)
  })

  test('usuário de organização ATIVA passa', async () => {
    findUniqueMock.mockResolvedValue({ isActive: true })
    const reply = makeReply()

    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), reply as never)

    expect(reply.state.statusCode).toBeUndefined()
  })

  test('usuário de organização SUSPENSA é barrado com 403 e código próprio', async () => {
    findUniqueMock.mockResolvedValue({ isActive: false })
    const reply = makeReply()

    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), reply as never)

    expect(reply.state.statusCode).toBe(403)
    expect(reply.state.payload).toMatchObject({ error: 'ORGANIZATION_SUSPENDED' })
  })

  test('organização inexistente é tratada como suspensa (falha fechada)', async () => {
    findUniqueMock.mockResolvedValue(null)
    const reply = makeReply()

    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), reply as never)

    expect(reply.state.statusCode).toBe(403)
  })

  test('SUPER ADMIN nunca é barrado — nem sequer consulta a organização', async () => {
    // Este é o teste mais importante da suíte: se a checagem de super admin
    // viesse DEPOIS da consulta, suspender todas as organizações bloquearia o
    // próprio super admin, tornando a reativação impossível pela interface.
    findUniqueMock.mockResolvedValue({ isActive: false })
    const reply = makeReply()

    await authenticate(makeRequest({ id: 'sa', organizationId: ORG_ID, isSuperAdmin: true }), reply as never)

    expect(reply.state.statusCode).toBeUndefined()
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  test('usuário sem organização passa — não há organização para estar suspensa', async () => {
    const reply = makeReply()

    await authenticate(makeRequest({ id: 'u2', organizationId: null, isSuperAdmin: false }), reply as never)

    expect(reply.state.statusCode).toBeUndefined()
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  test('requisições OPTIONS (preflight CORS) não são bloqueadas', async () => {
    const reply = makeReply()
    const request = { ...(makeRequest({}) as object), method: 'OPTIONS' } as never

    await authenticate(request, reply as never)

    expect(reply.state.statusCode).toBeUndefined()
  })

  test('reativação vale na requisição seguinte após invalidar o cache', async () => {
    findUniqueMock.mockResolvedValue({ isActive: false })
    const barrado = makeReply()
    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), barrado as never)
    expect(barrado.state.statusCode).toBe(403)

    // Simula a reativação pelo painel, que chama invalidateOrgStatusCache()
    findUniqueMock.mockResolvedValue({ isActive: true })
    invalidateOrgStatusCache(ORG_ID)

    const liberado = makeReply()
    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), liberado as never)
    expect(liberado.state.statusCode).toBeUndefined()
  })

  test('token usado de OUTRA faixa de rede é recusado antes do kill switch', async () => {
    // Fingerprint gerado para uma rede e apresentado a partir de outra: é o
    // cenário de token roubado. Deve cair em 401 antes mesmo de consultar a
    // organização — inclusive para super admin.
    findUniqueMock.mockResolvedValue({ isActive: true })
    const reply = makeReply()

    const request = makeRequest(
      { id: 'u1', organizationId: ORG_ID, isSuperAdmin: false },
      { fp: calculateFingerprint('189.40.12.7', TEST_UA) }
    )

    await authenticate(request, reply as never)

    expect(reply.state.statusCode).toBe(401)
    expect(reply.state.payload).toMatchObject({ error: 'SESSION_INVALIDATED' })
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  test('o status é cacheado — consultas repetidas não vão ao banco toda vez', async () => {
    findUniqueMock.mockResolvedValue({ isActive: true })

    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), makeReply() as never)
    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), makeReply() as never)
    await authenticate(makeRequest({ id: 'u1', organizationId: ORG_ID, isSuperAdmin: false }), makeReply() as never)

    expect(findUniqueMock).toHaveBeenCalledTimes(1)
  })
})
