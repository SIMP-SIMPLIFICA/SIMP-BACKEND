/**
 * Ofuscação de nomes para documentos e registros públicos (LGPD).
 *
 * Um relatório exportado carrega o nome de quem o emitiu, e esse documento pode
 * ser publicado no portal da transparência. O nome completo de um servidor é
 * dado pessoal: mantê-lo legível ali expõe a pessoa sem necessidade, já que o
 * propósito do campo é apenas permitir identificar internamente quem emitiu.
 *
 * A forma ofuscada preserva o primeiro nome — suficiente para reconhecimento por
 * quem trabalha no órgão — e reduz o restante a iniciais:
 *
 *   "Carlos Magno Almeida Soares" → "Carlos M. A. S***"
 *
 * NÃO é criptografia nem hash: é redução de exposição. Quem já conhece a pessoa
 * ainda a reconhece, e é exatamente esse o equilíbrio pretendido entre
 * transparência e privacidade.
 */

/**
 * Partículas que NÃO viram inicial.
 *
 * "Carlos de Almeida" ficaria "Carlos d. A***" se tratássemos "de" como
 * sobrenome — ilegível e sem ganho de privacidade, porque a partícula não
 * identifica ninguém. Mantidas em minúsculas, como se escrevem.
 */
const NAME_PARTICLES = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'di',
  'du',
  'del',
  'della',
  'von',
  'van',
  'la',
  'le',
])

/** Usado quando não há nome algum a exibir. */
const UNKNOWN_LABEL = 'Não identificado'

/**
 * Devolve a versão ofuscada do nome completo.
 *
 * Regras:
 *   - primeiro nome, inteiro;
 *   - nomes do meio, inicial seguida de ponto;
 *   - último nome, inicial seguida de três asteriscos;
 *   - partículas ("de", "da", "dos"…) permanecem como estão.
 *
 * Nome único ("Carlos") é devolvido inteiro: não há sobrenome a proteger, e
 * transformá-lo em "C***" destruiria a única informação útil sem nada em troca.
 */
export function anonymizeName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)

  if (parts.length === 0) return UNKNOWN_LABEL
  if (parts.length === 1) return parts[0]

  const [first, ...rest] = parts

  // A última palavra que NÃO é partícula é o sobrenome a mascarar. Sem esta
  // busca, "Carlos Almeida de" (digitação sobrando) mascararia a partícula.
  let lastNameIndex = -1
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    if (!NAME_PARTICLES.has(rest[i].toLowerCase())) {
      lastNameIndex = i
      break
    }
  }

  // Só restaram partículas depois do primeiro nome: devolve o que há, sem
  // inventar máscara.
  if (lastNameIndex === -1) return parts.join(' ')

  const masked = rest.map((part, index) => {
    if (NAME_PARTICLES.has(part.toLowerCase())) return part.toLowerCase()

    const initial = part[0].toUpperCase()
    return index === lastNameIndex ? `${initial}***` : `${initial}.`
  })

  return [first, ...masked].join(' ')
}

/**
 * Monta o nome ofuscado a partir dos campos separados do usuário.
 *
 * Conveniência para os chamadores que têm `firstName`/`lastName` em mãos em vez
 * do nome completo numa única string.
 */
export function anonymizeUserName(
  firstName?: string | null,
  lastName?: string | null
): string {
  return anonymizeName([firstName, lastName].filter(Boolean).join(' '))
}
