import { z } from 'zod'

/**
 * Schemas Zod das rotas do Frotas. Toda rota nova usa `.strict()` (decisão D4):
 * campo extra é recusado com 400 — `organizationId`, `status` de documento ou
 * `odometerKm` nunca entram pelo corpo.
 *
 * IDs: `departmentId` é nanoid e o resto do Frotas é cuid — nunca `.uuid()`
 * (exceto `userId`, que é o uuid do usuário do SIMP).
 */

const id = z.string().trim().min(1).max(64)

/** Decimal como string ("40.5"), nunca float. Número também é aceito e vira string. */
const decimal = (scale: number, max = 999_999_999) =>
  z
    .union([z.string(), z.number()])
    .transform(v => String(v).trim().replace(',', '.'))
    .refine(v => new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(v), `Use até ${scale} casas decimais.`)
    .refine(v => Number(v) > 0 && Number(v) <= max, 'Valor fora do intervalo permitido.')

const text = (min: number, max: number) =>
  z.string().transform(v => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(min).max(max))

const currentYear = new Date().getUTCFullYear()
const year = z.coerce.number().int().min(1950).max(currentYear + 1)

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}

export const idParams = z.object({ id }).strict()

// ─── Veículos ────────────────────────────────────────────────────────────────

const vehicleBase = {
  plate: z.string().trim().min(1).max(10),
  renavam: z.string().trim().max(20).nullable().optional(),
  chassis: z.string().trim().max(20).nullable().optional(),
  makeModel: text(1, 120).nullable().optional(),
  manufactureYear: year.nullable().optional(),
  modelYear: year.nullable().optional(),
  ownership: z.enum(['PROPRIO', 'LOCADO', 'CEDIDO', 'COMODATO']),
  vehicleType: z.enum([
    'AUTOMOVEL', 'CAMINHONETE', 'CAMIONETA', 'UTILITARIO', 'MOTOCICLETA', 'MICROONIBUS',
    'ONIBUS', 'CAMINHAO', 'CAMINHAO_TRATOR', 'REBOQUE', 'MAQUINA', 'OUTRO',
  ]),
  fuelType: z.enum(['GASOLINA', 'ETANOL', 'FLEX', 'DIESEL_S10', 'DIESEL_S500', 'GNV', 'ELETRICO', 'HIBRIDO']),
  usesArla32: z.boolean().optional(),
  tankCapacityL: decimal(3, 5000),
  referenceKmPerL: decimal(2, 999).nullable().optional(),
  workRegime: z.enum(['PADRAO_8H', 'INTEGRAL_24H']).optional(),
  status: z.enum(['EM_USO', 'RESERVA', 'MANUTENCAO', 'ACIDENTADO', 'PARALISADO', 'A_DOAR', 'BAIXADO']).optional(),
  assetTag: text(1, 60).nullable().optional(),
  marketValue: decimal(2).nullable().optional(),
  departmentId: id.nullable().optional(),
  ownerEntityId: id.nullable().optional(),
}

export const createVehicleBody = z
  .object({
    ...vehicleBase,
    /** Hodômetro inicial no cadastro. Depois só cresce por viagem/abastecimento. */
    odometerKm: z.coerce.number().int().min(0).max(9_999_999).optional(),
  })
  .strict()
  .refine(v => !v.manufactureYear || !v.modelYear || v.manufactureYear <= v.modelYear, {
    message: 'O ano de fabricação não pode ser maior que o ano do modelo.',
    path: ['manufactureYear'],
  })

export const updateVehicleBody = z.object(vehicleBase).partial().strict()

export const listVehiclesQuery = z
  .object({
    ...pageQuery,
    search: z.string().trim().max(60).optional(),
    status: vehicleBase.status,
    departmentId: id.optional(),
  })
  .strict()

// ─── Motoristas ──────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Data inválida.')

const driverBase = {
  name: text(3, 120),
  cpf: z.string().trim().min(1).max(20),
  cnhNumber: z.string().trim().min(1).max(20),
  cnhCategory: z.enum(['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE']),
  cnhExpiry: isoDate,
  cnhStatus: z.enum(['REGULAR', 'SUSPENSA', 'CASSADA', 'DESCONHECIDA']).optional(),
  employmentKind: z.enum(['EFETIVO', 'COMISSIONADO', 'CONTRATADO', 'TERCEIRIZADO']),
  departmentId: id.nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
}

export const createDriverBody = z.object(driverBase).strict()

/** Busca por CPF no corpo de um POST: CPF nunca vai na URL (log, histórico). */
export const lookupDriverBody = z.object({ cpf: z.string().trim().min(1).max(20) }).strict()
export const updateDriverBody = z.object(driverBase).partial().strict()

export const listDriversQuery = z
  .object({
    ...pageQuery,
    /** Só por nome. CPF é POST /drivers/lookup. */
    search: z.string().trim().max(60).optional(),
    active: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    departmentId: id.optional(),
  })
  .strict()

export type CreateVehicleBody = z.infer<typeof createVehicleBody>
export type UpdateVehicleBody = z.infer<typeof updateVehicleBody>
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuery>
export type CreateDriverBody = z.infer<typeof createDriverBody>
export type UpdateDriverBody = z.infer<typeof updateDriverBody>
export type ListDriversQuery = z.infer<typeof listDriversQuery>
