import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { FleetError } from '@/services/fleet-error.js'
import { fleetPiiService } from '@/services/fleet-pii.service.js'
import { userHasPermission } from '@/services/rbac.service.js'
import { type FleetScope, assertCanModify, assertDepartmentAllowed, departmentWhere } from '@/services/fleet-scope.service.js'
import type { CreateDriverBody, ExportDriversBody, ListDriversQuery, UpdateDriverBody } from '@/schemas/fleet.schemas.js'
import { USER_REF_SELECT, toUserRef } from '@/utils/fleet-user-ref.js'
import { isValidCnhNumber, isValidCpf, maskCnhNumber, maskCpf, onlyDigits } from '@/utils/fleet-validators.js'

/**
 * Motoristas do Simplifica Frotas (TASK 1/2/4).
 *
 * CPF e nº da CNH só existem cifrados no banco (fleet-pii.service). Respostas da
 * API e auditoria levam apenas as versões mascaradas; nenhuma rota devolve o CPF
 * inteiro. Unicidade de CPF por organização entre ativos pelo blind index (índice
 * parcial no banco).
 *
 * Matrícula: obrigatória para EFETIVO e COMISSIONADO, única entre ativos. No
 * cadastro, se vier em branco, é sugerida pelo beneficiário de Diárias com o
 * mesmo CPF na organização.
 */

/** Vínculos em que a matrícula funcional é obrigatória. */
const REGISTRATION_REQUIRED_KINDS = new Set(['EFETIVO', 'COMISSIONADO'])

const SELECT = {
  id: true,
  name: true,
  registrationNumber: true,
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
  user: { select: USER_REF_SELECT },
  createdBy: { select: USER_REF_SELECT },
  updatedBy: { select: USER_REF_SELECT },
} satisfies Prisma.FleetDriverSelect

type DriverRow = Prisma.FleetDriverGetPayload<{ select: typeof SELECT }>

