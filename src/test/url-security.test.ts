import { describe, expect, it } from 'vitest'
import {
  UnsafeUrlError,
  isPrivateAddress,
  parseExternalUrl,
  sanitizeRedirectTarget,
} from '@/utils/url-security.js'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // metadata service da AWS/GCP/Azure
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('classifica %s como interno', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '93.184.216.34'])(
    'classifica %s como público',
    ip => {
      expect(isPrivateAddress(ip)).toBe(false)
    },
  )

  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1'])(
    'classifica o IPv6 %s como interno',
    ip => {
      expect(isPrivateAddress(ip)).toBe(true)
    },
  )

  it('trata IPv6 link-local com zone id', () => {
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true)
  })

  it('rejeita IPv4 com zero à esquerda, que alguns parsers leem como octal', () => {
    expect(isPrivateAddress('0177.0.0.1')).toBe(true)
  })
})

describe('parseExternalUrl', () => {
  it('aceita uma URL pública comum', () => {
    expect(parseExternalUrl('https://exemplo.com/logo.png').hostname).toBe('exemplo.com')
  })

  it.each([
    ['http://127.0.0.1/x', 'ip-interno'],
    ['http://169.254.169.254/latest/meta-data/', 'ip-interno'],
    // porta é checada antes do hostname — ambos bloqueiam, o motivo é o primeiro
    ['http://localhost:3000/x', 'porta-nao-permitida'],
    ['http://localhost/x', 'hostname-bloqueado'],
    ['http://metadata.google.internal/x', 'hostname-bloqueado'],
    ['http://algo.internal/x', 'tld-interno'],
    ['file:///etc/passwd', 'protocolo-nao-permitido'],
    ['gopher://exemplo.com/', 'protocolo-nao-permitido'],
    ['http://user:senha@exemplo.com/', 'credenciais-na-url'],
    ['http://exemplo.com:6379/', 'porta-nao-permitida'],
    ['nao-e-uma-url', 'url-malformada'],
  ])('bloqueia %s por %s', (url, reason) => {
    try {
      parseExternalUrl(url)
      throw new Error(`esperava bloqueio de ${url}`)
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeUrlError)
      expect((err as UnsafeUrlError).reason).toBe(reason)
    }
  })

  it('libera uma origem explicitamente confiável, mesmo interna', () => {
    const url = parseExternalUrl('http://localhost:3000/uploads/a.png', {
      allowedOrigins: ['http://localhost:3000'],
    })
    expect(url.port).toBe('3000')
  })
})

describe('sanitizeRedirectTarget', () => {
  const allowedOrigins = ['https://app.simp.gov.br']

  it('aceita caminho relativo à raiz', () => {
    expect(sanitizeRedirectTarget('/councils/sign/return?id=1', { allowedOrigins }))
      .toBe('/councils/sign/return?id=1')
  })

  it('aceita URL absoluta de origem confiável', () => {
    expect(sanitizeRedirectTarget('https://app.simp.gov.br/x', { allowedOrigins }))
      .toBe('https://app.simp.gov.br/x')
  })

  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com/x',
    // eslint-disable-next-line no-script-url -- é justamente o payload que deve ser recusado
    'javascript:alert(1)',
    'https://user:pass@app.simp.gov.br/x',
    'https://app.simp.gov.br.evil.com/x',
  ])('recusa %s e cai no fallback', target => {
    expect(sanitizeRedirectTarget(target, { allowedOrigins, fallback: '/' })).toBe('/')
  })

  it('recusa vazio e nulo', () => {
    expect(sanitizeRedirectTarget('', { allowedOrigins })).toBe('/')
    expect(sanitizeRedirectTarget(null, { allowedOrigins })).toBe('/')
    expect(sanitizeRedirectTarget(undefined, { allowedOrigins })).toBe('/')
  })
})
