import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { FleetError } from '@/services/fleet-error.js'
import { type FleetScope, assertCanModify, assertDepartmentAllowed, departmentWhere } from '@/services/fleet-scope.service.js'
import type { CreateVehicleBody, ExportVehiclesBody, ListVehiclesQuery, UpdateVehicleBody } from '@/schemas/fleet.schemas.js'
import { USER_REF_SELECT, toUserRef } from '@/utils/fleet-user-ref.js'
import { isValidChassis, isValidPlate, isValidRenavam, normalizePlate, onlyDigits } from '@/utils/fleet-validators.js'

/**
 * Veículos do Simplifica Frotas (TASK 1/2/4).
 *
 * Regras: placa e Renavam normalizados e validados no servidor; únicos por
 * organização entre ativos (índice parcial no banco — a checagem prévia aqui só
 * existir para devolver mensagem orientadora); nº de patrimônio obrigatório para
 * veículo PRÓPRIO e único entre ativos; exclusão é soft-delete e é recusada
 * com autorização aberta ou viagem em curso; toda escrita audita na mesma
 * transação (D3).
 */

const SELECT = {
  id: true,
  plate: true,
  renavam: true,
  chassis: true,
  makeModel: true,
  manufactureYear: true,
  modelYear: true,
  ownership: true,
  vehicleType: true,
  fuelType: true,
  usesArla32: true,
  tankCapacityL: true,
  referenceKmPerL: true,
  workRegime: true,
  status: true,
  odometerKm: true,
  assetTag: true,
  marketValue: true,
  departmentId: true,
  ownerEntityId: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  ownerEntity: { select: { id: true, name: true } },
  createdBy: { select: USER_REF_SELECT },
  updatedBy: { select: USER_REF_SELECT },
} satisfies Prisma.FleetVehicleSelect

type VehicleRow = Prisma.FleetVehicleGetPayload<{ select: typeof SELECT }>

/** Autores reduzidos a id + nome (nada de e-mail ou perfil do usuário). */
function toPublic(row: VehicleRow) {
  return { ...row, createdBy: toUserRef(row.createdBy), updatedBy: toUserRef(row.updatedBy) }
}

export type PublicVehicle = ReturnType<typeof toPublic>

/**
 * Patrimônio é obrigatório para veículo PRÓPRIO: é o número do tombamento no
 * patrimônio do município. Locado, cedido e comodato não são bens da
 * organização e podem não ter.
 */
function assertAssetTagRule(ownership: string, assetTag: string | null | undefined) {
  if (ownership === 'PROPRIO' && !assetTag) {
    throw new FleetError(
      'ASSET_TAG_REQUIRED',
      'Informe o nº de patrimônio: ele é obrigatório para veículo próprio. Confira na plaqueta ou no setor de patrimônio.'
    )
  }
}

/**
 * Filtros da listagem — os mesmos usados pela relação em PDF, para que o
 * arquivo exportado traga exatamente o que a tela mostra.
 */
export function vehicleListWhere(scope: FleetScope, filters: ExportVehiclesBody): Prisma.FleetVehicleWhereInput {
  const search = filters.search?.trim()
  const plateSearch = search ? normalizePlate(search) : ''
  return {
    organizationId: scope.organizationId,
    deletedAt: null,
    ...departmentWhere(scope),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                ...(plateSearch ? [{ plate: { contains: plateSearch } }] : []),
                { makeModel: { contains: search, mode: 'insensitive' as const } },
                { assetTag: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          ],
        }
      : {}),
  }
}

export { SELECT as VEHICLE_SELECT, toPublic as toPublicVehicle }

function normalizeIdentifiers<T extends { plate?: string; renavam?: string | null; chassis?: string | null }>(input: T) {
  const out: { plate?: string; renavam?: string | null; chassis?: string | null } = {}

  if (input.plate !== undefined) {
    const plate = normalizePlate(input.plate)
    if (!isValidPlate(plate)) {
      throw new FleetError(
        'INVALID_PLATE',
        `A placa "${input.plate}" não é válida. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).`
      )
    }
    out.plate = plate
  }

  if (input.renavam !== undefined) {
    const renavam = input.renavam ? onlyDigits(input.renavam) : null
    if (renavam && !isValidRenavam(renavam)) {
      throw new FleetError('INVALID_RENAVAM', 'O Renavam informado não é válido: confira os 11 dígitos no CRLV do veículo.')
    }
    out.renavam = renavam
  }

  if (input.chassis !== undefined) {
    const chassis = input.chassis ? input.chassis.toUpperCase().replace(/\s/g, '') : null
    if (chassis && !isValidChassis(chassis)) {
      throw new FleetError('INVALID_CHASSIS', 'O chassi precisa ter 17 caracteres, sem as letras I, O e Q. Confira no CRLV.')
    }
    out.chassis = chassis
  }

  return out
}

