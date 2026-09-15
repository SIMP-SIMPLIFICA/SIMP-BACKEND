/**
 * Valor por extenso em português — "SETECENTOS E CINQUENTA REAIS".
 *
 * O formulário físico do Anexo I exige o valor escrito por extenso ao lado do
 * numeral, prática padrão de recibo no Brasil (evita adulteração do número).
 * Escrito aqui e não guardado no banco: é derivado do valor a cada emissão, e
 * armazená-lo criaria uma segunda fonte de verdade que poderia divergir do
 * numeral se algum dia o valor fosse corrigido antes da emissão.
 *
 * Sem dependência externa de propósito: é uma função pura, o alcance de uma
 * diária municipal nunca chega perto do teto de nomenclatura (trilhões), e o
 * projeto evita bibliotecas para lógica que cabe em uma tela.
 */

const UNITS = [
  '', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE',
]
const TEENS = [
  'DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE',
  'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE',
]
const TENS = [
  '', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA',
  'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA',
]
const HUNDREDS = [
  '', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS',
  'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS',
]

/** Um grupo de três dígitos (0–999) por extenso. "000" devolve string vazia. */
function threeDigitsToWords(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CEM'

  const hundred = Math.floor(n / 100)
  const rest = n % 100

  const parts: string[] = []
  if (hundred > 0) parts.push(HUNDREDS[hundred])

  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10])
  } else {
    const ten = Math.floor(rest / 10)
    const unit = rest % 10
    if (ten > 0) parts.push(TENS[ten])
    if (unit > 0) parts.push(UNITS[unit])
  }

  return parts.join(' E ')
}

/**
 * Nomes dos grupos de três dígitos, da direita para a esquerda.
 *
 * Vai até bilhão por folga, não porque uma diária chegue perto disso — é para
 * que um valor absurdo (erro de digitação) produza um texto ainda LEGÍVEL em
 * vez de "undefinedMIL" estampado num documento oficial.
 */
const SCALE = ['', ' MIL', ' MILHÃO', ' BILHÃO']
const SCALE_PLURAL = ['', ' MIL', ' MILHÕES', ' BILHÕES']

/** Um inteiro não negativo por extenso, até a casa dos milhões. */
function integerToWords(n: number): string {
  if (n === 0) return 'ZERO'

  const groups: number[] = []
  let remaining = n
  while (remaining > 0) {
    groups.unshift(remaining % 1000)
    remaining = Math.floor(remaining / 1000)
  }
  // groups[0] é o grupo mais significativo; o índice de escala conta da direita.
  const scaleOffset = groups.length - 1

  // Cada grupo guarda o próprio VALOR junto do texto: é o valor do ÚLTIMO
  // grupo escrito que decide se a junção final leva "E" — regra clássica do
  // extenso em português ("dois milhões E quinhentos mil", mas "um milhão
  // duzentos mil" sem "E", porque duzentos-mil não é <100 nem múltiplo redondo
  // de 100 sozinho... na prática, a regra usada por bancos e cartórios olha o
  // valor do ÚLTIMO GRUPO em si: <100, ou múltiplo exato de 100).
  const parts: { text: string; value: number }[] = []
  groups.forEach((group, index) => {
    if (group === 0) return

    const scaleIndex = scaleOffset - index
    // Acima de bilhão: nunca deveria acontecer numa diária, mas um "undefined"
    // impresso num documento oficial é pior que um texto aproximado.
    if (scaleIndex >= SCALE.length) {
      parts.push({
        text: `${threeDigitsToWords(group)} VEZES DEZ ELEVADO A ${scaleIndex * 3}`,
        value: group,
      })
      return
    }
    const words = threeDigitsToWords(group)
    const scaleWord = group === 1 && scaleIndex >= 1 && scaleIndex <= 2
      ? SCALE[scaleIndex] // "MIL" e "UM MILHÃO" não pluralizam o próprio nome
      : (group > 1 ? SCALE_PLURAL[scaleIndex] : SCALE[scaleIndex])

    // "MIL" sozinho não repete o "UM": "1.000" é "MIL", não "UM MIL".
    const groupWords = scaleIndex === 1 && group === 1 ? '' : words
    parts.push({ text: `${groupWords}${scaleWord}`.trim(), value: group })
  })

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].text

  const last = parts[parts.length - 1]
  const needsE = last.value < 100 || last.value % 100 === 0
  const head = parts.slice(0, -1).map(p => p.text).join(' ')

  return needsE ? `${head} E ${last.text}` : `${head} ${last.text}`
}

/**
 * Valor monetário por extenso, em CAIXA ALTA — mesma convenção do restante do
 * conteúdo impresso nos documentos oficiais.
 *
 * Aceita `number` (reais com centavos, ex: 750.5) e formata como o recibo
 * físico: "SETECENTOS E CINQUENTA REAIS E CINQUENTA CENTAVOS".
 */
export function currencyToWords(value: number): string {
  // Arredondamento em centavos: o mesmo cuidado de nunca deixar sujeira de
  // ponto flutuante decidir o texto de um documento oficial.
  const cents = Math.round(Math.abs(value) * 100)
  const reais = Math.floor(cents / 100)
  const centavos = cents % 100

  const reaisWords = `${integerToWords(reais)} ${reais === 1 ? 'REAL' : 'REAIS'}`

  if (centavos === 0) return reaisWords

  const centavosWords = `${integerToWords(centavos)} ${centavos === 1 ? 'CENTAVO' : 'CENTAVOS'}`
  return `${reaisWords} E ${centavosWords}`
}
