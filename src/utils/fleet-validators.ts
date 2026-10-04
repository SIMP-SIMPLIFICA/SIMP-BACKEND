/**
 * Normalizadores e validadores de dados de frota (Simplifica Frotas, TASK 5 —
 * "Validação de entrada"). O frontend repete as mesmas regras para avisar antes
 * do envio, mas a decisão é sempre do servidor.
 */

/** Só os dígitos de uma string (CPF, Renavam, CNH digitados com máscara). */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Placa normalizada: maiúsculas, sem hífen nem espaço. "abc-1d23" → "ABC1D23".
 * Sem normalizar, "ABC-1234" e "abc1234" virariam dois veículos.
 */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), já normalizada. */
export function isValidPlate(plate: string): boolean {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)
}

/**
 * Renavam: 11 dígitos, o último é dígito verificador.
 * DV = (Σ dígito[i] × peso[i], pesos 3,2,9,8,7,6,5,4,3,2) × 10 mod 11; 10 vira 0.
 */
export function isValidRenavam(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0)
  const dv = (sum * 10) % 11
  return (dv === 10 ? 0 : dv) === Number(digits[10])
}

/** CPF: 11 dígitos, dois dígitos verificadores, sem sequência repetida. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const dv = (length: number) => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return dv(9) === Number(digits[9]) && dv(10) === Number(digits[10])
}

/**
 * Nº de registro da CNH: 11 dígitos, sem sequência repetida. O dígito
 * verificador da CNH tem variantes de cálculo entre fontes; a conferência
 * definitiva vem da consulta SERPRO (fase 3), não daqui.
 */
export function isValidCnhNumber(digits: string): boolean {
  return /^\d{11}$/.test(digits) && !/^(\d)\1{10}$/.test(digits)
}

/** Chassi (VIN): 17 caracteres, sem I, O e Q. */
export function isValidChassis(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value)
}

/** CPF mascarado para exibição: "***.456.789-**". Nunca devolva o CPF inteiro. */
export function maskCpf(digits: string): string {
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`
}

/** Nº da CNH mascarado para exibição: "*******1234". */
export function maskCnhNumber(digits: string): string {
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}