async function assertOwnerEntityAllowed(scope: FleetScope, ownerEntityId: string | null | undefined) {
  if (!ownerEntityId) return
  const owner = await prisma.fleetOwnerEntity.findFirst({
    where: { id: ownerEntityId, organizationId: scope.organizationId, deletedAt: null },
    select: { id: true },
  })
  if (!owner) {
    throw new FleetError('INVALID_OWNER_ENTITY', 'A entidade proprietária informada não existe nesta organização.')
  }
}

/** Duplicidade entre ativos, com a mensagem certa antes que o índice parcial a recuse. */
async function assertUnique(
  tx: Prisma.TransactionClient,
  scope: FleetScope,
  values: { plate?: string; renavam?: string | null; assetTag?: string | null },
  exceptId?: string
) {
  const base = { organizationId: scope.organizationId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }

  if (values.plate) {
    const clash = await tx.fleetVehicle.findFirst({ where: { ...base, plate: values.plate }, select: { id: true } })
    if (clash) {
      throw new FleetError('PLATE_ALREADY_REGISTERED', `Já existe um veículo ativo com a placa ${values.plate} nesta organização.`)
    }
  }
  if (values.renavam) {
    const clash = await tx.fleetVehicle.findFirst({ where: { ...base, renavam: values.renavam }, select: { id: true } })
    if (clash) {
      throw new FleetError('RENAVAM_ALREADY_REGISTERED', 'Já existe um veículo ativo com este Renavam nesta organização.')
    }
  }
  if (values.assetTag) {
    const clash = await tx.fleetVehicle.findFirst({ where: { ...base, assetTag: values.assetTag }, select: { id: true } })
    if (clash) {
      throw new FleetError(
        'ASSET_TAG_ALREADY_REGISTERED',
        `O patrimônio ${values.assetTag} já está em outro veículo ativo desta organização. Confira o número na plaqueta.`
      )
    }
  }
}

/** Corrida entre duas criações: o índice parcial acusa P2002 — vira o mesmo erro orientador. */
function translateUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '')
    if (target.includes('asset_tag')) {
      throw new FleetError('ASSET_TAG_ALREADY_REGISTERED', 'Este nº de patrimônio já está em outro veículo ativo desta organização.')
    }
    if (target.includes('renavam')) {
      throw new FleetError('RENAVAM_ALREADY_REGISTERED', 'Já existe um veículo ativo com este Renavam nesta organização.')
    }
    throw new FleetError('PLATE_ALREADY_REGISTERED', 'Já existe um veículo ativo com esta placa nesta organização.')
  }
  throw error
}

function auditBase(scope: FleetScope) {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
    ip: scope.ip,
    userAgent: scope.userAgent ?? null,
    resource: 'FLEET_VEHICLE',
  }
}

