import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { FleetError } from '@/services/fleet-error.js'
import { fleetPiiService } from '@/services/fleet-pii.service.js'
import { type FleetScope, assertDepartmentAllowed, departmentWhere } from '@/services/fleet-scope.service.js'
import type { CreateDriverBody, ListDriversQuery, UpdateDriverBody } from '@/schemas/fleet.schemas.js'
import { isValidCnhNumber, isValidCpf, maskCnhNumber, maskCpf, onlyDigits } from '@/utils/fleet-validators.js'

/**
 * Motoristas do Simplifica Frotas (TASK 1/2/4).
 *
 * CPF e nº da CNH só existem cifrados no banco (fleet-pii.service). Respostas da
 * API e auditoria levam apenas as versões mascaradas; nenhuma rota devolve o CPF
 * inteiro. Unicidade de CPF por organização entre ativos pelo blind index (índice
 * parcial no banco).
 */

const SELECT = {
  id: true,
  name: true,
  cpfEncrypted: true,
  cnhNumberEncrypted: true,
  cnhCategory: true,
  cnhExpiry: true,
  cnhStatus: true,
  employmentKind: true,
  active: true,
  departmentId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.FleetDriverSelect

type DriverRow = Prisma.FleetDriverGetPayload<{ select: typeof SELECT }>

/** Remove os campos cifrados e devolve só as máscaras. */
function toPublic(scope: FleetScope, row: DriverRow) {
  const { cpfEncrypted, cnhNumberEncrypted, ...rest } = row
  return {
    ...rest,
    cnhExpiry: row.cnhExpiry.toISOString().slice(0, 10),
    cpfMasked: maskCpf(fleetPiiService.decrypt(scope.organizationId, cpfEncrypted)),
    cnhMasked: maskCnhNumber(fleetPiiService.decrypt(scope.organizationId, cnhNumberEncrypted)),
  }
}

function parseCpf(value: string): string {
  const cpf = onlyDigits(value)
  if (!isValidCpf(cpf)) {
    throw new FleetError('INVALID_CPF', 'O CPF informado não é válido. Confira os 11 dígitos.')
  }
  return cpf
}

function parseCnh(value: string): string {
  const cnh = onlyDigits(value)
  if (!isValidCnhNumber(cnh)) {
    throw new FleetError('INVALID_CNH', 'O número da CNH precisa ter 11 dígitos. Confira no documento do motorista.')
  }
  return cnh
}

async function assertUserAllowed(scope: FleetScope, userId: string | null | undefined) {
  if (!userId) return
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: scope.organizationId },
    select: { id: true },
  })
  if (!user) throw new FleetError('INVALID_USER', 'O usuário vinculado não existe nesta organização.')
}

async function assertCpfFree(tx: Prisma.TransactionClient, scope: FleetScope, cpfBlindIndex: string, exceptId?: string) {
  const clash = await tx.fleetDriver.findFirst({
    where: {
      organizationId: scope.organizationId,
      cpfBlindIndex,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { name: true, departmentId: true },
  })
  if (!clash) return

  // O nome só aparece se o cadastro existente estiver no escopo de quem chama.
  // Sem isso, qualquer usuário com fleet:manage poderia testar CPFs e descobrir
  // nomes de motoristas de departamentos que ele não enxerga.
  const visible =
    scope.allDepartments || clash.departmentId === null || scope.departmentIds.includes(clash.departmentId)
  throw new FleetError(
    'CPF_ALREADY_REGISTERED',
    visible
      ? `Este CPF já está cadastrado para o motorista ${clash.name}. Edite o cadastro existente em vez de criar outro.`
      : 'Este CPF já está cadastrado em outro departamento desta organização. Peça ao gestor de frota para localizar o cadastro.'
  )
}

function translateUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new FleetError('CPF_ALREADY_REGISTERED', 'Este CPF já está cadastrado para outro motorista ativo desta organização.')
  }
  throw error
}

function auditBase(scope: FleetScope) {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
    ip: scope.ip,
    userAgent: scope.userAgent ?? null,
    resource: 'FLEET_DRIVER',
  }
}

