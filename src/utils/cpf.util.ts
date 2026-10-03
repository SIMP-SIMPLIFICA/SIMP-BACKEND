/**
 * CPF: normalização para armazenamento e máscara parcial para exibição.
 *
 * DUAS FORMAS, DOIS PROPÓSITOS:
 *   - no banco, só dígitos. Máscara é apresentação, e guardá-la faria
 *     "123.456.789-00" e "12345678900" virarem dois cadastros da mesma pessoa,
 *     furando a restrição de unicidade que deveria impedir exatamente isso;
 *   - em tela e em PDF, a forma parcial. O CPF é dado sensível e o documento
 *     pode ir ao portal da transparência: os três primeiros dígitos e os dois
 *     verificadores saem, o miolo fica, e isso basta para o servidor conferir
 *     que é o CPF dele sem publicar o número inteiro.
 */

/** Só os dígitos. Devolve `null` quando não sobra um CPF de 11 dígitos. */
export function normalizeCpf(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

/**
 * Forma parcial para exibição: `***.456.789-**`.
 *
 * Entrada inesperada (nula, curta, já mascarada) devolve string vazia em vez de
 * um número truncado: exibir meio CPF errado é pior que não exibir nada.
 */
export function maskCpf(raw: string | null | undefined): string {
  const digits = normalizeCpf(raw)
  if (!digits) return ''
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`
}

/**
 * Forma COMPLETA, com pontuação: `123.456.789-00`.
 *
 * Só para o único lugar do sistema com exceção documentada à máscara: o
 * Anexo I de Diária, que é o formulário que o beneficiário assina para
 * receber o valor e precisa do número completo para ter validade (ver
 * `DailyAllowance.beneficiaryCpf`). Fora dali, é `maskCpf` que vale.
 */
export function formatCpf(raw: string | null | undefined): string {
  const digits = normalizeCpf(raw)
  if (!digits) return ''
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}
