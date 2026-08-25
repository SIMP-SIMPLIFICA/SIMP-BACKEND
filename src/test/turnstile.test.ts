import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O service lê config e usa safeFetch — ambos precisam ser controláveis aqui.
vi.mock('@/config/config.js', () => ({
  config: {
    isProduction: false,
    turnstile: { enabled: true, secretKey: 'segredo-de-teste' },
  },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  logSecurity: vi.fn(),
}))

const safeFetchMock = vi.fn()
vi.mock('@/utils/url-security.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

const { config } = await import('@/config/config.js')
const { TurnstileConfigError, verifyTurnstileToken } = await import('@/services/turnstile.service.js')

function siteverifyResponse(payload: Record<string, unknown>, ok = true, status = 200) {
  return { ok, status, json: async () => payload }
}

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    safeFetchMock.mockReset()
    ;(config as { turnstile: { enabled: boolean; secretKey?: string } }).turnstile = {
      enabled: true,
      secretKey: 'segredo-de-teste',
    }
  })

  afterEach(() => vi.clearAllMocks())

  it('aceita quando a Cloudflare confirma o token', async () => {
    safeFetchMock.mockResolvedValue(siteverifyResponse({ success: true }))

    const result = await verifyTurnstileToken('token-valido', '203.0.113.10')

    expect(result).toEqual({ success: true, errorCodes: [], skipped: false })
  })

  it('RECUSA quando a Cloudflare reprova o token — bot detectado', async () => {
    safeFetchMock.mockResolvedValue(
      siteverifyResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
    )

    const result = await verifyTurnstileToken('token-forjado')

    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('invalid-input-response')
  })

  it('recusa token ausente sem sequer chamar a Cloudflare', async () => {
    const result = await verifyTurnstileToken(undefined)

    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('missing-input-response')
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('recusa token já usado (replay)', async () => {
    safeFetchMock.mockResolvedValue(
      siteverifyResponse({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    )

    const result = await verifyTurnstileToken('token-reaproveitado')

    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('timeout-or-duplicate')
  })

  it('pula a verificação quando desabilitada', async () => {
    ;(config as { turnstile: { enabled: boolean } }).turnstile.enabled = false

    const result = await verifyTurnstileToken(undefined)

    expect(result).toEqual({ success: true, errorCodes: [], skipped: true })
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('envia secret, response e remoteip no corpo', async () => {
    safeFetchMock.mockResolvedValue(siteverifyResponse({ success: true }))

    await verifyTurnstileToken('abc', '198.51.100.7')

    const [url, init] = safeFetchMock.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')

    const body = new URLSearchParams(init.body as string)
    expect(body.get('secret')).toBe('segredo-de-teste')
    expect(body.get('response')).toBe('abc')
    expect(body.get('remoteip')).toBe('198.51.100.7')
  })

  it('omite remoteip quando não informado', async () => {
    safeFetchMock.mockResolvedValue(siteverifyResponse({ success: true }))

    await verifyTurnstileToken('abc')

    const body = new URLSearchParams(safeFetchMock.mock.calls[0][1].body as string)
    expect(body.has('remoteip')).toBe(false)
  })

  it.each(['invalid-input-secret', 'missing-input-secret', 'bad-request'])(
    'trata %s como erro de CONFIGURAÇÃO (500), não como bot (403)',
    async code => {
      safeFetchMock.mockResolvedValue(siteverifyResponse({ success: false, 'error-codes': [code] }))

      await expect(verifyTurnstileToken('x')).rejects.toBeInstanceOf(TurnstileConfigError)
    },
  )

  it('indisponibilidade da Cloudflare vira erro de config, não recusa do usuário', async () => {
    safeFetchMock.mockRejectedValue(new Error('ECONNRESET'))

    await expect(verifyTurnstileToken('x')).rejects.toBeInstanceOf(TurnstileConfigError)
  })

  it('resposta HTTP não-ok também vira erro de config', async () => {
    safeFetchMock.mockResolvedValue(siteverifyResponse({}, false, 502))

    await expect(verifyTurnstileToken('x')).rejects.toBeInstanceOf(TurnstileConfigError)
  })

  it('habilitado sem segredo falha explicitamente', async () => {
    ;(config as { turnstile: { secretKey?: string } }).turnstile.secretKey = undefined

    await expect(verifyTurnstileToken('x')).rejects.toBeInstanceOf(TurnstileConfigError)
  })
})