export const fleetVehicleService = {
  async list(scope: FleetScope, query: ListVehiclesQuery) {
    const where = vehicleListWhere(scope, query)

    const [data, total] = await Promise.all([
      prisma.fleetVehicle.findMany({
        where,
        select: SELECT,
        orderBy: { plate: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.fleetVehicle.count({ where }),
    ])

    return { data: data.map(toPublic), meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) } }
  },

  async getById(scope: FleetScope, id: string) {
    const vehicle = await prisma.fleetVehicle.findFirst({
      where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
      select: SELECT,
    })
    if (!vehicle) throw new FleetError('NOT_FOUND', 'Veículo não encontrado.')
    return toPublic(vehicle)
  },

  async create(scope: FleetScope, input: CreateVehicleBody) {
    const ids = normalizeIdentifiers(input)
    assertAssetTagRule(input.ownership, input.assetTag)
    await assertDepartmentAllowed(scope, input.departmentId)
    await assertOwnerEntityAllowed(scope, input.ownerEntityId)

    try {
      return await prisma.$transaction(async tx => {
        await assertUnique(tx, scope, { ...ids, assetTag: input.assetTag })

        const vehicle = await tx.fleetVehicle.create({
          data: {
            organizationId: scope.organizationId,
            createdById: scope.userId,
            plate: ids.plate,
            renavam: ids.renavam ?? null,
            chassis: ids.chassis ?? null,
            makeModel: input.makeModel ?? null,
            manufactureYear: input.manufactureYear ?? null,
            modelYear: input.modelYear ?? null,
            ownership: input.ownership,
            vehicleType: input.vehicleType,
            fuelType: input.fuelType,
            usesArla32: input.usesArla32 ?? false,
            tankCapacityL: new Prisma.Decimal(input.tankCapacityL),
            referenceKmPerL: input.referenceKmPerL ? new Prisma.Decimal(input.referenceKmPerL) : null,
            workRegime: input.workRegime,
            status: input.status,
            odometerKm: input.odometerKm ?? 0,
            assetTag: input.assetTag ?? null,
            marketValue: input.marketValue ? new Prisma.Decimal(input.marketValue) : null,
            departmentId: input.departmentId ?? null,
            ownerEntityId: input.ownerEntityId ?? null,
          },
          select: SELECT,
        })

        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_VEHICLE_CREATED',
            resourceId: vehicle.id,
            details: {
              plate: vehicle.plate,
              assetTag: vehicle.assetTag,
              departmentId: vehicle.departmentId,
              status: vehicle.status,
            },
          },
          tx
        )
        return toPublic(vehicle)
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async update(scope: FleetScope, id: string, input: UpdateVehicleBody) {
    const current = await this.getById(scope, id)
    assertCanModify(scope, current.departmentId)
    const ids = normalizeIdentifiers(input)
    if (input.departmentId !== undefined) await assertDepartmentAllowed(scope, input.departmentId)
    if (input.ownerEntityId !== undefined) await assertOwnerEntityAllowed(scope, input.ownerEntityId)

    const data: Prisma.FleetVehicleUncheckedUpdateInput = {
      ...ids,
      ...(input.makeModel !== undefined ? { makeModel: input.makeModel } : {}),
      ...(input.manufactureYear !== undefined ? { manufactureYear: input.manufactureYear } : {}),
      ...(input.modelYear !== undefined ? { modelYear: input.modelYear } : {}),
      ...(input.ownership ? { ownership: input.ownership } : {}),
      ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
      ...(input.fuelType ? { fuelType: input.fuelType } : {}),
      ...(input.usesArla32 !== undefined ? { usesArla32: input.usesArla32 } : {}),
      ...(input.tankCapacityL ? { tankCapacityL: new Prisma.Decimal(input.tankCapacityL) } : {}),
      ...(input.referenceKmPerL !== undefined
        ? { referenceKmPerL: input.referenceKmPerL ? new Prisma.Decimal(input.referenceKmPerL) : null }
        : {}),
      ...(input.workRegime ? { workRegime: input.workRegime } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.assetTag !== undefined ? { assetTag: input.assetTag } : {}),
      ...(input.marketValue !== undefined
        ? { marketValue: input.marketValue ? new Prisma.Decimal(input.marketValue) : null }
        : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.ownerEntityId !== undefined ? { ownerEntityId: input.ownerEntityId } : {}),
    }

    const mergedYears = {
      manufactureYear: input.manufactureYear !== undefined ? input.manufactureYear : current.manufactureYear,
      modelYear: input.modelYear !== undefined ? input.modelYear : current.modelYear,
    }
    if (mergedYears.manufactureYear && mergedYears.modelYear && mergedYears.manufactureYear > mergedYears.modelYear) {
      throw new FleetError('INVALID_VEHICLE_YEARS', 'O ano de fabricação não pode ser maior que o ano do modelo.')
    }
    // Só quando a alteração mexe em propriedade ou patrimônio: veículo próprio
    // cadastrado antes da regra continua aceitando, por exemplo, troca de
    // situação; o formulário de edição (que envia tudo) já exige o número.
    if (input.ownership !== undefined || input.assetTag !== undefined) {
      assertAssetTagRule(
        input.ownership ?? current.ownership,
        input.assetTag !== undefined ? input.assetTag : current.assetTag
      )
    }
    data.updatedById = scope.userId

    try {
      return await prisma.$transaction(async tx => {
        await assertUnique(tx, scope, { ...ids, assetTag: input.assetTag }, id)

        // updateMany com organizationId no filtro: nunca altera registro de outra
        // organização, mesmo que o id venha de lá.
        const updated = await tx.fleetVehicle.updateMany({
          where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
          data,
        })
        if (updated.count === 0) throw new FleetError('NOT_FOUND', 'Veículo não encontrado.')

        const vehicle = await tx.fleetVehicle.findFirstOrThrow({ where: { id }, select: SELECT })
        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_VEHICLE_UPDATED',
            resourceId: id,
            details: { fields: Object.keys(data).filter(k => k !== 'updatedById'), plate: vehicle.plate },
          },
          tx
        )
        return toPublic(vehicle)
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async remove(scope: FleetScope, id: string) {
    const vehicle = await this.getById(scope, id)
    assertCanModify(scope, vehicle.departmentId)

    await prisma.$transaction(async tx => {
      const [openAuthorizations, tripsInProgress] = await Promise.all([
        tx.fleetFueling.count({
          where: { vehicleId: id, deletedAt: null, status: 'ISSUED', lifecycle: { in: ['OPEN', 'IN_USE', 'AWAITING_REVIEW'] } },
        }),
        tx.fleetTrip.count({ where: { vehicleId: id, deletedAt: null, status: 'EM_CURSO' } }),
      ])
      if (openAuthorizations > 0 || tripsInProgress > 0) {
        throw new FleetError(
          'VEHICLE_IN_USE',
          `O veículo ${vehicle.plate} tem autorização de abastecimento aberta ou viagem em curso. Encerre-as antes de excluir.`,
          { openAuthorizations, tripsInProgress }
        )
      }

      const deleted = await tx.fleetVehicle.updateMany({
        where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
        data: { deletedAt: new Date(), updatedById: scope.userId },
      })
      if (deleted.count === 0) throw new FleetError('NOT_FOUND', 'Veículo não encontrado.')

      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_VEHICLE_DELETED', resourceId: id, details: { plate: vehicle.plate } },
        tx
      )
    })
  },
}
