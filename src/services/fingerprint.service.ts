import { createHash } from 'node:crypto'

/**
 * Fingerprint de sessão (Épico 2, Task 2.2).
 *
 * Vincula o token ao dispositivo/rede de origem, de modo que um token roubado e
 * reutilizado de outra máquina seja recusado.
 *
 * POR QUE FAIXA DE REDE E NÃO O IP EXATO:
 *   Travar no IP exato derrubaria a sessão a cada troca de rede (Wi-Fi ↔ 4G),
 *   a cada renovação de DHCP e a cada rotação de IP do provedor. Numa prefeitura
 *   atrás de CGNAT isso significaria logout constante — e uma proteção que
 *   atrapalha o trabalho legítimo acaba desativada.
 *   Usar a FAIXA (/24 em IPv4, /64 em IPv6) mantém a sessão estável dentro da
 *   mesma rede e continua barrando o uso do token a partir de outra operadora,
 *   cidade ou país, que é o cenário de roubo que importa.
 *
 * LIMITAÇÃO CONHECIDA, declarada de propósito:
 *   Um atacante na MESMA faixa de rede e com o mesmo User-Agent produz o mesmo
 *   fingerprint. Isto é uma barreira contra reuso remoto do token, não contra um
 *   invasor já dentro da rede — para esse caso valem as outras camadas
 *   (expiração curta, rotação de refresh token, trilha de auditoria).
 */

/**
 * Reduz o IP à sua faixa de rede.
 *   IPv4  → 3 primeiros octetos (/24):  201.17.45.98        → "201.17.45"
 *   IPv6  → 4 primeiros grupos (/64):   2001:db8:85a3:1:... → "2001:db8:85a3:1"
 */
export function extrairFaixaRede(ip: string): string {
  if (!ip) return 'desconhecida'

  // IPv4 mapeado em IPv6 (formato que o Node entrega atrás de alguns proxies)
  const semPrefixo = ip.startsWith('::ffff:') ? ip.slice(7) : ip

  if (semPrefixo.includes('.')) {
    const octetos = semPrefixo.split('.')
    return octetos.length === 4 ? octetos.slice(0, 3).join('.') : semPrefixo
  }

  if (semPrefixo.includes(':')) {
    return semPrefixo.split(':').slice(0, 4).join(':')
  }

  return semPrefixo
}

/**
 * Calcula o fingerprint da requisição.
 *
 * Truncado em 32 caracteres: o token trafega em todas as requisições e o hash
 * completo só aumentaria o tamanho sem ganho prático — 128 bits já tornam
 * colisão inviável para este uso.
 */
export function calcularFingerprint(ip: string, userAgent?: string | null): string {
  const faixa = extrairFaixaRede(ip)
  const agente = (userAgent ?? 'desconhecido').trim()

  return createHash('sha256')
    .update(`${faixa}|${agente}`)
    .digest('hex')
    .slice(0, 32)
}

/** Extrai IP e User-Agent de uma requisição Fastify e devolve o fingerprint. */
export function calcularFingerprintDaRequisicao(request: {
  ip: string
  headers: Record<string, unknown>
}): string {
  const userAgent = request.headers['user-agent']
  return calcularFingerprint(request.ip, typeof userAgent === 'string' ? userAgent : null)
}
