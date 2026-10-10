import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { FleetError } from '@/services/fleet-error.js'
import type { FleetScope } from '@/services/fleet-scope.service.js'
import type { CreateContractBody, ListContractsQuery, UpdateContractBody } from '@/schemas/fleet-fueling.schemas.js'
import { isValidCnpj, normalizeCnpj } from '@/utils/cnpj.util.js'
import { USER_REF_SELECT, toUserRef } from '@/utils/fleet-user-ref.js'
import { localIsoDate } from '@/utils/fleet-fueling-rules.js'

/**
 * Contratos (atas) de combustível do Frotas — cadastro mínimo da TASK 3A
 * (decisão D16). A autorização de abastecimento exige um contrato vigente do
 * mesmo combustível: dele vêm o preço unitário máximo e o CNPJ do posto, que a
 * rota do frentista confere contra o cupom fiscal.
 *
 * O saldo do contrato NUNCA é gravado: é calculado na leitura, como o saldo do
 * QDD. Autorização emitida e aberta reserva o valor máximo; usada ou fechada
 * consome o valor real do cupom; vencida, bloqueada ou cancelada libera. Ao
 * contrário da ficha QDD, o saldo do contrato BLOQUEIA a emissão (limite legal
 * do contrato).
 *
 * Contratos são da organização inteira (uma ata atende todas as secretarias):
 * quem tem `fleet:manage` cadastra; quem emite autorização só escolhe.
 */

const ZERO = new Prisma.Decimal(0)

const RESERVING = ['OPEN', 'IN_USE', 'AWAITING_REVIEW'] as const
const CONSUMED = ['USED', 'CLOSED'] as const

const SELECT = {
  id: true,
  number: true,
  supplierName: true,
  supplierCnpj: true,
  object: true,
  fuelType: true,
  unitPrice: true,
  totalAmount: true,
  maxVolumeL: true,
  commitmentNumber: true,
  qddItemId: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  qddItem: { select: { id: true, ficha: true, fonte: true, naturezaDespesa: true } },
  createdBy: { select: USER_REF_SELECT },
} satisfies Prisma.FleetContractSelect

type ContractRow = Prisma.FleetContractGetPayload<{ select: typeof SELECT }>

export interface ContractUsage {
  amount: Prisma.Decimal
  volumeL: Prisma.Decimal
}

/**
 * Comprometido por contrato (valor e litros). `client` é o prisma global ou o
 * `tx` da emissão — dentro da transação, com a linha do contrato travada, a
 * soma inclui tudo o que já foi emitido.
 */
export async function contractUsage(client: Prisma.TransactionClient, contractIds: string[]) {
  const usage = new Map<string, ContractUsage>()
  if (contractIds.length === 0) return usage

  const rows = await client.fleetFueling.findMany({
    where: {
      contractId: { in: contractIds },
      status: 'ISSUED',
      deletedAt: null,
      lifecycle: { in: [...RESERVING, ...CONSUMED] },
    },
    select: {
      contractId: true,
      lifecycle: true,
      maxAmount: true,
      maxVolumeL: true,
      redemption: { select: { totalAmount: true, volumeL: true } },
    },
  })

  for (const row of rows) {
    if (!row.contractId) continue
    const consumed = (CONSUMED as readonly string[]).includes(row.lifecycle)
    const amount = consumed ? (row.redemption?.totalAmount ?? row.maxAmount) : row.maxAmount
    const volume = consumed ? (row.redemption?.volumeL ?? row.maxVolumeL) : row.maxVolumeL
    const current = usage.get(row.contractId) ?? { amount: ZERO, volumeL: ZERO }
    usage.set(row.contractId, { amount: current.amount.plus(amount), volumeL: current.volumeL.plus(volume) })
  }
  return usage
}

function isInForce(row: { startDate: Date; endDate: Date }, today = localIsoDate()) {
  const start = row.startDate.toISOString().slice(0, 10)
  const end = row.endDate.toISOString().slice(0, 10)
  return start <= today && today <= end
}

