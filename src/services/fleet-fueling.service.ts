import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { config } from '@/config/config.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { budgetService } from '@/services/budget.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { contractUsage } from '@/services/fleet-contract.service.js'
import { FleetError } from '@/services/fleet-error.js'
import { buildFuelingPdf } from '@/services/fleet-fueling-document.js'
import { type FleetScope, assertDepartmentAllowed } from '@/services/fleet-scope.service.js'
import { userHasPermission } from '@/services/rbac.service.js'
import { deleteFile, readFile, saveFile } from '@/services/storage.service.js'
import type { CreateFuelingBody, ListFuelingsQuery, UpdateFuelingBody } from '@/schemas/fleet-fueling.schemas.js'
import { USER_REF_SELECT, toUserRef } from '@/utils/fleet-user-ref.js'
import {
  type AuthorizableFuel,
  FUEL_LABELS,
  addBusinessDays,
  cnhCovers,
  compatibleFuels,
  endOfLocalDay,
  localIsoDate,
  localYear,
  requiredCnhCategory,
} from '@/utils/fleet-fueling-rules.js'
import { normalizePlate } from '@/utils/fleet-validators.js'
import { withSerializableRetry } from '@/utils/serializable-retry.util.js'

/**
 * Autorização de abastecimento (TASK 3A — emissão). O `FleetFueling` é o
 * documento oficial: rascunho `PENDING` editável; `ISSUED` imutável, com PDF +
 * `sha256Hash` + `publicId` + `ExportedDocument` (D9, skill
 * simp-documento-oficial). O que avança depois da emissão é `lifecycle`.
 *
 * Regras da emissão (D16):
 * - quem emite tem `fleet:authorize_fuel` e o departamento que ordena no seu
 *   escopo; veículo e motorista são desse departamento ou da frota geral;
 * - motorista com CNH em dia, não suspensa/cassada e da categoria do veículo;
 * - combustível compatível com o motor e igual ao do contrato vigente;
 * - preço unitário até o do contrato; saldo do contrato BLOQUEIA, o da ficha
 *   QDD só avisa (`budgetOverrun`);
 * - número (padrão das Diárias) só na emissão; token do QR operacional de 128
 *   bits, gravado só como SHA-256 — o token existe apenas dentro do PDF.
 */

const ZERO = new Prisma.Decimal(0)
const DEFAULT_VALIDITY_BUSINESS_DAYS = 3
const MAX_VALIDITY_DAYS = 30
const ALLOWED_VEHICLE_STATUSES = ['EM_USO', 'RESERVA']
const OPEN_LIFECYCLES = ['OPEN', 'IN_USE', 'AWAITING_REVIEW'] as const

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  MANUTENCAO: 'em manutenção',
  ACIDENTADO: 'acidentado',
  PARALISADO: 'paralisado',
  A_DOAR: 'marcado para doação',
  BAIXADO: 'baixado',
}

const SELECT = {
  id: true,
  publicId: true,
  formattedNumber: true,
  sequenceNumber: true,
  year: true,
  status: true,
  lifecycle: true,
  departmentId: true,
  vehicleId: true,
  driverId: true,
  contractId: true,
  qddItemId: true,
  qddFichaSnapshot: true,
  qddFonteSnapshot: true,
  qddNaturezaSnapshot: true,
  fuelType: true,
  maxVolumeL: true,
  maxAmount: true,
  unitPriceCap: true,
  validUntil: true,
  purpose: true,
  plateAttempts: true,
  budgetOverrun: true,
  cancelReason: true,
  cancelledAt: true,
  sha256Hash: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  vehicle: {
    select: { id: true, plate: true, makeModel: true, vehicleType: true, fuelType: true, tankCapacityL: true, assetTag: true },
  },
  driver: { select: { id: true, name: true, cnhCategory: true, cnhExpiry: true } },
  contract: { select: { id: true, number: true, supplierName: true, supplierCnpj: true, unitPrice: true, endDate: true } },
  qddItem: { select: { id: true, ficha: true, fonte: true, naturezaDespesa: true } },
  createdBy: { select: USER_REF_SELECT },
  issuedBy: { select: USER_REF_SELECT },
  cancelledBy: { select: USER_REF_SELECT },
  redemption: {
    select: { mode: true, volumeL: true, unitPrice: true, totalAmount: true, odometerKm: true, submittedAt: true, reviewedAt: true },
  },
} satisfies Prisma.FleetFuelingSelect

type FuelingRow = Prisma.FleetFuelingGetPayload<{ select: typeof SELECT }>

export interface FuelingWarning {
  code: 'TANK_CAPACITY_EXCEEDED' | 'OPEN_AUTHORIZATION_EXISTS' | 'CNH_EXPIRES_BEFORE_VALIDITY' | 'CNH_CATEGORY_UNCHECKED' | 'BUDGET_OVERRUN'
  message: string
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const formatDateBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const brl = (value: Prisma.Decimal) => `R$ ${value.toFixed(2).replace('.', ',')}`
const litres = (value: Prisma.Decimal) => `${value.toFixed(3).replace(/\.?0+$/, '').replace('.', ',')} L`

function toPublic(row: FuelingRow, warnings: FuelingWarning[] = []) {
  const validUntilDay = localIsoDate(row.validUntil)
  return {
    ...row,
    driver: { ...row.driver, cnhExpiry: isoDay(row.driver.cnhExpiry) },
    contract: row.contract ? { ...row.contract, endDate: isoDay(row.contract.endDate) } : null,
    createdBy: toUserRef(row.createdBy),
    issuedBy: toUserRef(row.issuedBy),
    cancelledBy: toUserRef(row.cancelledBy),
    validUntilDate: validUntilDay,
    /** Emitida, ainda aberta e com a validade vencida — o job da TASK 3C a passa para EXPIRED. */
    isExpired: row.status === 'ISSUED' && row.lifecycle === 'OPEN' && row.validUntil < new Date(),
    warnings,
  }
}

export type PublicFueling = ReturnType<typeof toPublic>

/** Toda autorização tem departamento: sem `fleet:all_departments`, só as dos seus departamentos. */
function scopeWhere(scope: FleetScope): Prisma.FleetFuelingWhereInput {
  return {
    organizationId: scope.organizationId,
    deletedAt: null,
    ...(scope.allDepartments ? {} : { departmentId: { in: scope.departmentIds } }),
  }
}

function auditBase(scope: FleetScope) {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
    ip: scope.ip,
    userAgent: scope.userAgent ?? null,
    resource: 'FLEET_FUELING',
  }
}

