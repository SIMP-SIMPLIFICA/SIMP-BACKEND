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

/** Redis falso, controlável por caso de teste. */
const store = new Map<string, string>()
const redisState = { isOpen: true, isReady: true, shouldThrow: false }

vi.mock('@/utils/redis.js', () => ({
  redisClient: {
    get isOpen() { return redisState.isOpen },
    get isReady() { return redisState.isReady },
    exists: async (k: string) => {
      if (redisState.shouldThrow) throw new Error('redis down')
      return store.has(k) ? 1 : 0
    },
    get: async (k: string) => store.get(k) ?? null,
    setEx: async (k: string, _ttl: number, v: string) => {
      if (redisState.shouldThrow) throw new Error('redis down')
      store.set(k, v)
    },
    del: async (k: string) => { store.delete(k) },
    incr: async (k: string) => {
      if (redisState.shouldThrow) throw new Error('redis down')
      const next = Number(store.get(k) ?? 0) + 1
      store.set(k, String(next))
      return next
    },
    expire: async () => true,
  },
}))

const {
  __resetLocalState,
  banIp,
  getBanInfo,
  isBanExempt,
  isIpBanned,
  registerStrike,
  unbanIp,
} = await import('@/services/ip-ban.service.js')

const ATACANTE = '45.79.12.50'

beforeEach(() => {
  store.clear()
  __resetLocalState()
  redisState.isOpen = true
  redisState.isReady = true
  redisState.shouldThrow = false
  honeypotConfig.enabled = true
  honeypotConfig.allowlist = []
  honeypotConfig.fieldStrikes = 3
})

describe('isBanExempt', () => {
  it('isenta IPs da allowlist — proteção contra NAT da prefeitura', () => {
    honeypotConfig.allowlist = ['45.79.200.1']
    expect(isBanExempt('45.79.200.1')).toBe(true)
    expect(isBanExempt('45.79.200.2')).toBe(false)
  })

  it.each(['127.0.0.1', '10.0.0.5', '192.168.1.1', '::1'])(
    'isenta o endereço interno %s',
    ip => expect(isBanExempt(ip)).toBe(true),
  )

  it('não isenta um IP público comum', () => {
    expect(isBanExempt(ATACANTE)).toBe(false)
  })
})

describe('banIp / isIpBanned', () => {
  it('bane e passa a bloquear o IP', async () => {
    expect(await isIpBanned(ATACANTE)).toBe(false)

    await banIp(ATACANTE, 'acessou /.env')

    expect(await isIpBanned(ATACANTE)).toBe(true)
  })

  it('não bane IP isento, mesmo pedindo explicitamente', async () => {
    honeypotConfig.allowlist = [ATACANTE]

    expect(await banIp(ATACANTE, 'teste')).toBe(false)
    expect(await isIpBanned(ATACANTE)).toBe(false)
  })

  it('não afeta outros IPs', async () => {
    await banIp(ATACANTE, 'teste')
    expect(await isIpBanned('45.79.12.99')).toBe(false)
  })

  it('guarda motivo e validade', async () => {
    await banIp(ATACANTE, 'acessou /wp-admin')

    const info = await getBanInfo(ATACANTE)
    expect(info?.reason).toBe('acessou /wp-admin')
    expect(new Date(info!.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('unbanIp libera o IP', async () => {
    await banIp(ATACANTE, 'teste')
    await unbanIp(ATACANTE)
    expect(await isIpBanned(ATACANTE)).toBe(false)
  })

  it('não faz nada com o honeypot desligado', async () => {
    honeypotConfig.enabled = false
    await banIp(ATACANTE, 'teste')
    expect(await isIpBanned(ATACANTE)).toBe(false)
  })
})

describe('resiliência a falha do Redis', () => {
  it('FALHA ABERTA na consulta: Redis fora não bloqueia tráfego legítimo', async () => {
    redisState.shouldThrow = true

    expect(await isIpBanned('45.79.200.77')).toBe(false)
  })

  it('Redis desconectado não impede o ban de valer nesta instância', async () => {
    redisState.isOpen = false
    redisState.isReady = false

    await banIp(ATACANTE, 'teste')

    expect(await isIpBanned(ATACANTE)).toBe(true) // cache local assume
  })

  it('falha ao gravar no Redis ainda mantém o ban local', async () => {
    redisState.shouldThrow = true

    await banIp(ATACANTE, 'teste')

    redisState.shouldThrow = false
    expect(await isIpBanned(ATACANTE)).toBe(true)
  })
})

describe('registerStrike — sinal ambíguo do campo-isca', () => {
  it('NÃO bane na primeira ocorrência (autofill de gerenciador de senha)', async () => {
    const banned = await registerStrike(ATACANTE, 'campo-isca')

    expect(banned).toBe(false)
    expect(await isIpBanned(ATACANTE)).toBe(false)
  })

  it('bane ao atingir o limite de strikes', async () => {
    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(false)
    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(false)
    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(true)

    expect(await isIpBanned(ATACANTE)).toBe(true)
  })

  it('respeita um limite customizado', async () => {
    expect(await registerStrike(ATACANTE, 'campo-isca', 1)).toBe(true)
    expect(await isIpBanned(ATACANTE)).toBe(true)
  })

  it('conta strikes em memória quando o Redis está fora', async () => {
    redisState.isOpen = false
    redisState.isReady = false

    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(false)
    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(false)
    expect(await registerStrike(ATACANTE, 'campo-isca')).toBe(true)
  })

  it('não acumula strike para IP isento', async () => {
    honeypotConfig.allowlist = [ATACANTE]

    for (let i = 0; i < 5; i++) await registerStrike(ATACANTE, 'campo-isca')

    expect(await isIpBanned(ATACANTE)).toBe(false)
  })

  it('strikes são independentes por IP', async () => {
    await registerStrike('45.79.12.1', 'x')
    await registerStrike('45.79.12.1', 'x')
    await registerStrike('45.79.12.2', 'x')

    expect(await isIpBanned('45.79.12.1')).toBe(false)
    expect(await isIpBanned('45.79.12.2')).toBe(false)

    expect(await registerStrike('45.79.12.1', 'x')).toBe(true)
  })
})
