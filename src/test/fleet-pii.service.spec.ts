import { randomBytes } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

/**
 * Cifragem de CPF/CNH do Frotas. A config é mockada com chaves de teste: o
 * serviço real nunca deve rodar com chave fixa no código.
 */

const MASTER = randomBytes(32).toString('base64')
const BLIND = randomBytes(32).toString('base64')

async function loadService(keys: { master?: string; blind?: string }) {
  vi.resetModules()
  vi.doMock('@/config/config.js', () => ({
    config: { fleet: { piiMasterKey: keys.master, piiBlindIndexKey: keys.blind } },
  }))
  const mod = await import('../services/fleet-pii.service.js')
  vi.doUnmock('@/config/config.js')
  return mod.fleetPiiService
}

describe('fleetPiiService', () => {
  test('cifra e decifra (ida e volta)', async () => {
    const service = await loadService({ master: MASTER, blind: BLIND })
    const payload = service.encrypt('org-a', '52998224725')

    expect(payload).not.toContain('52998224725')
    expect(payload.startsWith('v1.')).toBe(true)
    expect(service.decrypt('org-a', payload)).toBe('52998224725')
  })

  test('o mesmo CPF cifra diferente a cada vez (IV aleatório)', async () => {
    const service = await loadService({ master: MASTER, blind: BLIND })
    expect(service.encrypt('org-a', '52998224725')).not.toBe(service.encrypt('org-a', '52998224725'))
  })

  test('texto cifrado de uma organização não decifra em outra', async () => {
    const service = await loadService({ master: MASTER, blind: BLIND })
    const payload = service.encrypt('org-a', '52998224725')
    expect(() => service.decrypt('org-b', payload)).toThrow()
  })

  test('blind index: igual na mesma organização, diferente entre organizações', async () => {
    const service = await loadService({ master: MASTER, blind: BLIND })
    const a1 = service.blindIndex('org-a', '52998224725')
    expect(service.blindIndex('org-a', '52998224725')).toBe(a1)
    expect(service.blindIndex('org-b', '52998224725')).not.toBe(a1)
    expect(a1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('sem chaves, falha com erro orientador (PII_KEYS_MISSING)', async () => {
    const service = await loadService({})
    expect(() => service.encrypt('org-a', '52998224725')).toThrowError(
      expect.objectContaining({ code: 'PII_KEYS_MISSING' })
    )
    expect(() => service.assertConfigured()).toThrowError(expect.objectContaining({ code: 'PII_KEYS_MISSING' }))
  })

  test('chave com tamanho errado é recusada', async () => {
    const service = await loadService({ master: randomBytes(16).toString('base64'), blind: BLIND })
    expect(() => service.encrypt('org-a', 'x')).toThrowError(expect.objectContaining({ code: 'PII_KEYS_MISSING' }))
  })
})