/** SHA-256 hex do token do QR operacional — a única forma em que ele é gravado. */
export function hashRedeemToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** URL do QR operacional (tela pública do frentista). */
export function buildRedeemUrl(token: string): string {
  return `${config.urls.frontend.replace(/\/$/, '')}/abastecer/${token}`
}

// ─── Limites ─────────────────────────────────────────────────────────────────

/**
 * Valor = litros × preço (arredondado ao centavo); litros = valor ÷ preço
 * (para baixo, em mililitros). Com os dois informados, o valor não pode passar
 * de litros × preço — senão a reserva na ficha seria maior do que o
 * abastecimento possível.
 */
export function computeLimits(unitPriceCap: string, maxVolumeL?: string | null, maxAmount?: string | null) {
  const price = new Prisma.Decimal(unitPriceCap)
  if (maxVolumeL && maxAmount) {
    const volume = new Prisma.Decimal(maxVolumeL)
    const amount = new Prisma.Decimal(maxAmount)
    const ceiling = volume.times(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    if (amount.greaterThan(ceiling)) {
      throw new FleetError(
        'INVALID_LIMITS',
        `O valor máximo (${brl(amount)}) passa de litros × preço (${litres(volume)} × R$ ${price.toFixed(4).replace('.', ',')} = ${brl(ceiling)}). Reduza o valor ou aumente os litros.`
      )
    }
    return { unitPriceCap: price, maxVolumeL: volume, maxAmount: amount }
  }
  if (maxVolumeL) {
    const volume = new Prisma.Decimal(maxVolumeL)
    return { unitPriceCap: price, maxVolumeL: volume, maxAmount: volume.times(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) }
  }
  if (maxAmount) {
    const amount = new Prisma.Decimal(maxAmount)
    const volume = amount.dividedBy(price).toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN)
    if (volume.lessThanOrEqualTo(ZERO)) {
      throw new FleetError('INVALID_LIMITS', 'O valor máximo não compra nem 1 mililitro a este preço. Aumente o valor.')
    }
    return { unitPriceCap: price, maxVolumeL: volume, maxAmount: amount }
  }
  throw new FleetError('INVALID_LIMITS', 'Informe os litros ou o valor máximo (ou os dois).')
}

// ─── Validade ────────────────────────────────────────────────────────────────

async function defaultValidUntil(organizationId: string, today = localIsoDate()): Promise<string> {
  // Janela folgada: 3 dias úteis cabem em 3 semanas mesmo com um feriado longo.
  const holidays = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(Date.parse(`${today}T00:00:00Z`) + 21 * 86_400_000) } },
    select: { date: true },
  })
  return addBusinessDays(today, DEFAULT_VALIDITY_BUSINESS_DAYS, holidays.map(h => isoDay(h.date)))
}

function assertValidity(validUntilIso: string, today = localIsoDate()) {
  if (validUntilIso < today) {
    throw new FleetError(
      'INVALID_VALIDITY',
      `A validade (${formatDateBr(validUntilIso)}) já passou. Escolha hoje ou uma data futura.`
    )
  }
  const max = new Date(`${today}T12:00:00Z`)
  max.setUTCDate(max.getUTCDate() + MAX_VALIDITY_DAYS)
  if (validUntilIso > isoDay(max)) {
    throw new FleetError(
      'INVALID_VALIDITY',
      `A validade pode ser de no máximo ${MAX_VALIDITY_DAYS} dias (até ${formatDateBr(isoDay(max))}). Para uso contínuo, emita autorizações novas.`
    )
  }
}

// ─── Vínculos ────────────────────────────────────────────────────────────────

interface ResolvedRefs {
  contract: { id: string; number: string; fuelType: string | null; unitPrice: Prisma.Decimal | null; startDate: Date; endDate: Date } | null
}

interface FuelingDraft {
  departmentId: string
  vehicleId: string
  driverId: string
  fuelType: AuthorizableFuel
  contractId: string | null
  qddItemId: string | null
  unitPriceCap: Prisma.Decimal
  maxVolumeL: Prisma.Decimal
  validUntilIso: string
}

/**
 * Confere tudo o que o corpo referencia, SEMPRE na organização do token: um id
 * de outra prefeitura recebe a mesma resposta de "não existe". Lança na
 * primeira regra que bloqueia; devolve os avisos que não bloqueiam.
 */
