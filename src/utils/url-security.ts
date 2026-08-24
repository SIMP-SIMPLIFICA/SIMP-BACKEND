/**
 * Defesas contra SSRF (Server-Side Request Forgery) e Open Redirect.
 *
 * Duas superfícies distintas, tratadas por funções distintas:
 *
 *  1. SSRF — o servidor faz uma requisição para uma URL que veio (direta ou
 *     indiretamente) do usuário. Ex.: `user.metadata.logoUrl`, gravável via
 *     `PUT /users/me` (updateProfileSchema aceita `metadata: z.record(z.any())`).
 *     Sem guarda, um atacante aponta a URL para 169.254.169.254 e faz o servidor
 *     ler credenciais do metadata service da nuvem. Use `safeFetch`.
 *
 *  2. Open Redirect — o servidor devolve um 302 para um destino influenciável pelo
 *     usuário, usado em phishing ("o link é do domínio da prefeitura, logo é
 *     confiável"). Use `sanitizeRedirectTarget` / `buildTrustedRedirect`.
 *
 * Sem dependências externas: apenas `node:dns` e o `URL` nativo.
 */

import { promises as dns } from 'node:dns'
import { config } from '@/config/config.js'

export class UnsafeUrlError extends Error {
  constructor(public readonly reason: string, public readonly value: string) {
    super(`URL bloqueada por política de segurança (${reason})`)
    this.name = 'UnsafeUrlError'
  }
}

/** Só http/https. Bloqueia file:, gopher:, ftp:, data: — vetores clássicos de SSRF. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Portas liberadas por padrão. Restringir a porta impede varredura de serviços
 * internos (Redis 6379, Postgres 5432, Elasticsearch 9200) mesmo que o host passe.
 */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/** Hostnames que nunca devem ser alvo, independentemente do que o DNS resolva. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

/** TLDs reservados para rede interna. */
const BLOCKED_TLD_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']

// ─── Classificação de endereços IP ────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    // Rejeita zeros à esquerda: "0177.0.0.1" é lido como octal por alguns parsers
    // e vira 127.0.0.1 depois de já ter passado por uma validação decimal ingênua.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result
}

/** Faixas IPv4 que nunca devem ser alcançadas a partir de input do usuário. */
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],        // "este" host
  ['10.0.0.0', 8],       // privada RFC 1918
  ['100.64.0.0', 10],    // CGNAT RFC 6598
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — inclui o metadata service 169.254.169.254
  ['172.16.0.0', 12],    // privada RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // privada RFC 1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reservada (inclui 255.255.255.255)
]

export function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return true // não parseou: tratar como hostil

  for (const [base, bits] of PRIVATE_IPV4_RANGES) {
    const baseValue = ipv4ToInt(base)
    if (baseValue === null) continue
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((value & mask) >>> 0) === ((baseValue & mask) >>> 0)) return true
  }
  return false
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0] // remove zone id (fe80::1%eth0)

  if (normalized === '::' || normalized === '::1') return true

  // IPv4 mapeado/compatível (::ffff:127.0.0.1) — delega para a regra IPv4
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)
  if (mapped) return isPrivateIPv4(mapped[1])

  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true // fc00::/7 — unique local
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true // fe80::/10 — link-local
  if (/^ff[0-9a-f]{2}:/.test(normalized)) return true    // ff00::/8 — multicast

  return false
}

/** `true` para qualquer endereço que não deva ser alcançável a partir de input externo. */
export function isPrivateAddress(ip: string): boolean {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

// ─── Validação de URL ─────────────────────────────────────────────────────────

export interface SafeUrlOptions {
  /**
   * Origens explicitamente confiáveis (ex.: a própria APP_URL, que em dev aponta
   * para localhost). Comparadas por `URL.origin`, exatamente — sem wildcard.
   */
  allowedOrigins?: string[]
  /** Portas extras além de 80/443. */
  allowedPorts?: string[]
}

function normalizeOrigins(origins: string[] | undefined): Set<string> {
  const set = new Set<string>()
  for (const raw of origins ?? []) {
    try {
      set.add(new URL(raw).origin)
    } catch {
      // origem malformada na config é ignorada, não derruba a validação
    }
  }
  return set
}

/**
 * Valida a forma da URL (protocolo, porta, hostname) sem tocar na rede.
 * Separado de `assertPublicUrl` para poder ser testado sem DNS.
 */
export function parseExternalUrl(raw: string, options: SafeUrlOptions = {}): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('url-malformada', raw)
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError('protocolo-nao-permitido', raw)
  }

  // Credenciais embutidas (http://user:pass@host) confundem parsers e são usadas
  // para mascarar o host real — rejeitadas sem exceção.
  if (url.username || url.password) {
    throw new UnsafeUrlError('credenciais-na-url', raw)
  }

  const trusted = normalizeOrigins(options.allowedOrigins)
  if (trusted.has(url.origin)) return url

  const allowedPorts = new Set([...ALLOWED_PORTS, ...(options.allowedPorts ?? [])])
  if (!allowedPorts.has(url.port)) {
    throw new UnsafeUrlError('porta-nao-permitida', raw)
  }

  // `URL` mantém IPv6 entre colchetes — remove antes de classificar
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError('hostname-bloqueado', raw)
  }
  if (BLOCKED_TLD_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new UnsafeUrlError('tld-interno', raw)
  }

  // Host escrito como IP literal: decide aqui, sem precisar de DNS
  const isLiteralIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
  if (isLiteralIp && isPrivateAddress(hostname)) {
    throw new UnsafeUrlError('ip-interno', raw)
  }

  return url
}

