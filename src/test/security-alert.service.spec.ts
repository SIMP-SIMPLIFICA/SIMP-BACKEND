import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Alertas de anomalia comportamental (Épico 2, Task 2.3).
 *
 * Redis, webhook e auditoria são mockados: o que importa aqui é a REGRA de
 * detecção e a garantia de que nada disso derruba o login.
 */

const getJSONMock = vi.fn()
const setJSONMock = vi.fn()
const safeFetchMock = vi.fn()
const recordMock = vi.fn()
const loggerErrorMock = vi.fn()
const loggerWarnMock = vi.fn()

vi.mock('@/utils/redis.js', () => ({
  redis: {
    getJSON: (...a: unknown[]) => getJSONMock(...a),
    setJSON: (...a: unknown[]) => setJSONMock(...a),
  },
}))

vi.mock('@/utils/url-security.js', () => ({
  safeFetch: (...a: unknown[]) => safeFetchMock(...a),
}))

vi.mock('@/services/audit-ledger.service.js', () => ({
  auditLedgerService: { record: (...a: unknown[]) => recordMock(...a) },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { error: loggerErrorMock, warn: loggerWarnMock, info: vi.fn() },
}))

vi.mock('@/config/config.js', () => ({
  config: {
    alerts: {
      webhookUrl: 'https://webhook.exemplo.com/alertas',
      earlyMorningStartHour: 1,
      earlyMorningEndHour: 5,
      travelWindowMinutes: 60,
    },
  },
}))

const { securityAlertService, detectEarlyMorningLogin, detectImpossibleTravel } =
  await import('../services/security-alert.service.js')

/** Data em hora LOCAL — a regra de madrugada usa o fuso do servidor. */
function atLocalHour(hour: number): Date {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d
}

const BASE_CONTEXT = {
  userId: 'u-1',
  email: 'servidor@prefeitura.gov.br',
  ip: '201.17.45.98',
  organizationId: 'org-1',
}

describe('Alertas de anomalia comportamental (Task 2.3)', () => {
  beforeEach(() => {
    getJSONMock.mockReset().mockResolvedValue(null)
    setJSONMock.mockReset().mockResolvedValue(undefined)
    safeFetchMock.mockReset().mockResolvedValue({ status: 200 })
    recordMock.mockReset().mockResolvedValue(undefined)
    loggerErrorMock.mockReset()
    loggerWarnMock.mockReset()
  })

  describe('regra de horário (madrugada)', () => {
    test('01h dispara alerta (limite inferior da janela)', () => {
      expect(detectEarlyMorningLogin(atLocalHour(1))?.type).toBe('EARLY_MORNING_LOGIN')
    })

    test('05h dispara alerta (limite superior da janela)', () => {
      expect(detectEarlyMorningLogin(atLocalHour(5))?.type).toBe('EARLY_MORNING_LOGIN')
    })

    test('03h dispara alerta (meio da janela)', () => {
      expect(detectEarlyMorningLogin(atLocalHour(3))).not.toBeNull()
    })

    test('09h em pleno expediente NÃO dispara', () => {
      expect(detectEarlyMorningLogin(atLocalHour(9))).toBeNull()
    })

    test('00h fica fora da janela configurada (1h-5h)', () => {
      expect(detectEarlyMorningLogin(atLocalHour(0))).toBeNull()
    })

    test('06h, logo após a janela, NÃO dispara', () => {
      expect(detectEarlyMorningLogin(atLocalHour(6))).toBeNull()
    })
  })

  describe('regra de deslocamento impossível', () => {
    const now = new Date('2026-08-28T14:00:00.000Z')

    test('primeiro login do usuário não dispara (não há com o que comparar)', () => {
      expect(detectImpossibleTravel('201.17.45.98', null, now)).toBeNull()
    })

    test('mesmo IP não dispara', () => {
      const previous = { ip: '201.17.45.98', timestampISO: '2026-08-28T13:50:00.000Z' }
      expect(detectImpossibleTravel('201.17.45.98', previous, now)).toBeNull()
    })

    test('IP diferente dentro da janela dispara', () => {
      const previous = { ip: '189.40.12.7', timestampISO: '2026-08-28T13:50:00.000Z' } // 10 min antes
      const anomaly = detectImpossibleTravel('201.17.45.98', previous, now)

      expect(anomaly?.type).toBe('IMPOSSIBLE_TRAVEL')
      expect(anomaly?.details).toMatchObject({
        previousIp: '189.40.12.7',
        currentIp: '201.17.45.98',
        minutesSinceLastAccess: 10,
      })
    })

    test('IP diferente FORA da janela não dispara', () => {
      // 3h depois: tempo suficiente para um deslocamento real.
      const previous = { ip: '189.40.12.7', timestampISO: '2026-08-28T11:00:00.000Z' }
      expect(detectImpossibleTravel('201.17.45.98', previous, now)).toBeNull()
    })
  })

  describe('fluxo de avaliação', () => {
    test('login normal não dispara webhook, mas registra o acesso', async () => {
      await securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(10) })

      expect(safeFetchMock).not.toHaveBeenCalled()
      expect(recordMock).not.toHaveBeenCalled()
      // O acesso é gravado mesmo sem anomalia: é a base do próximo login.
      expect(setJSONMock).toHaveBeenCalledTimes(1)
    })

    test('anomalia dispara webhook E registra na auditoria', async () => {
      await securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(3) })

      expect(recordMock).toHaveBeenCalledTimes(1)
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        action: 'SUSPICIOUS_ACCESS_DETECTED',
        resource: 'SECURITY',
      })
      expect(safeFetchMock).toHaveBeenCalledTimes(1)
    })

    test('o POST usa safeFetch com timeout curto e sem redirecionamento', async () => {
      // Anti-SSRF: a URL vem de env e não pode virar scanner da rede interna.
      await securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(3) })

      const [url, init, options] = safeFetchMock.mock.calls[0]
      expect(url).toBe('https://webhook.exemplo.com/alertas')
      expect(init.method).toBe('POST')
      expect(options).toMatchObject({ timeoutMs: 3000, maxRedirects: 0 })
    })

    test('webhook fora do ar NÃO propaga erro (login não pode cair)', async () => {
      safeFetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(
        securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(3) })
      ).resolves.toBeUndefined()

      expect(loggerErrorMock).toHaveBeenCalled()
    })

    test('Redis fora do ar NÃO propaga erro e a regra de horário segue valendo', async () => {
      getJSONMock.mockRejectedValue(new Error('Redis indisponível'))

      await expect(
        securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(3) })
      ).resolves.toBeUndefined()

      // Mesmo sem Redis, a madrugada foi detectada e o alerta saiu.
      expect(safeFetchMock).toHaveBeenCalledTimes(1)
      expect(loggerWarnMock).toHaveBeenCalled()
    })

    test('as duas anomalias juntas viajam num único alerta', async () => {
      getJSONMock.mockResolvedValue({
        ip: '189.40.12.7',
        timestampISO: new Date(atLocalHour(3).getTime() - 10 * 60000).toISOString(),
      })

      await securityAlertService.evaluateLogin({ ...BASE_CONTEXT, timestamp: atLocalHour(3) })

      expect(safeFetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(safeFetchMock.mock.calls[0][1].body)
      expect(body.anomalies.map((a: { type: string }) => a.type)).toEqual([
        'EARLY_MORNING_LOGIN',
        'IMPOSSIBLE_TRAVEL',
      ])
    })
  })
})
