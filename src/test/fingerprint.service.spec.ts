import { describe, expect, test } from 'vitest'
import { calcularFingerprint, extrairFaixaRede } from '../services/fingerprint.service.js'

describe('Fingerprint de sessão (Task 2.2)', () => {
  describe('extrairFaixaRede', () => {
    test('IPv4 é reduzido aos 3 primeiros octetos (/24)', () => {
      expect(extrairFaixaRede('201.17.45.98')).toBe('201.17.45')
    })

    test('IPv6 é reduzido aos 4 primeiros grupos (/64)', () => {
      expect(extrairFaixaRede('2001:db8:85a3:1234:5678:9abc:def0:1234')).toBe('2001:db8:85a3:1234')
    })

    test('IPv4 mapeado em IPv6 é tratado como IPv4', () => {
      expect(extrairFaixaRede('::ffff:201.17.45.98')).toBe('201.17.45')
    })

    test('IP vazio não quebra', () => {
      expect(extrairFaixaRede('')).toBe('desconhecida')
    })
  })

  describe('estabilidade dentro da mesma rede', () => {
    // Este é o ponto central da decisão de usar faixa em vez de IP exato:
    // trocar de IP dentro da mesma rede (DHCP, NAT da prefeitura) NÃO pode
    // derrubar a sessão do usuário.
    test('IPs diferentes na mesma faixa /24 geram o mesmo fingerprint', () => {
      const a = calcularFingerprint('201.17.45.98', 'Mozilla/5.0')
      const b = calcularFingerprint('201.17.45.230', 'Mozilla/5.0')
      expect(a).toBe(b)
    })

    test('IPv6 na mesma /64 gera o mesmo fingerprint', () => {
      const a = calcularFingerprint('2001:db8:85a3:1234:1::1', 'Mozilla/5.0')
      const b = calcularFingerprint('2001:db8:85a3:1234:9::9', 'Mozilla/5.0')
      expect(a).toBe(b)
    })
  })

  describe('detecção de uso indevido', () => {
    test('faixa de rede diferente gera fingerprint diferente', () => {
      const original = calcularFingerprint('201.17.45.98', 'Mozilla/5.0')
      const outraRede = calcularFingerprint('189.40.12.7', 'Mozilla/5.0')
      expect(original).not.toBe(outraRede)
    })

    test('User-Agent diferente gera fingerprint diferente', () => {
      const chrome = calcularFingerprint('201.17.45.98', 'Mozilla/5.0 Chrome/120')
      const curl = calcularFingerprint('201.17.45.98', 'curl/8.4.0')
      expect(chrome).not.toBe(curl)
    })
  })

  describe('formato', () => {
    test('é determinístico', () => {
      expect(calcularFingerprint('10.0.0.1', 'UA')).toBe(calcularFingerprint('10.0.0.1', 'UA'))
    })

    test('tem 32 caracteres hexadecimais', () => {
      expect(calcularFingerprint('10.0.0.1', 'UA')).toMatch(/^[0-9a-f]{32}$/)
    })

    test('User-Agent ausente não quebra', () => {
      expect(calcularFingerprint('10.0.0.1', null)).toMatch(/^[0-9a-f]{32}$/)
    })
  })
})
