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
const registrarMock = vi.fn()
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

vi.mock('@/services/auditoria.service.js', () => ({
  auditoriaService: { registrar: (...a: unknown[]) => registrarMock(...a) },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { error: loggerErrorMock, warn: loggerWarnMock, info: vi.fn() },
}))

vi.mock('@/config/config.js', () => ({
  config: {
    alertas: {
      webhookUrl: 'https://webhook.exemplo.com/alertas',
      horaInicioMadrugada: 1,
      horaFimMadrugada: 5,
      janelaViagemMinutos: 60,
    },
  },
}))

const { alertaSegurancaService, detectarLoginMadrugada, detectarDeslocamentoImpossivel } =
  await import('../services/alerta-seguranca.service.js')

/** Data em hora LOCAL — a regra de madrugada usa o fuso do servidor. */
function emHoraLocal(hora: number): Date {
  const d = new Date()
  d.setHours(hora, 0, 0, 0)
  return d
}

const CONTEXTO_BASE = {
  usuarioId: 'u-1',
  email: 'servidor@prefeitura.gov.br',
  ip: '201.17.45.98',
  organizacaoId: 'org-1',
}

describe('Alertas de anomalia comportamental (Task 2.3)', () => {
  beforeEach(() => {
    getJSONMock.mockReset().mockResolvedValue(null)
    setJSONMock.mockReset().mockResolvedValue(undefined)
    safeFetchMock.mockReset().mockResolvedValue({ status: 200 })
    registrarMock.mockReset().mockResolvedValue(undefined)
    loggerErrorMock.mockReset()
    loggerWarnMock.mockReset()
  })

  describe('regra de horário (madrugada)', () => {
    test('01h dispara alerta (limite inferior da janela)', () => {
      expect(detectarLoginMadrugada(emHoraLocal(1))?.tipo).toBe('LOGIN_MADRUGADA')
    })

    test('05h dispara alerta (limite superior da janela)', () => {
      expect(detectarLoginMadrugada(emHoraLocal(5))?.tipo).toBe('LOGIN_MADRUGADA')
    })

    test('03h dispara alerta (meio da janela)', () => {
      expect(detectarLoginMadrugada(emHoraLocal(3))).not.toBeNull()
    })

    test('09h em pleno expediente NÃO dispara', () => {
      expect(detectarLoginMadrugada(emHoraLocal(9))).toBeNull()
    })

    test('00h fica fora da janela configurada (1h-5h)', () => {
      expect(detectarLoginMadrugada(emHoraLocal(0))).toBeNull()
    })

    test('06h, logo após a janela, NÃO dispara', () => {
      expect(detectarLoginMadrugada(emHoraLocal(6))).toBeNull()
    })
  })

  describe('regra de deslocamento impossível', () => {
    const agora = new Date('2026-08-28T14:00:00.000Z')

    test('primeiro login do usuário não dispara (não há com o que comparar)', () => {
      expect(detectarDeslocamentoImpossivel('201.17.45.98', null, agora)).toBeNull()
    })

    test('mesmo IP não dispara', () => {
      const anterior = { ip: '201.17.45.98', quandoISO: '2026-08-28T13:50:00.000Z' }
      expect(detectarDeslocamentoImpossivel('201.17.45.98', anterior, agora)).toBeNull()
    })

    test('IP diferente dentro da janela dispara', () => {
      const anterior = { ip: '189.40.12.7', quandoISO: '2026-08-28T13:50:00.000Z' } // 10 min antes
      const anomalia = detectarDeslocamentoImpossivel('201.17.45.98', anterior, agora)

      expect(anomalia?.tipo).toBe('DESLOCAMENTO_IMPOSSIVEL')
      expect(anomalia?.detalhes).toMatchObject({
        ipAnterior: '189.40.12.7',
        ipAtual: '201.17.45.98',
        minutosDesdeUltimoAcesso: 10,
      })
    })

    test('IP diferente FORA da janela não dispara', () => {
      // 3h depois: tempo suficiente para um deslocamento real.
      const anterior = { ip: '189.40.12.7', quandoISO: '2026-08-28T11:00:00.000Z' }
      expect(detectarDeslocamentoImpossivel('201.17.45.98', anterior, agora)).toBeNull()
    })
  })

  describe('fluxo de avaliação', () => {
    test('login normal não dispara webhook, mas registra o acesso', async () => {
      await alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(10) })

      expect(safeFetchMock).not.toHaveBeenCalled()
      expect(registrarMock).not.toHaveBeenCalled()
      // O acesso é gravado mesmo sem anomalia: é a base do próximo login.
      expect(setJSONMock).toHaveBeenCalledTimes(1)
    })

    test('anomalia dispara webhook E registra na auditoria', async () => {
      await alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(3) })

      expect(registrarMock).toHaveBeenCalledTimes(1)
      expect(registrarMock.mock.calls[0][0]).toMatchObject({
        acao: 'ACESSO_SUSPEITO_DETECTADO',
        recurso: 'SEGURANCA',
      })
      expect(safeFetchMock).toHaveBeenCalledTimes(1)
    })

    test('o POST usa safeFetch com timeout curto e sem redirecionamento', async () => {
      // Anti-SSRF: a URL vem de env e não pode virar scanner da rede interna.
      await alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(3) })

      const [url, init, opcoes] = safeFetchMock.mock.calls[0]
      expect(url).toBe('https://webhook.exemplo.com/alertas')
      expect(init.method).toBe('POST')
      expect(opcoes).toMatchObject({ timeoutMs: 3000, maxRedirects: 0 })
    })

    test('webhook fora do ar NÃO propaga erro (login não pode cair)', async () => {
      safeFetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(
        alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(3) })
      ).resolves.toBeUndefined()

      expect(loggerErrorMock).toHaveBeenCalled()
    })

    test('Redis fora do ar NÃO propaga erro e a regra de horário segue valendo', async () => {
      getJSONMock.mockRejectedValue(new Error('Redis indisponível'))

      await expect(
        alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(3) })
      ).resolves.toBeUndefined()

      // Mesmo sem Redis, a madrugada foi detectada e o alerta saiu.
      expect(safeFetchMock).toHaveBeenCalledTimes(1)
      expect(loggerWarnMock).toHaveBeenCalled()
    })

    test('as duas anomalias juntas viajam num único alerta', async () => {
      getJSONMock.mockResolvedValue({
        ip: '189.40.12.7',
        quandoISO: new Date(emHoraLocal(3).getTime() - 10 * 60000).toISOString(),
      })

      await alertaSegurancaService.avaliarLogin({ ...CONTEXTO_BASE, quando: emHoraLocal(3) })

      expect(safeFetchMock).toHaveBeenCalledTimes(1)
      const corpo = JSON.parse(safeFetchMock.mock.calls[0][1].body)
      expect(corpo.anomalias.map((a: { tipo: string }) => a.tipo)).toEqual([
        'LOGIN_MADRUGADA',
        'DESLOCAMENTO_IMPOSSIVEL',
      ])
    })
  })
})