function toPublic(row: ContractRow, usage?: ContractUsage) {
  const committedAmount = usage?.amount ?? ZERO
  const committedVolumeL = usage?.volumeL ?? ZERO
  return {
    ...row,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    createdBy: toUserRef(row.createdBy),
    inForce: isInForce(row),
    committedAmount,
    availableAmount: row.totalAmount.minus(committedAmount),
    committedVolumeL,
    availableVolumeL: row.maxVolumeL ? row.maxVolumeL.minus(committedVolumeL) : null,
  }
}

export type PublicContract = ReturnType<typeof toPublic>

function auditBase(scope: FleetScope) {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
    ip: scope.ip,
    userAgent: scope.userAgent ?? null,
    resource: 'FLEET_CONTRACT',
  }
}

function normalizeSupplierCnpj(raw: string): string {
  const cnpj = normalizeCnpj(raw)
  if (!cnpj || !isValidCnpj(cnpj)) {
    throw new FleetError(
      'INVALID_CNPJ',
      `O CNPJ do fornecedor "${raw}" não é válido. Confira os 14 dígitos no contrato ou no cartão CNPJ do posto.`
    )
  }
  return cnpj
}

function assertDates(startDate: string, endDate: string) {
  if (startDate > endDate) {
    throw new FleetError('INVALID_DATES', 'A data de fim da vigência é anterior à de início. Confira as datas do contrato.')
  }
}

async function assertQddItem(scope: FleetScope, qddItemId: string | null | undefined) {
  if (!qddItemId) return
  const item = await prisma.qddItem.findFirst({ where: { id: qddItemId, organizationId: scope.organizationId }, select: { id: true } })
  if (!item) throw new FleetError('INVALID_QDD_ITEM', 'A ficha QDD informada não existe nesta organização. Escolha uma ficha da lista.')
}

async function assertNumberFree(tx: Prisma.TransactionClient, scope: FleetScope, number: string, exceptId?: string) {
  const clash = await tx.fleetContract.findFirst({
    where: { organizationId: scope.organizationId, number, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw new FleetError('CONTRACT_ALREADY_REGISTERED', `Já existe um contrato ativo com o nº ${number}. Confira o número ou edite o contrato existente.`)
  }
}

function translateUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new FleetError('CONTRACT_ALREADY_REGISTERED', 'Já existe um contrato ativo com este número nesta organização.')
  }
  throw error
}