async function resolveAndCheck(scope: FleetScope, draft: FuelingDraft): Promise<{ refs: ResolvedRefs; warnings: FuelingWarning[] }> {
  await assertDepartmentAllowed(scope, draft.departmentId)
  const today = localIsoDate()
  const warnings: FuelingWarning[] = []

  const [vehicle, driver, contract, qddItem] = await Promise.all([
    prisma.fleetVehicle.findFirst({
      where: { id: draft.vehicleId, organizationId: scope.organizationId, deletedAt: null },
      select: { id: true, plate: true, makeModel: true, vehicleType: true, fuelType: true, tankCapacityL: true, status: true, departmentId: true },
    }),
    prisma.fleetDriver.findFirst({
      where: { id: draft.driverId, organizationId: scope.organizationId, deletedAt: null },
      select: { id: true, name: true, active: true, cnhCategory: true, cnhExpiry: true, cnhStatus: true, departmentId: true },
    }),
    draft.contractId
      ? prisma.fleetContract.findFirst({
          where: { id: draft.contractId, organizationId: scope.organizationId, deletedAt: null },
          select: { id: true, number: true, fuelType: true, unitPrice: true, startDate: true, endDate: true },
        })
      : Promise.resolve(null),
    draft.qddItemId
      ? prisma.qddItem.findFirst({
          where: { id: draft.qddItemId, organizationId: scope.organizationId },
          select: { id: true, departmentId: true },
        })
      : Promise.resolve(null),
  ])

  // ── Veículo ──
  if (!vehicle || (vehicle.departmentId !== null && vehicle.departmentId !== draft.departmentId)) {
    throw new FleetError(
      'INVALID_VEHICLE',
      'O veículo escolhido não existe ou não pertence a este departamento nem à frota geral. Escolha um veículo da lista.'
    )
  }
  if (!ALLOWED_VEHICLE_STATUSES.includes(vehicle.status)) {
    throw new FleetError(
      'VEHICLE_UNAVAILABLE',
      `O veículo ${vehicle.plate} está ${VEHICLE_STATUS_LABELS[vehicle.status] ?? vehicle.status.toLowerCase()} e não pode ser abastecido. Atualize a situação no cadastro ou escolha outro veículo.`
    )
  }
  const allowedFuels = compatibleFuels(vehicle.fuelType)
  if (!allowedFuels.includes(draft.fuelType)) {
    throw new FleetError(
      'FUEL_INCOMPATIBLE',
      allowedFuels.length === 0
        ? `O veículo ${vehicle.plate} é elétrico: não há combustível a autorizar.`
        : `O veículo ${vehicle.plate} (${FUEL_LABELS[vehicle.fuelType]}) não usa ${FUEL_LABELS[draft.fuelType]}. Escolha: ${allowedFuels.map(f => FUEL_LABELS[f]).join(' ou ')}.`
    )
  }

  // ── Motorista ──
  if (!driver?.active || (driver.departmentId !== null && driver.departmentId !== draft.departmentId)) {
    throw new FleetError(
      'INVALID_DRIVER',
      'O motorista escolhido não existe, está inativo ou não pertence a este departamento nem à frota geral. Escolha um motorista da lista.'
    )
  }
  const cnhExpiryIso = isoDay(driver.cnhExpiry)
  if (driver.cnhStatus === 'SUSPENSA' || driver.cnhStatus === 'CASSADA') {
    throw new FleetError(
      'DRIVER_NOT_ELIGIBLE',
      `A CNH de ${driver.name} está ${driver.cnhStatus === 'SUSPENSA' ? 'suspensa' : 'cassada'}. Escolha outro motorista.`
    )
  }
  if (cnhExpiryIso < today) {
    throw new FleetError(
      'DRIVER_NOT_ELIGIBLE',
      `A CNH de ${driver.name} venceu em ${formatDateBr(cnhExpiryIso)}. Escolha outro motorista ou atualize o cadastro.`
    )
  }
  const required = requiredCnhCategory(vehicle.vehicleType)
  if (required && !cnhCovers(driver.cnhCategory, required)) {
    throw new FleetError(
      'DRIVER_NOT_ELIGIBLE',
      `${driver.name} tem CNH categoria ${driver.cnhCategory}, e este veículo exige categoria ${required}. Escolha outro motorista.`
    )
  }
  if (!required) {
    warnings.push({
      code: 'CNH_CATEGORY_UNCHECKED',
      message: `A categoria exigida para este tipo de veículo depende do peso e do uso. Confira se a CNH ${driver.cnhCategory} de ${driver.name} serve.`,
    })
  }
  if (cnhExpiryIso < draft.validUntilIso) {
    warnings.push({
      code: 'CNH_EXPIRES_BEFORE_VALIDITY',
      message: `A CNH de ${driver.name} vence em ${formatDateBr(cnhExpiryIso)}, antes do fim da validade da autorização.`,
    })
  }

  // ── Contrato ──
  if (draft.contractId) {
    if (!contract) {
      throw new FleetError('INVALID_CONTRACT', 'O contrato escolhido não existe nesta organização. Escolha um contrato da lista.')
    }
    if (contract.fuelType && contract.fuelType !== draft.fuelType) {
      throw new FleetError(
        'CONTRACT_FUEL_MISMATCH',
        `O contrato nº ${contract.number} é de ${FUEL_LABELS[contract.fuelType as AuthorizableFuel]}, não de ${FUEL_LABELS[draft.fuelType]}. Escolha o contrato do combustível autorizado.`
      )
    }
    if (isoDay(contract.endDate) < today) {
      throw new FleetError(
        'CONTRACT_NOT_IN_FORCE',
        `O contrato nº ${contract.number} terminou em ${formatDateBr(isoDay(contract.endDate))}. Escolha um contrato vigente.`
      )
    }
    if (contract.unitPrice && draft.unitPriceCap.greaterThan(contract.unitPrice)) {
      throw new FleetError(
        'UNIT_PRICE_ABOVE_CONTRACT',
        `O preço unitário (R$ ${draft.unitPriceCap.toFixed(4).replace('.', ',')}) passa do preço do contrato nº ${contract.number} (R$ ${contract.unitPrice.toFixed(4).replace('.', ',')}). Use até o preço do contrato.`
      )
    }
  }

  // ── Ficha QDD: do próprio departamento que ordena ──
  if (draft.qddItemId && qddItem?.departmentId !== draft.departmentId) {
    throw new FleetError(
      'INVALID_QDD_ITEM',
      'A ficha QDD escolhida não existe ou não é deste departamento. Escolha uma ficha do departamento que ordena a despesa.'
    )
  }

  // ── Avisos ──
  if (draft.maxVolumeL.greaterThan(vehicle.tankCapacityL)) {
    warnings.push({
      code: 'TANK_CAPACITY_EXCEEDED',
      message: `Os litros autorizados (${litres(draft.maxVolumeL)}) passam da capacidade do tanque (${litres(vehicle.tankCapacityL)}).`,
    })
  }

  return { refs: { contract }, warnings }
}