export const fleetDriverService = {
  async list(scope: FleetScope, query: ListDriversQuery) {
    fleetPiiService.assertConfigured()
    const search = query.search?.trim()
    const digits = search ? onlyDigits(search) : ''
    // Busca por CPF só com o CPF completo e válido (via blind index): o CPF não
    // existe em claro no banco para buscar por pedaço.
    const cpfSearch = digits.length === 11 && isValidCpf(digits) ? fleetPiiService.blindIndex(scope.organizationId, digits) : null

    const where: Prisma.FleetDriverWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      ...departmentWhere(scope),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(search
        ? cpfSearch
          ? { cpfBlindIndex: cpfSearch }
          : { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.fleetDriver.findMany({
        where,
        select: SELECT,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.fleetDriver.count({ where }),
    ])

    return {
      data: rows.map(row => toPublic(scope, row)),
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    }
  },

  async getById(scope: FleetScope, id: string) {
    fleetPiiService.assertConfigured()
    const row = await prisma.fleetDriver.findFirst({
      where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
      select: SELECT,
    })
    if (!row) throw new FleetError('NOT_FOUND', 'Motorista não encontrado.')
    return toPublic(scope, row)
  },

  async create(scope: FleetScope, input: CreateDriverBody) {
    fleetPiiService.assertConfigured()
    const cpf = parseCpf(input.cpf)
    const cnh = parseCnh(input.cnhNumber)
    await assertDepartmentAllowed(scope, input.departmentId)
    await assertUserAllowed(scope, input.userId)
    const cpfBlindIndex = fleetPiiService.blindIndex(scope.organizationId, cpf)

    try {
      return await prisma.$transaction(async tx => {
        await assertCpfFree(tx, scope, cpfBlindIndex)

        const row = await tx.fleetDriver.create({
          data: {
            organizationId: scope.organizationId,
            createdById: scope.userId,
            name: input.name,
            cpfEncrypted: fleetPiiService.encrypt(scope.organizationId, cpf),
            cpfBlindIndex,
            cnhNumberEncrypted: fleetPiiService.encrypt(scope.organizationId, cnh),
            cnhCategory: input.cnhCategory,
            cnhExpiry: new Date(`${input.cnhExpiry}T00:00:00Z`),
            cnhStatus: input.cnhStatus,
            employmentKind: input.employmentKind,
            active: input.active ?? true,
            departmentId: input.departmentId ?? null,
            userId: input.userId ?? null,
          },
          select: SELECT,
        })

        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_DRIVER_CREATED',
            resourceId: row.id,
            // CPF e CNH só mascarados na trilha (rules/fleet.md, item 5).
            details: { name: row.name, cpf: maskCpf(cpf), cnhCategory: row.cnhCategory },
          },
          tx
        )
        return toPublic(scope, row)
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async update(scope: FleetScope, id: string, input: UpdateDriverBody) {
    await this.getById(scope, id)
    if (input.departmentId !== undefined) await assertDepartmentAllowed(scope, input.departmentId)
    if (input.userId !== undefined) await assertUserAllowed(scope, input.userId)

    const cpf = input.cpf !== undefined ? parseCpf(input.cpf) : undefined
    const cnh = input.cnhNumber !== undefined ? parseCnh(input.cnhNumber) : undefined
    const cpfBlindIndex = cpf ? fleetPiiService.blindIndex(scope.organizationId, cpf) : undefined

    const data: Prisma.FleetDriverUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(cpf ? { cpfEncrypted: fleetPiiService.encrypt(scope.organizationId, cpf), cpfBlindIndex } : {}),
      ...(cnh ? { cnhNumberEncrypted: fleetPiiService.encrypt(scope.organizationId, cnh) } : {}),
      ...(input.cnhCategory ? { cnhCategory: input.cnhCategory } : {}),
      ...(input.cnhExpiry ? { cnhExpiry: new Date(`${input.cnhExpiry}T00:00:00Z`) } : {}),
      ...(input.cnhStatus ? { cnhStatus: input.cnhStatus } : {}),
      ...(input.employmentKind ? { employmentKind: input.employmentKind } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    }

    try {
      return await prisma.$transaction(async tx => {
        if (cpfBlindIndex) await assertCpfFree(tx, scope, cpfBlindIndex, id)

        const updated = await tx.fleetDriver.updateMany({
          where: { id, organizationId: scope.organizationId, deletedAt: null },
          data,
        })
        if (updated.count === 0) throw new FleetError('NOT_FOUND', 'Motorista não encontrado.')

        const row = await tx.fleetDriver.findFirstOrThrow({ where: { id }, select: SELECT })
        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_DRIVER_UPDATED',
            resourceId: id,
            // Só os NOMES dos campos alterados — nunca os valores de CPF/CNH.
            details: { fields: Object.keys(data).filter(k => k !== 'cpfBlindIndex'), name: row.name },
          },
          tx
        )
        return toPublic(scope, row)
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async remove(scope: FleetScope, id: string) {
    const driver = await this.getById(scope, id)

    await prisma.$transaction(async tx => {
      const [openAuthorizations, tripsInProgress] = await Promise.all([
        tx.fleetFueling.count({
          where: { driverId: id, deletedAt: null, status: 'ISSUED', lifecycle: { in: ['OPEN', 'IN_USE', 'AWAITING_REVIEW'] } },
        }),
        tx.fleetTrip.count({ where: { driverId: id, deletedAt: null, status: 'EM_CURSO' } }),
      ])
      if (openAuthorizations > 0 || tripsInProgress > 0) {
        throw new FleetError(
          'DRIVER_IN_USE',
          `${driver.name} tem autorização de abastecimento aberta ou viagem em curso. Encerre-as antes de excluir o cadastro.`,
          { openAuthorizations, tripsInProgress }
        )
      }

      const deleted = await tx.fleetDriver.updateMany({
        where: { id, organizationId: scope.organizationId, deletedAt: null },
        data: { deletedAt: new Date(), active: false },
      })
      if (deleted.count === 0) throw new FleetError('NOT_FOUND', 'Motorista não encontrado.')

      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_DRIVER_DELETED', resourceId: id, details: { name: driver.name } },
        tx
      )
    })
  },
}