/**
 * Valida a forma E resolve o DNS, conferindo que TODOS os endereços retornados são
 * públicos.
 *
 * Checar todos (e não só o primeiro) importa: um domínio hostil pode devolver um IP
 * público e um interno no mesmo registro, e qual deles será usado na conexão fica a
 * cargo do sistema operacional.
 */
export async function assertPublicUrl(raw: string, options: SafeUrlOptions = {}): Promise<URL> {
  const url = parseExternalUrl(raw, options)

  if (normalizeOrigins(options.allowedOrigins).has(url.origin)) return url

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return url // IP literal já foi classificado em parseExternalUrl
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await dns.lookup(hostname, { all: true })
  } catch {
    throw new UnsafeUrlError('dns-nao-resolvido', raw)
  }

  if (addresses.length === 0) throw new UnsafeUrlError('dns-sem-resposta', raw)

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError('dns-aponta-para-ip-interno', raw)
    }
  }

  return url
}

export interface SafeFetchOptions extends SafeUrlOptions {
  /** Máximo de redirecionamentos seguidos manualmente. Default 3. */
  maxRedirects?: number
  /** Timeout total em milissegundos. Default 10s. */
  timeoutMs?: number
}

/**
 * `fetch` com guarda de SSRF em TODO salto da cadeia de redirecionamento.
 *
 * `redirect: 'manual'` é essencial: com o comportamento padrão ('follow'), um host
 * público responderia 302 para http://169.254.169.254/ e o runtime seguiria sem
 * revalidar — a checagem inicial viraria decoração.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3
  const timeoutMs = options.timeoutMs ?? 10_000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let current = rawUrl

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = await assertPublicUrl(current, options)

      const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status < 300 || response.status > 399) return response

      const location = response.headers.get('location')
      if (!location) return response

      current = new URL(location, url).toString()
    }

    throw new UnsafeUrlError('redirecionamentos-demais', rawUrl)
  } finally {
    clearTimeout(timer)
  }
}

// ─── Open Redirect ────────────────────────────────────────────────────────────

/**
 * Origens para as quais o backend pode redirecionar. Derivadas da config do
 * servidor — nunca de um header (`Host`/`X-Forwarded-Host` são forjáveis).
 */
export function defaultRedirectOrigins(): string[] {
  return [config.urls.frontend, config.urls.app].filter(Boolean)
}

/**
 * Devolve um destino de redirecionamento seguro.
 *
 * Aceita: caminho relativo (`/councils/sign/return?x=1`) ou URL absoluta cuja
 * origem esteja na whitelist. Qualquer outra coisa cai no `fallback`.
 */
export function sanitizeRedirectTarget(
  target: string | null | undefined,
  options: { allowedOrigins?: string[]; fallback?: string } = {},
): string {
  const allowed = normalizeOrigins(options.allowedOrigins ?? defaultRedirectOrigins())
  const fallback = options.fallback ?? '/'

  if (!target) return fallback

  const value = target.trim()
  if (!value) return fallback

  // `//evil.com` e `/\evil.com` são protocol-relative: o navegador as trata como
  // absolutas, apesar de parecerem caminhos internos. Rejeitadas antes de tudo.
  if (/^[/\\]{2}/.test(value)) return fallback

  // Caminho relativo à raiz — sempre dentro do próprio host
  if (value.startsWith('/')) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fallback
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return fallback
  if (url.username || url.password) return fallback
  if (!allowed.has(url.origin)) return fallback

  return url.toString()
}

/**
 * Monta uma URL de redirecionamento a partir de uma origem confiável + caminho e
 * query controlados pelo servidor.
 *
 * Preferir esta função a interpolar strings: com um `base` vazio por config faltando,
 * `${base}${path}` produziria `//algo`, que é um redirect protocol-relative.
 */
export function buildTrustedRedirect(
  base: string,
  pathname: string,
  query: Record<string, string | undefined> = {},
): string {
  const trustedBase = base || config.urls.frontend || config.urls.app

  let url: URL
  try {
    url = new URL(pathname, trustedBase.endsWith('/') ? trustedBase : `${trustedBase}/`)
  } catch {
    return '/'
  }

  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined) url.searchParams.set(key, val)
  }

  return sanitizeRedirectTarget(url.toString(), {
    allowedOrigins: [trustedBase, ...defaultRedirectOrigins()],
    fallback: '/',
  })
}
