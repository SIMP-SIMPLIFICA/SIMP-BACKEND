/**
 * CNPJ: normalização e validação por dígito verificador.
 *
 * Validar só o FORMATO (14 dígitos) deixaria passar "11111111111111" e qualquer
 * número digitado ao acaso. O CNPJ de uma secretaria vai impresso em documento
 * oficial e em convênio: um dígito trocado só aparece quando o Tribunal de
 * Contas devolve a prestação, meses depois.
 *
 * A máscara é apresentação e não é guardada — mesma razão do CPF em
 * `cpf.util.ts`: gravar "11.222.333/0001-81" e "11222333000181" criaria dois
 * registros do mesmo órgão.
 */

/** Só os dígitos. Devolve `null` quando não sobram 14. */
export function normalizeCnpj(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

/** Peso de cada posição no cálculo dos verificadores (regra da Receita). */
const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const SECOND_WEIGHTS = [6, ...FIRST_WEIGHTS]

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

/**
 * O CNPJ é válido?
 *
 * Rejeita também os 14 dígitos repetidos ("00000000000000" e irmãos): eles
 * passam na conta dos verificadores, mas não são CNPJ de ninguém.
 */
export function isValidCnpj(raw: string | null | undefined): boolean {
  const digits = normalizeCnpj(raw)
  if (!digits) return false
  if (/^(\d)\1{13}$/.test(digits)) return false

  const first = checkDigit(digits, FIRST_WEIGHTS)
  if (first !== Number(digits[12])) return false

  return checkDigit(digits, SECOND_WEIGHTS) === Number(digits[13])
}

/**
 * Forma com máscara para exibição: `11.222.333/0001-81`.
 *
 * Entrada inválida devolve string vazia — mostrar meio CNPJ é pior que não
 * mostrar nada.
 */
export function formatCnpj(raw: string | null | undefined): string {
  const d = normalizeCnpj(raw)
  if (!d) return ''
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