async function openAuthorizationWarning(scope: FleetScope, vehicleId: string, exceptId?: string): Promise<FuelingWarning | null> {
  const open = await prisma.fleetFueling.findFirst({
    where: {
      organizationId: scope.organizationId,
      vehicleId,
      deletedAt: null,
      status: 'ISSUED',
      lifecycle: { in: [...OPEN_LIFECYCLES] },
      validUntil: { gte: new Date() },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { formattedNumber: true, validUntil: true },
    orderBy: { validUntil: 'desc' },
  })
  if (!open) return null
  return {
    code: 'OPEN_AUTHORIZATION_EXISTS',
    message: `Este veículo já tem a autorização nº ${open.formattedNumber} aberta, válida até ${formatDateBr(localIsoDate(open.validUntil))}.`,
  }
}

async function loadScoped(scope: FleetScope, id: string) {
  const row = await prisma.fleetFueling.findFirst({ where: { id, ...scopeWhere(scope) }, select: SELECT })
  if (!row) throw new FleetError('NOT_FOUND', 'Autorização de abastecimento não encontrada.')
  return row
}

function assertDraft(row: { status: string; formattedNumber: string | null }) {
  if (row.status !== 'PENDING') {
    throw new FleetError(
      'ALREADY_ISSUED',
      `A autorização nº ${row.formattedNumber} já foi emitida e não pode ser alterada. Para corrigir, cancele-a com o motivo e emita outra.`
    )
  }
}

// ─── Serviço ─────────────────────────────────────────────────────────────────

export const fleetFuelingService = {
  async list(scope: FleetScope, query: ListFuelingsQuery) {
    const search = query.search?.trim()
    const plate = search ? normalizePlate(search) : ''
    // Filtros SOMADOS ao escopo (AND), nunca no lugar dele: um spread de
    // `departmentId` sobrescreveria o `in: departmentIds` do escopo.
    const and: Prisma.FleetFuelingWhereInput[] = []
    if (query.departmentId) and.push({ departmentId: query.departmentId })
    if (search) {
      and.push({
        OR: [
          { formattedNumber: { contains: search } },
          ...(plate ? [{ vehicle: { plate: { contains: plate } } }] : []),
        ],
      })
    }
    const where: Prisma.FleetFuelingWhereInput = {
      ...scopeWhere(scope),
      ...(query.status ? { status: query.status } : {}),
      ...(query.lifecycle ? { status: 'ISSUED', lifecycle: query.lifecycle } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00-03:00`) } : {}),
              ...(query.to ? { lte: endOfLocalDay(query.to) } : {}),
            },
          }
        : {}),
      ...(and.length ? { AND: and } : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.fleetFueling.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.fleetFueling.count({ where }),
    ])

    return {
      data: rows.map(r => toPublic(r)),
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    }
  },

  async getById(scope: FleetScope, id: string) {
    const row = await loadScoped(scope, id)
    if (row.status !== 'PENDING') return toPublic(row)
    // Rascunho: os avisos ajudam a decidir antes de emitir.
    const warnings: FuelingWarning[] = []
    if (row.maxVolumeL.greaterThan(row.vehicle.tankCapacityL)) {
      warnings.push({
        code: 'TANK_CAPACITY_EXCEEDED',
        message: `Os litros autorizados (${litres(row.maxVolumeL)}) passam da capacidade do tanque (${litres(row.vehicle.tankCapacityL)}).`,
      })
    }
    const open = await openAuthorizationWarning(scope, row.vehicleId, row.id)
    if (open) warnings.push(open)
    return toPublic(row, warnings)
  },

  /**
   * Departamentos em que o usuário pode ordenar abastecimento: todos os ativos
   * da organização com `fleet:all_departments`; senão, os de que é membro ou
   * gestor. Rota própria porque a listagem de departamentos exige outra
   * permissão, que o secretário nem sempre tem.
   */
  async departments(scope: FleetScope) {
    const data = await prisma.department.findMany({
      where: {
        organizationId: scope.organizationId,
        isActive: true,
        ...(scope.allDepartments ? {} : { id: { in: scope.departmentIds } }),
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
      take: 200,
    })
    return { data }
  },

  /** O que o formulário precisa para o departamento que ordena — veículos, motoristas, contratos, fichas e a validade padrão. */
  async options(scope: FleetScope, departmentId: string) {
    await assertDepartmentAllowed(scope, departmentId)
    const today = localIsoDate()
    const todayDate = new Date(`${today}T00:00:00Z`)
    const deptOrGeneral = { OR: [{ departmentId }, { departmentId: null }] }

    const [vehicles, drivers, contracts, qddItems, validUntil] = await Promise.all([
      prisma.fleetVehicle.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null, status: { not: 'BAIXADO' }, ...deptOrGeneral },
        select: { id: true, plate: true, makeModel: true, vehicleType: true, fuelType: true, tankCapacityL: true, status: true, assetTag: true, departmentId: true },
        orderBy: { plate: 'asc' },
        take: 500,
      }),
      prisma.fleetDriver.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null, active: true, ...deptOrGeneral },
        select: { id: true, name: true, cnhCategory: true, cnhExpiry: true, cnhStatus: true, departmentId: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      prisma.fleetContract.findMany({
        where: { organizationId: scope.organizationId, deletedAt: null, startDate: { lte: todayDate }, endDate: { gte: todayDate }, fuelType: { not: null } },
        select: { id: true, number: true, supplierName: true, fuelType: true, unitPrice: true, totalAmount: true, endDate: true },
        orderBy: { endDate: 'asc' },
        take: 100,
      }),
      prisma.qddItem.findMany({
        where: { organizationId: scope.organizationId, departmentId, year: localYear() },
        select: { id: true, ficha: true, fonte: true, naturezaDespesa: true, projetoAtividade: true },
        orderBy: { ficha: 'asc' },
        take: 100,
      }),
      defaultValidUntil(scope.organizationId, today),
    ])

    const [usage, balances] = await Promise.all([
      contractUsage(prisma, contracts.map(c => c.id)),
      budgetService.getBalancesForItems(qddItems.map(q => q.id), scope.organizationId),
    ])

    return {
      defaultValidUntil: validUntil,
      vehicles: vehicles.map(v => {
        const fuels = compatibleFuels(v.fuelType)
        const unavailableReason = !ALLOWED_VEHICLE_STATUSES.includes(v.status)
          ? `Veículo ${VEHICLE_STATUS_LABELS[v.status] ?? v.status.toLowerCase()}`
          : fuels.length === 0
            ? 'Veículo elétrico'
            : null
        return { ...v, compatibleFuels: fuels, requiredCnhCategory: requiredCnhCategory(v.vehicleType), unavailableReason }
      }),
      drivers: drivers.map(d => {
        const expiry = isoDay(d.cnhExpiry)
        const ineligibleReason =
          d.cnhStatus === 'SUSPENSA' || d.cnhStatus === 'CASSADA'
            ? `CNH ${d.cnhStatus === 'SUSPENSA' ? 'suspensa' : 'cassada'}`
            : expiry < today
              ? `CNH vencida em ${formatDateBr(expiry)}`
              : null
        return { ...d, cnhExpiry: expiry, ineligibleReason }
      }),
      contracts: contracts.map(c => ({
        ...c,
        endDate: isoDay(c.endDate),
        availableAmount: c.totalAmount.minus(usage.get(c.id)?.amount ?? ZERO),
      })),
      qddItems: qddItems.map(q => ({ ...q, saldoRestante: balances.get(q.id)?.saldoRestante ?? null })),
    }
  },

  /** Smart fields ao escolher o veículo (TASK 7). */
  async suggestions(scope: FleetScope, departmentId: string, vehicleId: string) {
    await assertDepartmentAllowed(scope, departmentId)
    const vehicle = await prisma.fleetVehicle.findFirst({
      where: { id: vehicleId, organizationId: scope.organizationId, deletedAt: null, OR: [{ departmentId }, { departmentId: null }] },
      select: { id: true, fuelType: true, tankCapacityL: true },
    })
    if (!vehicle) throw new FleetError('NOT_FOUND', 'Veículo não encontrado neste departamento nem na frota geral.')

    const since = new Date(Date.now() - 90 * 86_400_000)
    const todayDate = new Date(`${localIsoDate()}T00:00:00Z`)
    const fuels = compatibleFuels(vehicle.fuelType)

    const [recent, open, contracts] = await Promise.all([
      prisma.fleetFueling.findMany({
        // Só o histórico que o usuário enxerga: motorista habitual e finalidades de
        // outro departamento (veículo da frota geral) não vazam para ele.
        where: { ...scopeWhere(scope), vehicleId, status: 'ISSUED', issuedAt: { gte: since } },
        select: { driverId: true, fuelType: true, purpose: true, departmentId: true, driver: { select: { active: true, deletedAt: true } } },
        orderBy: { issuedAt: 'desc' },
        take: 50,
      }),
      openAuthorizationWarning(scope, vehicleId),
      prisma.fleetContract.findMany({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          fuelType: { in: fuels },
          startDate: { lte: todayDate },
          endDate: { gte: todayDate },
        },
        select: { id: true, fuelType: true, unitPrice: true },
        orderBy: { endDate: 'asc' },
      }),
    ])

    // Motorista habitual: o mais frequente nas autorizações dos últimos 90 dias.
    const counts = new Map<string, number>()
    for (const r of recent) {
      if (r.driver.active && !r.driver.deletedAt) counts.set(r.driverId, (counts.get(r.driverId) ?? 0) + 1)
    }
    const habitualDriverId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const lastFuel = recent.find(r => fuels.includes(r.fuelType as AuthorizableFuel))?.fuelType as AuthorizableFuel | undefined
    const suggestedFuelType = lastFuel ?? fuels.find(f => contracts.some(c => c.fuelType === f)) ?? fuels[0] ?? null
    const contract = contracts.find(c => c.fuelType === suggestedFuelType) ?? null

    const recentPurposes = [...new Set(recent.filter(r => r.departmentId === departmentId).map(r => r.purpose))].slice(0, 5)

    return {
      compatibleFuels: fuels,
      suggestedFuelType,
      suggestedContractId: contract?.id ?? null,
      suggestedUnitPrice: contract?.unitPrice ?? null,
      habitualDriverId,
      tankCapacityL: vehicle.tankCapacityL,
      openAuthorization: open,
      recentPurposes,
    }
  },

  async create(scope: FleetScope, input: CreateFuelingBody) {
    const limits = computeLimits(input.unitPriceCap, input.maxVolumeL, input.maxAmount)
    const validUntilIso = input.validUntil ?? (await defaultValidUntil(scope.organizationId))
    assertValidity(validUntilIso)

    const { warnings } = await resolveAndCheck(scope, {
      departmentId: input.departmentId,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      fuelType: input.fuelType,
      contractId: input.contractId ?? null,
      qddItemId: input.qddItemId ?? null,
      unitPriceCap: limits.unitPriceCap,
      maxVolumeL: limits.maxVolumeL,
      validUntilIso,
    })
    const open = await openAuthorizationWarning(scope, input.vehicleId)
    if (open) warnings.push(open)

    const row = await prisma.$transaction(async tx => {
      const created = await tx.fleetFueling.create({
        data: {
          organizationId: scope.organizationId,
          createdById: scope.userId,
          departmentId: input.departmentId,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          fuelType: input.fuelType,
          contractId: input.contractId ?? null,
          qddItemId: input.qddItemId ?? null,
          unitPriceCap: limits.unitPriceCap,
          maxVolumeL: limits.maxVolumeL,
          maxAmount: limits.maxAmount,
          validUntil: endOfLocalDay(validUntilIso),
          purpose: input.purpose,
        },
        select: SELECT,
      })
      await auditLedgerService.record(
        {
          ...auditBase(scope),
          action: 'FLEET_AUTHORIZATION_CREATED',
          resourceId: created.id,
          details: {
            departmentId: created.departmentId,
            vehicleId: created.vehicleId,
            driverId: created.driverId,
            fuelType: created.fuelType,
            maxVolumeL: created.maxVolumeL.toString(),
            maxAmount: created.maxAmount.toString(),
            validUntil: validUntilIso,
          },
        },
        tx
      )
      return created
    })
    return toPublic(row, warnings)
  },

  async update(scope: FleetScope, id: string, input: UpdateFuelingBody) {
    const current = await loadScoped(scope, id)
    assertDraft(current)

    const limits =
      input.unitPriceCap !== undefined
        ? computeLimits(input.unitPriceCap, input.maxVolumeL, input.maxAmount)
        : { unitPriceCap: current.unitPriceCap, maxVolumeL: current.maxVolumeL, maxAmount: current.maxAmount }
    const validUntilIso = input.validUntil ?? localIsoDate(current.validUntil)
    if (input.validUntil !== undefined) assertValidity(validUntilIso)

    // Mudar de departamento exige poder nos dois: no atual (já garantido pelo
    // escopo de leitura) e no novo (assertDepartmentAllowed dentro do check).
    const merged: FuelingDraft = {
      departmentId: input.departmentId ?? current.departmentId,
      vehicleId: input.vehicleId ?? current.vehicleId,
      driverId: input.driverId ?? current.driverId,
      fuelType: (input.fuelType ?? current.fuelType) as AuthorizableFuel,
      contractId: input.contractId !== undefined ? input.contractId : current.contractId,
      qddItemId: input.qddItemId !== undefined ? input.qddItemId : current.qddItemId,
      unitPriceCap: limits.unitPriceCap,
      maxVolumeL: limits.maxVolumeL,
      validUntilIso,
    }
    const { warnings } = await resolveAndCheck(scope, merged)
    const open = await openAuthorizationWarning(scope, merged.vehicleId, id)
    if (open) warnings.push(open)

    const data: Prisma.FleetFuelingUncheckedUpdateManyInput = {
      departmentId: merged.departmentId,
      vehicleId: merged.vehicleId,
      driverId: merged.driverId,
      fuelType: merged.fuelType,
      contractId: merged.contractId,
      qddItemId: merged.qddItemId,
      unitPriceCap: limits.unitPriceCap,
      maxVolumeL: limits.maxVolumeL,
      maxAmount: limits.maxAmount,
      validUntil: endOfLocalDay(validUntilIso),
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
    }

    const row = await prisma.$transaction(async tx => {
      // status PENDING no filtro: uma emissão concorrente vence, e esta edição
      // não altera o documento já emitido.
      const updated = await tx.fleetFueling.updateMany({
        where: { id, ...scopeWhere(scope), status: 'PENDING', sha256Hash: null },
        data,
      })
      if (updated.count === 0) assertDraft({ status: 'ISSUED', formattedNumber: current.formattedNumber })

      const fresh = await tx.fleetFueling.findFirstOrThrow({ where: { id, organizationId: scope.organizationId }, select: SELECT })
      await auditLedgerService.record(
        {
          ...auditBase(scope),
          action: 'FLEET_AUTHORIZATION_UPDATED',
          resourceId: id,
          details: { fields: Object.keys(input), maxAmount: fresh.maxAmount.toString() },
        },
        tx
      )
      return fresh
    })
    return toPublic(row, warnings)
  },

  /** Exclui o rascunho (soft-delete). Emitida não se exclui: cancela-se com motivo. */
  async remove(scope: FleetScope, id: string) {
    const current = await loadScoped(scope, id)
    assertDraft(current)

    await prisma.$transaction(async tx => {
      const deleted = await tx.fleetFueling.updateMany({
        where: { id, ...scopeWhere(scope), status: 'PENDING', sha256Hash: null },
        data: { deletedAt: new Date() },
      })
      if (deleted.count === 0) assertDraft({ status: 'ISSUED', formattedNumber: current.formattedNumber })
      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_AUTHORIZATION_DELETED', resourceId: id, details: { vehicleId: current.vehicleId } },
        tx
      )
    })
  },

  /**
   * Emite: número, snapshot da ficha, token do QR, PDF (uma vez, fora da
   * transação), e na transação — com o contrato travado — saldo do contrato
   * (bloqueia), claim do rascunho, estouro da ficha (avisa), ExportedDocument
   * e auditoria. Qualquer falha desfaz tudo e apaga o PDF gravado.
   */
  async issue(scope: FleetScope, id: string) {
    const current = await loadScoped(scope, id)
    assertDraft(current)
    const today = localIsoDate()

    if (!current.contractId) {
      throw new FleetError('CONTRACT_REQUIRED', 'Escolha o contrato de combustível antes de emitir: é dele que vêm o preço máximo e o posto autorizado.')
    }
    if (!current.qddItemId) {
      throw new FleetError('QDD_ITEM_REQUIRED', 'Escolha a ficha QDD antes de emitir: a autorização reserva o valor máximo na dotação do departamento.')
    }
    const validUntilIso = localIsoDate(current.validUntil)
    if (current.validUntil < new Date()) {
      throw new FleetError('INVALID_VALIDITY', `A validade (${formatDateBr(validUntilIso)}) já passou. Edite o rascunho com uma data futura e emita de novo.`)
    }

    const { refs, warnings } = await resolveAndCheck(scope, {
      departmentId: current.departmentId,
      vehicleId: current.vehicleId,
      driverId: current.driverId,
      fuelType: current.fuelType as AuthorizableFuel,
      contractId: current.contractId,
      qddItemId: current.qddItemId,
      unitPriceCap: current.unitPriceCap,
      maxVolumeL: current.maxVolumeL,
      validUntilIso,
    })
    const { contract } = refs
    const qddItemId = current.qddItemId
    if (!contract) throw new FleetError('CONTRACT_REQUIRED', 'Escolha o contrato de combustível antes de emitir.')
    if (isoDay(contract.startDate) > today) {
      throw new FleetError(
        'CONTRACT_NOT_IN_FORCE',
        `O contrato nº ${contract.number} só começa em ${formatDateBr(isoDay(contract.startDate))}. Emita a partir dessa data ou escolha outro contrato.`
      )
    }
    if (validUntilIso > isoDay(contract.endDate)) {
      throw new FleetError(
        'CONTRACT_NOT_IN_FORCE',
        `A validade (${formatDateBr(validUntilIso)}) passa do fim do contrato nº ${contract.number} (${formatDateBr(isoDay(contract.endDate))}). Reduza a validade.`
      )
    }

    // ── Número (antes do PDF: ele vai impresso). Rascunho que já recebeu
    // número numa tentativa anterior que falhou mantém o mesmo número. ──
    let numbered = current
    if (current.sequenceNumber === null) {
      const year = localYear()
      await withSerializableRetry(() =>
        prisma.$transaction(
          async tx => {
            const last = await tx.fleetFueling.aggregate({
              where: { organizationId: scope.organizationId, year },
              _max: { sequenceNumber: true },
            })
            const sequenceNumber = (last._max.sequenceNumber ?? 0) + 1
            await tx.fleetFueling.updateMany({
              where: { id, organizationId: scope.organizationId, sequenceNumber: null, status: 'PENDING' },
              data: { sequenceNumber, year, formattedNumber: `${String(sequenceNumber).padStart(4, '0')}/${year}` },
            })
          },
          { isolationLevel: 'Serializable' }
        )
      )
      numbered = await loadScoped(scope, id)
      assertDraft(numbered)
    }

    const [organization, department, issuer] = await Promise.all([
      prisma.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true } }),
      prisma.department.findUnique({
        where: { id: numbered.departmentId },
        select: { name: true, code: true, manager: { select: { firstName: true, lastName: true } } },
      }),
      prisma.user.findUnique({ where: { id: scope.userId }, select: USER_REF_SELECT }),
    ])

    // ── Token do QR operacional: 128 bits, só o hash é gravado. ──
    const token = randomBytes(16).toString('base64url')
    const redeemTokenHash = hashRedeemToken(token)
    const issuedAt = new Date()
    const issuerFullName = toUserRef(issuer)?.name ?? 'Usuário sem nome'

    const { bytes, sha256Hash } = await buildFuelingPdf({
      organizationId: scope.organizationId,
      organizationName: organization?.name ?? 'Organização',
      department: department ?? { name: 'Departamento', code: '', manager: null },
      fueling: numbered,
      contract: { number: contract.number },
      contractSupplier: numbered.contract,
      redeemUrl: buildRedeemUrl(token),
      issuedAt,
      issuerFullName,
    })

    const pdfFileKey = await saveFile(Buffer.from(bytes), {
      organizationId: scope.organizationId,
      scope: 'fleet-fuelings',
      originalName: `autorizacao-${numbered.publicId}.pdf`,
    })

    try {
      const { row, budgetOverrun } = await prisma.$transaction(async tx => {
        // 1. Trava o rascunho e confere que é o mesmo do PDF: uma edição feita
        // enquanto o PDF era gerado deixaria o documento emitido com dados
        // diferentes dos impressos (e escaparia da conferência de saldo abaixo).
        await tx.$queryRaw`SELECT id FROM fleet_fuelings WHERE id = ${id} FOR UPDATE`
        const locked = await tx.fleetFueling.findFirst({
          where: { id, ...scopeWhere(scope) },
          select: { status: true, updatedAt: true },
        })
        if (locked?.status !== 'PENDING') {
          assertDraft({ status: 'ISSUED', formattedNumber: numbered.formattedNumber })
        }
        if (locked.updatedAt.getTime() !== numbered.updatedAt.getTime()) {
          throw new FleetError(
            'DRAFT_CHANGED',
            'O rascunho foi alterado enquanto a emissão era preparada. Confira os dados e clique em emitir de novo.'
          )
        }

        // 2. Trava o contrato: duas emissões simultâneas não reservam o mesmo
        // saldo, e ele não é excluído nem alterado no meio da emissão. As regras
        // do contrato são conferidas de novo, já sob a trava.
        await tx.$queryRaw`SELECT id FROM fleet_contracts WHERE id = ${contract.id} FOR UPDATE`
        const contractRow = await tx.fleetContract.findFirst({
          where: { id: contract.id, organizationId: scope.organizationId, deletedAt: null },
          select: { totalAmount: true, maxVolumeL: true, number: true, fuelType: true, unitPrice: true, startDate: true, endDate: true },
        })
        if (!contractRow) {
          throw new FleetError('INVALID_CONTRACT', 'O contrato desta autorização foi excluído. Edite o rascunho e escolha um contrato vigente.')
        }
        if (
          (contractRow.fuelType && contractRow.fuelType !== numbered.fuelType) ||
          (contractRow.unitPrice && numbered.unitPriceCap.greaterThan(contractRow.unitPrice)) ||
          isoDay(contractRow.startDate) > today ||
          validUntilIso > isoDay(contractRow.endDate)
        ) {
          throw new FleetError(
            'CONTRACT_NOT_IN_FORCE',
            `O contrato nº ${contractRow.number} mudou (combustível, preço ou vigência) e não cobre mais esta autorização. Edite o rascunho e emita de novo.`
          )
        }
        const usage = (await contractUsage(tx, [contract.id])).get(contract.id) ?? { amount: ZERO, volumeL: ZERO }
        const availableAmount = contractRow.totalAmount.minus(usage.amount)
        if (numbered.maxAmount.greaterThan(availableAmount)) {
          throw new FleetError(
            'CONTRACT_BALANCE_INSUFFICIENT',
            `O contrato nº ${contractRow.number} tem ${brl(availableAmount.lessThan(ZERO) ? ZERO : availableAmount)} disponíveis, e esta autorização reserva ${brl(numbered.maxAmount)}. Reduza os litros ou o valor, ou use outro contrato.`,
            { availableAmount: availableAmount.toFixed(2) }
          )
        }
        if (contractRow.maxVolumeL) {
          const availableVolume = contractRow.maxVolumeL.minus(usage.volumeL)
          if (numbered.maxVolumeL.greaterThan(availableVolume)) {
            throw new FleetError(
              'CONTRACT_BALANCE_INSUFFICIENT',
              `O contrato nº ${contractRow.number} tem ${litres(availableVolume.lessThan(ZERO) ? ZERO : availableVolume)} disponíveis, e esta autorização reserva ${litres(numbered.maxVolumeL)}. Reduza os litros ou use outro contrato.`,
              { availableVolumeL: availableVolume.toFixed(3) }
            )
          }
        }

        const qdd = await tx.qddItem.findFirstOrThrow({
          where: { id: qddItemId, organizationId: scope.organizationId },
          select: { ficha: true, fonte: true, naturezaDespesa: true },
        })

        // Claim: só um clique em "Emitir" vence; o outro recebe ALREADY_ISSUED.
        // `updatedAt` no filtro: defesa extra, além da trava acima.
        const claimed = await tx.fleetFueling.updateMany({
          where: { id, ...scopeWhere(scope), status: 'PENDING', sha256Hash: null, updatedAt: numbered.updatedAt },
          data: {
            status: 'ISSUED',
            lifecycle: 'OPEN',
            sha256Hash,
            pdfFileKey,
            issuedAt,
            issuedById: scope.userId,
            redeemTokenHash,
            qddFichaSnapshot: qdd.ficha,
            qddFonteSnapshot: qdd.fonte,
            qddNaturezaSnapshot: qdd.naturezaDespesa,
          },
        })
        if (claimed.count === 0) assertDraft({ status: 'ISSUED', formattedNumber: numbered.formattedNumber })

        // Estouro da ficha: depois de gravar, na mesma transação. Não bloqueia.
        const overrun = await budgetService.detectOverrun(tx, qddItemId)
        if (overrun) await tx.fleetFueling.updateMany({ where: { id, organizationId: scope.organizationId }, data: { budgetOverrun: true } })

        await exportedDocumentService.registerInTransaction(
          {
            organizationId: scope.organizationId,
            documentType: EXPORTED_DOCUMENT_TYPES.FLEET_FUELING,
            publicId: numbered.publicId,
            bytes,
            exporterFullName: issuerFullName,
          },
          tx
        )

        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_AUTHORIZATION_ISSUED',
            resourceId: id,
            details: {
              number: numbered.formattedNumber,
              publicId: numbered.publicId,
              sha256Hash,
              vehicleId: numbered.vehicleId,
              driverId: numbered.driverId,
              contractId: contract.id,
              maxVolumeL: numbered.maxVolumeL.toString(),
              maxAmount: numbered.maxAmount.toString(),
              unitPriceCap: numbered.unitPriceCap.toString(),
              validUntil: validUntilIso,
              budgetOverrun: overrun,
            },
          },
          tx
        )

        const fresh = await tx.fleetFueling.findFirstOrThrow({ where: { id, organizationId: scope.organizationId }, select: SELECT })
        return { row: fresh, budgetOverrun: overrun }
      })

      if (budgetOverrun) {
        warnings.push({
          code: 'BUDGET_OVERRUN',
          message: `A ficha QDD ${row.qddFichaSnapshot} ficou sem saldo com esta autorização. A emissão segue (o estouro não bloqueia) e fica registrada para a contabilidade.`,
        })
      }
      return toPublic(row, warnings.filter(w => w.code !== 'CNH_CATEGORY_UNCHECKED'))
    } catch (error) {
      // Nada foi emitido: o PDF gravado não pode ficar órfão no storage.
      await deleteFile(pdfFileKey).catch(() => undefined)
      throw error
    }
  },

  /** Cancela uma autorização emitida e ainda não usada. Libera a reserva na ficha e no contrato. */
  async cancel(scope: FleetScope, id: string, reason: string) {
    const current = await loadScoped(scope, id)
    if (current.status !== 'ISSUED') {
      throw new FleetError('NOT_ISSUED', 'Este rascunho ainda não foi emitido: exclua-o em vez de cancelar.')
    }

    return prisma.$transaction(async tx => {
      const now = new Date()
      // OPEN, ou IN_USE com a sessão do frentista já vencida (volta a ser OPEN).
      const cancelled = await tx.fleetFueling.updateMany({
        where: {
          id,
          ...scopeWhere(scope),
          status: 'ISSUED',
          OR: [{ lifecycle: 'OPEN' }, { lifecycle: 'IN_USE', lockedUntil: { lt: now } }],
        },
        data: { lifecycle: 'CANCELLED', cancelReason: reason, cancelledAt: now, cancelledById: scope.userId, lockedUntil: null },
      })
      if (cancelled.count === 0) {
        throw new FleetError(
          'NOT_CANCELLABLE',
          current.lifecycle === 'IN_USE'
            ? `A autorização nº ${current.formattedNumber} está em uso no posto agora. Aguarde o fim da sessão do frentista (até 30 min) e tente de novo.`
            : `A autorização nº ${current.formattedNumber} não está aberta (situação: ${current.lifecycle}) e não pode mais ser cancelada.`,
          { lifecycle: current.lifecycle }
        )
      }
      await auditLedgerService.record(
        {
          ...auditBase(scope),
          action: 'FLEET_AUTHORIZATION_CANCELLED',
          resourceId: id,
          details: { number: current.formattedNumber, reason, previousLifecycle: current.lifecycle },
        },
        tx
      )
      return toPublic(await tx.fleetFueling.findFirstOrThrow({ where: { id, organizationId: scope.organizationId }, select: SELECT }))
    })
  },

  /**
   * PDF original, nunca regenerado. Contém o QR operacional (o token): todo
   * download é auditado, na mesma transação da leitura do registro.
   */
  async getPdf(scope: FleetScope, id: string) {
    const current = await loadScoped(scope, id)
    const fileKey = await prisma.fleetFueling.findFirst({ where: { id, ...scopeWhere(scope) }, select: { pdfFileKey: true } })
    if (current.status !== 'ISSUED' || !fileKey?.pdfFileKey) {
      throw new FleetError('NOT_ISSUED', 'Esta autorização ainda não foi emitida. Emita-a para gerar o PDF.')
    }
    // Enquanto o QR ainda abre o posto, o PDF é um vale ao portador: só quem
    // emite autorização o baixa. Depois (usada, vencida, cancelada...) ele é só
    // registro e qualquer perfil de leitura o vê.
    if (OPEN_LIFECYCLES.includes(current.lifecycle as (typeof OPEN_LIFECYCLES)[number]) && current.lifecycle !== 'AWAITING_REVIEW') {
      if (!(await userHasPermission(scope.userId, 'fleet:authorize_fuel'))) {
        throw new FleetError(
          'PDF_RESTRICTED',
          'Enquanto a autorização está aberta, o PDF (que libera o abastecimento no posto) só é baixado por quem emite autorizações. Peça ao secretário do departamento.'
        )
      }
    }
    const bytes = await readFile(fileKey.pdfFileKey)
    await prisma.$transaction(async tx => {
      await auditLedgerService.record(
        {
          ...auditBase(scope),
          action: 'FLEET_AUTHORIZATION_PDF_DOWNLOADED',
          resourceId: id,
          details: { number: current.formattedNumber, publicId: current.publicId },
        },
        tx
      )
    })
    return {
      bytes,
      publicId: current.publicId,
      fileName: `autorizacao-abastecimento-${(current.formattedNumber ?? current.publicId).replace('/', '-')}.pdf`,
    }
  },
}
