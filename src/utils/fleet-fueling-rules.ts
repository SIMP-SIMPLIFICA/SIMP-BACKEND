import type { FleetCnhCategory, FleetFuelType, FleetVehicleType } from '@prisma/client'

/**
 * Regras puras da autorização de abastecimento (TASK 3A, decisão D16): datas
 * no fuso da prefeitura, combustível compatível com o veículo e categoria de
 * CNH exigida. Sem banco: testadas em `fleet-fueling-rules.spec.ts`.
 */

/** Fuso das prefeituras atendidas (o mesmo do rodapé dos PDFs). Tocantins = UTC-3, sem horário de verão. */
export const FLEET_TZ = 'America/Sao_Paulo'

/** Data local (AAAA-MM-DD) no fuso da prefeitura. */
export function localIsoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FLEET_TZ }).format(date)
}

/** Ano local no fuso da prefeitura — exercício da numeração. */
export function localYear(date: Date = new Date()): number {
  return Number(localIsoDate(date).slice(0, 4))
}

/**
 * Fim do dia local (23:59:59.999 em Brasília) de uma data AAAA-MM-DD.
 * UTC-3 fixo: o Brasil não tem horário de verão desde 2019.
 */
export function endOfLocalDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999-03:00`)
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Data AAAA-MM-DD que fica `count` dias úteis DEPOIS de `fromIso`, pulando
 * sábado, domingo e os feriados cadastrados pela organização. Emitida numa
 * sexta, a validade padrão (3 dias úteis) vai até a quarta seguinte.
 */
export function addBusinessDays(fromIso: string, count: number, holidayIsoDates: Iterable<string>): string {
  const holidays = new Set(holidayIsoDates)
  let current = fromIso
  let added = 0
  while (added < count) {
    current = addDaysIso(current, 1)
    const weekday = new Date(`${current}T12:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !holidays.has(current)) added++
  }
  return current
}

/** Combustíveis que uma autorização pode liberar (FLEX, HIBRIDO e ELETRICO não são combustível de bomba). */
export const AUTHORIZABLE_FUELS = ['GASOLINA', 'ETANOL', 'DIESEL_S10', 'DIESEL_S500', 'GNV'] as const
export type AuthorizableFuel = (typeof AUTHORIZABLE_FUELS)[number]

/**
 * Combustíveis de bomba aceitos por cada tipo de motor.
 * - Diesel S500: o S10 também serve (é o mesmo diesel, com menos enxofre); o contrário não.
 * - GNV: os veículos são convertidos e mantêm a gasolina.
 * - Elétrico: nenhum — não há o que abastecer.
 */
const COMPATIBLE_FUELS: Record<FleetFuelType, AuthorizableFuel[]> = {
  GASOLINA: ['GASOLINA'],
  ETANOL: ['ETANOL'],
  FLEX: ['GASOLINA', 'ETANOL'],
  HIBRIDO: ['GASOLINA', 'ETANOL'],
  DIESEL_S10: ['DIESEL_S10'],
  DIESEL_S500: ['DIESEL_S500', 'DIESEL_S10'],
  GNV: ['GNV', 'GASOLINA'],
  ELETRICO: [],
}

export function compatibleFuels(vehicleFuel: FleetFuelType): AuthorizableFuel[] {
  return COMPATIBLE_FUELS[vehicleFuel]
}

export const FUEL_LABELS: Record<FleetFuelType, string> = {
  GASOLINA: 'Gasolina',
  ETANOL: 'Etanol',
  FLEX: 'Flex',
  HIBRIDO: 'Híbrido',
  DIESEL_S10: 'Diesel S10',
  DIESEL_S500: 'Diesel S500',
  GNV: 'GNV',
  ELETRICO: 'Elétrico',
}

/**
 * Categoria mínima de CNH por tipo de veículo (CTB, art. 143). `null` quando o
 * tipo não define a categoria sozinho (máquina, reboque, outro): a categoria
 * depende de peso e uso, então o sistema só avisa, não bloqueia.
 */
const REQUIRED_CNH: Record<FleetVehicleType, 'A' | 'B' | 'C' | 'D' | 'E' | null> = {
  MOTOCICLETA: 'A',
  AUTOMOVEL: 'B',
  CAMINHONETE: 'B',
  CAMIONETA: 'B',
  UTILITARIO: 'B',
  CAMINHAO: 'C',
  MICROONIBUS: 'D',
  ONIBUS: 'D',
  CAMINHAO_TRATOR: 'E',
  MAQUINA: null,
  REBOQUE: null,
  OUTRO: null,
}

export function requiredCnhCategory(vehicleType: FleetVehicleType): 'A' | 'B' | 'C' | 'D' | 'E' | null {
  return REQUIRED_CNH[vehicleType]
}

const FOUR_WHEEL_RANK: Record<string, number> = { B: 1, C: 2, D: 3, E: 4 }

/**
 * A categoria do motorista habilita a categoria exigida? As de quatro rodas são
 * cumulativas (E dirige D, C e B); a A é independente e vem combinada (AB, AC…).
 */
export function cnhCovers(held: FleetCnhCategory, required: 'A' | 'B' | 'C' | 'D' | 'E'): boolean {
  if (required === 'A') return held.startsWith('A')
  const fourWheel = held.replace('A', '')
  if (!fourWheel) return false
  return FOUR_WHEEL_RANK[fourWheel] >= FOUR_WHEEL_RANK[required]
}