const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`)

export const fleetContractService = {
  async list(scope: FleetScope, query: ListContractsQuery) {
    const today = dateOnly(localIsoDate())
    const search = query.search?.trim()
    const where: Prisma.FleetContractWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(query.fuelType ? { fuelType: query.fuelType } : {}),
      ...(query.inForce ? { startDate: { lte: today }, endDate: { gte: today } } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' as const } },
              { supplierName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.fleetContract.findMany({
        where,
        select: SELECT,
        orderBy: [{ endDate: 'desc' }, { number: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.fleetContract.count({ where }),
    ])
    const usage = await contractUsage(prisma, rows.map(r => r.id))

    return {
      data: rows.map(r => toPublic(r, usage.get(r.id))),
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    }
  },

  async getById(scope: FleetScope, id: string) {
    const row = await prisma.fleetContract.findFirst({
      where: { id, organizationId: scope.organizationId, deletedAt: null },
      select: SELECT,
    })
    if (!row) throw new FleetError('NOT_FOUND', 'Contrato não encontrado.')
    const usage = await contractUsage(prisma, [id])
    return toPublic(row, usage.get(id))
  },

  async create(scope: FleetScope, input: CreateContractBody) {
    const supplierCnpj = normalizeSupplierCnpj(input.supplierCnpj)
    assertDates(input.startDate, input.endDate)
    await assertQddItem(scope, input.qddItemId)

    try {
      return await prisma.$transaction(async tx => {
        await assertNumberFree(tx, scope, input.number)
        const row = await tx.fleetContract.create({
          data: {
            organizationId: scope.organizationId,
            createdById: scope.userId,
            number: input.number,
            supplierName: input.supplierName,
            supplierCnpj,
            object: input.object,
            fuelType: input.fuelType,
            unitPrice: new Prisma.Decimal(input.unitPrice),
            totalAmount: new Prisma.Decimal(input.totalAmount),
            maxVolumeL: input.maxVolumeL ? new Prisma.Decimal(input.maxVolumeL) : null,
            commitmentNumber: input.commitmentNumber ?? null,
            qddItemId: input.qddItemId ?? null,
            startDate: dateOnly(input.startDate),
            endDate: dateOnly(input.endDate),
          },
          select: SELECT,
        })
        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_CONTRACT_CREATED',
            resourceId: row.id,
            details: {
              number: row.number,
              supplierCnpj: row.supplierCnpj,
              fuelType: row.fuelType,
              unitPrice: row.unitPrice.toString(),
              totalAmount: row.totalAmount.toString(),
              endDate: input.endDate,
            },
          },
          tx
        )
        return toPublic(row)
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async update(scope: FleetScope, id: string, input: UpdateContractBody) {
    const current = await this.getById(scope, id)
    const supplierCnpj = input.supplierCnpj !== undefined ? normalizeSupplierCnpj(input.supplierCnpj) : undefined
    assertDates(input.startDate ?? current.startDate, input.endDate ?? current.endDate)
    if (input.qddItemId !== undefined) await assertQddItem(scope, input.qddItemId)

    const data: Prisma.FleetContractUncheckedUpdateInput = {
      ...(input.number !== undefined ? { number: input.number } : {}),
      ...(input.supplierName !== undefined ? { supplierName: input.supplierName } : {}),
      ...(supplierCnpj !== undefined ? { supplierCnpj } : {}),
      ...(input.object !== undefined ? { object: input.object } : {}),
      ...(input.fuelType !== undefined ? { fuelType: input.fuelType } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: new Prisma.Decimal(input.unitPrice) } : {}),
      ...(input.totalAmount !== undefined ? { totalAmount: new Prisma.Decimal(input.totalAmount) } : {}),
      ...(input.maxVolumeL !== undefined ? { maxVolumeL: input.maxVolumeL ? new Prisma.Decimal(input.maxVolumeL) : null } : {}),
      ...(input.commitmentNumber !== undefined ? { commitmentNumber: input.commitmentNumber } : {}),
      ...(input.qddItemId !== undefined ? { qddItemId: input.qddItemId } : {}),
      ...(input.startDate !== undefined ? { startDate: dateOnly(input.startDate) } : {}),
      ...(input.endDate !== undefined ? { endDate: dateOnly(input.endDate) } : {}),
    }

    try {
      return await prisma.$transaction(async tx => {
        // Trava a linha: uma emissão concorrente não reserva saldo enquanto o
        // total do contrato está sendo reduzido.
        await tx.$queryRaw`SELECT id FROM fleet_contracts WHERE id = ${id} FOR UPDATE`
        if (input.number !== undefined) await assertNumberFree(tx, scope, input.number, id)

        // CNPJ do posto e combustível valem para as autorizações já emitidas: o
        // PDF mostra o posto, e o frentista é conferido contra ele. Com
        // autorização aberta, não mudam (a troca liberaria cupom de outro posto).
        const changesIdentity =
          (supplierCnpj !== undefined && supplierCnpj !== current.supplierCnpj) ||
          (input.fuelType !== undefined && input.fuelType !== current.fuelType)
        if (changesIdentity) {
          const open = await tx.fleetFueling.count({
            where: { contractId: id, deletedAt: null, status: 'ISSUED', lifecycle: { in: [...RESERVING] } },
          })
          if (open > 0) {
            throw new FleetError(
              'CONTRACT_IN_USE',
              `O contrato nº ${current.number} tem ${open} autorização(ões) em aberto: o CNPJ do posto e o combustível não podem mudar até elas serem usadas, vencerem ou serem canceladas.`,
              { openAuthorizations: open }
            )
          }
        }

        if (input.totalAmount !== undefined || input.maxVolumeL !== undefined) {
          const usage = (await contractUsage(tx, [id])).get(id) ?? { amount: ZERO, volumeL: ZERO }
          const total = input.totalAmount !== undefined ? new Prisma.Decimal(input.totalAmount) : current.totalAmount
          if (total.lessThan(usage.amount)) {
            throw new FleetError(
              'CONTRACT_BELOW_COMMITTED',
              `O valor total não pode ficar abaixo do já comprometido em autorizações (R$ ${usage.amount.toFixed(2)}). Cancele autorizações abertas ou mantenha um valor maior.`,
              { committedAmount: usage.amount.toFixed(2) }
            )
          }
          const maxVolume = input.maxVolumeL !== undefined ? input.maxVolumeL : current.maxVolumeL?.toString()
          if (maxVolume && new Prisma.Decimal(maxVolume).lessThan(usage.volumeL)) {
            throw new FleetError(
              'CONTRACT_BELOW_COMMITTED',
              `O volume máximo não pode ficar abaixo do já comprometido em autorizações (${usage.volumeL.toFixed(3)} L).`,
              { committedVolumeL: usage.volumeL.toFixed(3) }
            )
          }
        }

        const updated = await tx.fleetContract.updateMany({
          where: { id, organizationId: scope.organizationId, deletedAt: null },
          data,
        })
        if (updated.count === 0) throw new FleetError('NOT_FOUND', 'Contrato não encontrado.')

        const row = await tx.fleetContract.findFirstOrThrow({ where: { id, organizationId: scope.organizationId }, select: SELECT })
        // Antes → depois dos campos que valem contra o posto e o saldo.
        const sensitive = ['supplierCnpj', 'fuelType', 'unitPrice', 'totalAmount', 'maxVolumeL', 'startDate', 'endDate'] as const
        const changes: Record<string, { before: string | null; after: string | null }> = {}
        for (const field of sensitive) {
          if (!(field in data)) continue
          const before = current[field] === null ? null : String(current[field])
          const after = row[field] === null ? null : field.endsWith('Date') ? (row[field] as Date).toISOString().slice(0, 10) : String(row[field])
          if (before !== after) changes[field] = { before, after }
        }
        await auditLedgerService.record(
          {
            ...auditBase(scope),
            action: 'FLEET_CONTRACT_UPDATED',
            resourceId: id,
            details: { fields: Object.keys(data), number: row.number, changes },
          },
          tx
        )
        const usage = await contractUsage(tx, [id])
        return toPublic(row, usage.get(id))
      })
    } catch (error) {
      if (error instanceof FleetError) throw error
      return translateUniqueViolation(error)
    }
  },

  async remove(scope: FleetScope, id: string) {
    const current = await this.getById(scope, id)

    await prisma.$transaction(async tx => {
      // Mesma trava da emissão: uma emissão em curso termina antes desta contagem.
      await tx.$queryRaw`SELECT id FROM fleet_contracts WHERE id = ${id} FOR UPDATE`
      const open = await tx.fleetFueling.count({
        where: { contractId: id, deletedAt: null, status: 'ISSUED', lifecycle: { in: [...RESERVING] } },
      })
      if (open > 0) {
        throw new FleetError(
          'CONTRACT_IN_USE',
          `O contrato nº ${current.number} tem ${open} autorização(ões) de abastecimento em aberto. Aguarde o uso ou cancele-as antes de excluir.`,
          { openAuthorizations: open }
        )
      }
      const deleted = await tx.fleetContract.updateMany({
        where: { id, organizationId: scope.organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (deleted.count === 0) throw new FleetError('NOT_FOUND', 'Contrato não encontrado.')
      await auditLedgerService.record(
        { ...auditBase(scope), action: 'FLEET_CONTRACT_DELETED', resourceId: id, details: { number: current.number } },
        tx
      )
    })
  },
}