/** Remove os campos cifrados e devolve só as máscaras. */
function toPublic(scope: FleetScope, row: DriverRow) {
  const { cpfEncrypted, cnhNumberEncrypted, ...rest } = row
  return {
    ...rest,
    user: toUserRef(row.user),
    createdBy: toUserRef(row.createdBy),
    updatedBy: toUserRef(row.updatedBy),
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

function assertRegistrationRule(employmentKind: string, registrationNumber: string | null | undefined) {
  if (REGISTRATION_REQUIRED_KINDS.has(employmentKind) && !registrationNumber) {
    throw new FleetError(
      'REGISTRATION_REQUIRED',
      'Informe a matrícula: ela é obrigatória para servidor efetivo e comissionado. Confira no contracheque ou no RH.'
    )
  }
}

/**
 * Mensagem genérica de propósito: dizer QUEM tem a matrícula revelaria nome de
 * motorista de departamento fora do escopo de quem cadastra.
 */
async function assertRegistrationFree(
  tx: Prisma.TransactionClient,
  scope: FleetScope,
  registrationNumber: string | null | undefined,
  exceptId?: string
) {
  if (!registrationNumber) return
  const clash = await tx.fleetDriver.findFirst({
    where: {
      organizationId: scope.organizationId,
      registrationNumber,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    throw new FleetError(
      'REGISTRATION_ALREADY_REGISTERED',
      'Esta matrícula já está cadastrada para outro motorista ativo desta organização. Confira o número.'
    )
  }
}

/** Permissões de Diárias que já dão acesso ao cadastro de beneficiários. */
const DAILY_ALLOWANCE_PERMISSIONS = ['dailyAllowances:read', 'dailyAllowances:write', 'dailyAllowances:issue', 'dailyAllowances:delete']

/**
 * A sugestão só roda para quem JÁ enxerga Diárias (módulo ligado + permissão):
 * sem isso, quem só tem fleet:manage confirmaria, cadastrando um CPF, que a
 * pessoa é beneficiária de diárias e obteria a matrícula dela.
 */
async function canReadBeneficiaries(scope: FleetScope): Promise<boolean> {
  const enabled = await prisma.organizationModule.findFirst({
    where: { organizationId: scope.organizationId, module: 'dailyAllowances', isEnabled: true },
    select: { module: true },
  })
  if (!enabled) return false
  const checks = await Promise.all(DAILY_ALLOWANCE_PERMISSIONS.map(p => userHasPermission(scope.userId, p)))
  return checks.some(Boolean)
}

/**
 * Matrícula do beneficiário de Diárias com o mesmo CPF, na MESMA organização.
 * Diárias guarda o CPF em dígitos (não cifrado), por isso a busca é direta.
 */
async function registrationFromBeneficiary(tx: Prisma.TransactionClient, scope: FleetScope, cpf: string) {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { cpf_organizationId: { cpf, organizationId: scope.organizationId } },
    select: { registrationNumber: true },
  })
  return beneficiary?.registrationNumber?.trim() || null
}

/** Filtros da listagem/relação. Nome por `search`; matrícula só chega por corpo de POST. */
export function driverListWhere(scope: FleetScope, filters: ExportDriversBody): Prisma.FleetDriverWhereInput {
  const search = filters.search?.trim()
  const registration = filters.registration?.trim()
  return {
    organizationId: scope.organizationId,
    deletedAt: null,
    ...departmentWhere(scope),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    ...(registration ? { registrationNumber: { contains: registration, mode: 'insensitive' as const } } : {}),
  }
}

export { SELECT as DRIVER_SELECT, toPublic as toPublicDriver }

function translateUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    if (String(error.meta?.target ?? '').includes('registration_number')) {
      throw new FleetError(
        'REGISTRATION_ALREADY_REGISTERED',
        'Esta matrícula já está cadastrada para outro motorista ativo desta organização.'
      )
    }
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
    // Busca da listagem é só por NOME: ela viaja na query string, que aparece
    // em log de requisição, histórico do navegador e proxies. Busca por CPF é
    // `lookupByCpf`, com o CPF no corpo de um POST.
    const where = driverListWhere(scope, { search: query.search, active: query.active, departmentId: query.departmentId })

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

  /**
   * Localiza motorista pelo CPF completo (blind index), respeitando o escopo de
   * departamento. O CPF chega no CORPO (POST), nunca na URL.
   */
  async lookupByCpf(scope: FleetScope, cpfInput: string) {
    fleetPiiService.assertConfigured()
    const cpf = parseCpf(cpfInput)
    // Cada localização é auditada (sem o CPF): com a rota sob limite próprio de
    // tentativas, a trilha é o que denuncia uma varredura de CPFs.
    return prisma.$transaction(async tx => {
      const rows = await tx.fleetDriver.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          cpfBlindIndex: fleetPiiService.blindIndex(scope.organizationId, cpf),
          ...departmentWhere(scope),
        },
        select: SELECT,
      })
      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_DRIVER_LOOKUP', resourceId: rows[0]?.id ?? null, details: { found: rows.length } },
        tx
      )
      return { data: rows.map(row => toPublic(scope, row)) }
    })
  },

  /**
   * Busca por matrícula (parcial), com o termo no CORPO de um POST: a tela não
   * distingue matrícula numérica de CPF incompleto, então nada com dígito vai
   * para a URL. Respeita o escopo de departamento.
   */
  async searchByRegistration(scope: FleetScope, registration: string) {
    fleetPiiService.assertConfigured()
    const rows = await prisma.fleetDriver.findMany({
      where: driverListWhere(scope, { registration }),
      select: SELECT,
      orderBy: { name: 'asc' },
      take: 50,
    })
    return { data: rows.map(row => toPublic(scope, row)) }
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
    const mayUseBeneficiary = !input.registrationNumber && (await canReadBeneficiaries(scope))

    try {
      return await prisma.$transaction(async tx => {
        await assertCpfFree(tx, scope, cpfBlindIndex)

        // Campo próprio + sugestão: em branco, tenta a matrícula de Diárias.
        let registrationNumber = input.registrationNumber ?? null
        let registrationSource: 'INFORMED' | 'BENEFICIARY' | null = registrationNumber ? 'INFORMED' : null
        if (!registrationNumber && mayUseBeneficiary) {
          registrationNumber = await registrationFromBeneficiary(tx, scope, cpf)
          if (registrationNumber) registrationSource = 'BENEFICIARY'
        }
        assertRegistrationRule(input.employmentKind, registrationNumber)
        await assertRegistrationFree(tx, scope, registrationNumber)

        const row = await tx.fleetDriver.create({
          data: {
            organizationId: scope.organizationId,
            createdById: scope.userId,
            name: input.name,
            registrationNumber,
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
            details: { name: row.name, cpf: maskCpf(cpf), cnhCategory: row.cnhCategory, registrationSource },
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
    const current = await this.getById(scope, id)
    assertCanModify(scope, current.departmentId)
    if (input.departmentId !== undefined) await assertDepartmentAllowed(scope, input.departmentId)
    if (input.userId !== undefined) await assertUserAllowed(scope, input.userId)

    const cpf = input.cpf !== undefined ? parseCpf(input.cpf) : undefined
    const cnh = input.cnhNumber !== undefined ? parseCnh(input.cnhNumber) : undefined
    const cpfBlindIndex = cpf ? fleetPiiService.blindIndex(scope.organizationId, cpf) : undefined

    // Só quando a alteração mexe em vínculo ou matrícula (mesmo critério do
    // patrimônio no veículo): cadastros anteriores à regra seguem editáveis.
    if (input.employmentKind !== undefined || input.registrationNumber !== undefined) {
      assertRegistrationRule(
        input.employmentKind ?? current.employmentKind,
        input.registrationNumber !== undefined ? input.registrationNumber : current.registrationNumber
      )
    }

    const data: Prisma.FleetDriverUncheckedUpdateInput = {
      updatedById: scope.userId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber } : {}),
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
        await assertRegistrationFree(tx, scope, input.registrationNumber, id)

        const updated = await tx.fleetDriver.updateMany({
          where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
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
            details: {
              fields: Object.keys(data).filter(k => k !== 'cpfBlindIndex' && k !== 'updatedById'),
              name: row.name,
            },
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
    assertCanModify(scope, driver.departmentId)

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
        where: { id, organizationId: scope.organizationId, deletedAt: null, ...departmentWhere(scope) },
        data: { deletedAt: new Date(), active: false, updatedById: scope.userId },
      })
      if (deleted.count === 0) throw new FleetError('NOT_FOUND', 'Motorista não encontrado.')

      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_DRIVER_DELETED', resourceId: id, details: { name: driver.name } },
        tx
      )
    })
  },
}
