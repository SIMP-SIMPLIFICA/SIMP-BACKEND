import { z } from 'zod'
import { decimal, id, isoDate, pageQuery, text } from '@/schemas/fleet.schemas.js'
import { AUTHORIZABLE_FUELS } from '@/utils/fleet-fueling-rules.js'

/**
 * Schemas das rotas de contrato e de autorização de abastecimento (TASK 3A).
 * Todas `.strict()` (D4): `organizationId`, `status`, `lifecycle`,
 * `sha256Hash` e afins nunca entram pelo corpo.
 */

const fuel = z.enum(AUTHORIZABLE_FUELS)

// ─── Contratos de combustível ───────────────────────────────────────────────

const contractBase = {
  number: text(1, 40),
  supplierName: text(3, 160),
  supplierCnpj: z.string().trim().min(1).max(20),
  object: text(3, 500),
  fuelType: fuel,
  unitPrice: decimal(4, 99_999),
  totalAmount: decimal(2),
  maxVolumeL: decimal(3, 9_999_999).nullable().optional(),
  commitmentNumber: text(1, 40).nullable().optional(),
  qddItemId: id.nullable().optional(),
  startDate: isoDate,
  endDate: isoDate,
}

export const createContractBody = z.object(contractBase).strict()
export const updateContractBody = z.object(contractBase).partial().strict()

export const listContractsQuery = z
  .object({
    ...pageQuery,
    search: z.string().trim().max(60).optional(),
    fuelType: fuel.optional(),
    /** Só os vigentes hoje (início ≤ hoje ≤ fim). */
    inForce: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  })
  .strict()

// ─── Autorização de abastecimento ───────────────────────────────────────────

/**
 * Limites: preço unitário obrigatório e ao menos um entre litros e valor. O
 * que faltar o servidor calcula (valor = litros × preço; litros = valor ÷
 * preço, para baixo). O cálculo é sempre do servidor, em Decimal (D2).
 */
const fuelingBase = {
  departmentId: id,
  vehicleId: id,
  driverId: id,
  fuelType: fuel,
  contractId: id.nullable().optional(),
  qddItemId: id.nullable().optional(),
  unitPriceCap: decimal(4, 99_999),
  maxVolumeL: decimal(3, 99_999).nullable().optional(),
  maxAmount: decimal(2, 9_999_999).nullable().optional(),
  /** Último dia de validade (AAAA-MM-DD, vale até 23:59 de Brasília). Padrão: 3 dias úteis. */
  validUntil: isoDate.optional(),
  purpose: text(15, 500),
}

const hasALimit = (v: { maxVolumeL?: string | null; maxAmount?: string | null }) => Boolean(v.maxVolumeL || v.maxAmount)
const LIMIT_MESSAGE = { message: 'Informe os litros ou o valor máximo (ou os dois).', path: ['maxVolumeL'] }

export const createFuelingBody = z.object(fuelingBase).strict().refine(hasALimit, LIMIT_MESSAGE)

/**
 * Edição do rascunho. Os três limites andam juntos: quem mexe em litros, valor
 * ou preço manda o preço e ao menos um dos dois, e o servidor recalcula o outro.
 */
export const updateFuelingBody = z
  .object(fuelingBase)
  .partial()
  .strict()
  .refine(
    v =>
      (v.maxVolumeL === undefined && v.maxAmount === undefined && v.unitPriceCap === undefined) ||
      (v.unitPriceCap !== undefined && hasALimit(v)),
    { message: 'Ao alterar os limites, envie o preço unitário e os litros ou o valor máximo.', path: ['unitPriceCap'] }
  )

const LIFECYCLES = ['OPEN', 'IN_USE', 'AWAITING_REVIEW', 'USED', 'CLOSED', 'EXPIRED', 'BLOCKED', 'CANCELLED'] as const

export const listFuelingsQuery = z
  .object({
    ...pageQuery,
    status: z.enum(['PENDING', 'ISSUED']).optional(),
    lifecycle: z.enum(LIFECYCLES).optional(),
    departmentId: id.optional(),
    vehicleId: id.optional(),
    /** Nº da autorização ("12/2026") ou placa. */
    search: z.string().trim().max(30).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()

export const fuelingOptionsQuery = z.object({ departmentId: id }).strict()

export const fuelingSuggestionsQuery = z.object({ departmentId: id, vehicleId: id }).strict()

export const cancelFuelingBody = z.object({ reason: text(10, 500) }).strict()

export type CreateContractBody = z.infer<typeof createContractBody>
export type UpdateContractBody = z.infer<typeof updateContractBody>
export type ListContractsQuery = z.infer<typeof listContractsQuery>
export type CreateFuelingBody = z.infer<typeof createFuelingBody>
export type UpdateFuelingBody = z.infer<typeof updateFuelingBody>
export type ListFuelingsQuery = z.infer<typeof listFuelingsQuery>
