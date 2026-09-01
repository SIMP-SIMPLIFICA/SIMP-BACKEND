import fs from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { createOfficialPdf } from '@/services/document-pdf.service.js'
import { getFilePath, saveFile } from '@/services/storage.service.js'

/**
 * Controle de abastecimento de frota (Épico 3, Task 3.2).
 *
 * Segue a mesma regra da Task 3.1 — EMITIDO É IMUTÁVEL: enquanto `sha256Hash`
 * é nulo o registro é rascunho e pode ser editado ou excluído; depois da
 * emissão, qualquer alteração faria o hash publicado divergir do documento
 * entregue e o Portal de Validação acusaria adulteração num comprovante
 * legítimo.
 */

// ─── Erros de domínio ─────────────────────────────────────────────────────────

export class FleetFuelingError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'NO_ORGANIZATION'
      | 'ALREADY_ISSUED'
      | 'NOT_ISSUED'
      | 'INVALID_PLATE',
    message: string
  ) {
    super(message)
    this.name = 'FleetFuelingError'
  }
}

// ─── Contratos ────────────────────────────────────────────────────────────────

export interface RequestScope {
  organizationId: string
  userId: string
}

export interface CreateFleetFuelingInput {
  licensePlate: string
  odometer: number
  liters: number
  totalValue: number
  date: Date
}

export type UpdateFleetFuelingInput = Partial<CreateFleetFuelingInput>

export interface ListFleetFuelingFilter {
  page: number
  limit: number
  licensePlate?: string
  issued?: boolean
  startDate?: Date
  endDate?: Date
}

const LIST_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.FleetFuelingInclude

// ─── Placa ────────────────────────────────────────────────────────────────────

/**
 * Normaliza a placa: maiúsculas, sem hífen, espaço ou ponto.
 *
 * Sem isso, "abc-1234" e "ABC1234" seriam dois veículos distintos no banco e o
 * relatório por placa nasceria furado — justamente o dado que o Tribunal de
 * Contas usa para cruzar consumo por veículo.
 */
export function normalizeLicensePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Aceita os dois formatos brasileiros em circulação:
 *   antigo   → ABC1234   (3 letras + 4 dígitos)
 *   Mercosul → ABC1D23   (3 letras + dígito + letra + 2 dígitos)
 *
 * A frota municipal tem veículos dos dois períodos, então recusar o formato
 * antigo bloquearia parte real do pátio.
 */
export function isValidLicensePlate(normalized: string): boolean {
  return /^[A-Z]{3}\d{4}$/.test(normalized) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(normalized)
}

function assertPlate(plate: string): string {
  const normalized = normalizeLicensePlate(plate)

  if (!isValidLicensePlate(normalized)) {
    throw new FleetFuelingError(
      'INVALID_PLATE',
      'Placa inválida. Use o formato ABC1234 (antigo) ou ABC1D23 (Mercosul).'
    )
  }
  return normalized
}

/**
 * Preço por litro, apenas para exibição no comprovante.
 *
 * NÃO é persistido de propósito: guardar um valor derivado abriria espaço para
 * ele divergir de litros × total após uma edição. É recalculado na leitura.
 */
export function calculatePricePerLiter(totalValue: number, liters: number): number {
  if (liters <= 0) return 0
  return Math.round((totalValue / liters) * 1000) / 1000
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const fleetFuelingService = {
  async create(input: CreateFleetFuelingInput, scope: RequestScope) {
    return prisma.fleetFueling.create({
      data: {
        organizationId: scope.organizationId,
        createdById: scope.userId,
        licensePlate: assertPlate(input.licensePlate),
        odometer: input.odometer,
        liters: new Prisma.Decimal(input.liters),
        totalValue: new Prisma.Decimal(input.totalValue),
        date: input.date,
      },
      include: LIST_INCLUDE,
    })
  },

  async list(filter: ListFleetFuelingFilter, scope: RequestScope) {
    // organizationId vem do token: um filtro de query jamais alcança outra
    // prefeitura.
    const where: Prisma.FleetFuelingWhereInput = { organizationId: scope.organizationId }

    // A placa do filtro passa pela mesma normalização do registro; senão buscar
    // por "abc-1234" não encontraria nada.
    if (filter.licensePlate) where.licensePlate = normalizeLicensePlate(filter.licensePlate)
    if (filter.issued === true) where.sha256Hash = { not: null }
    if (filter.issued === false) where.sha256Hash = null

    if (filter.startDate || filter.endDate) {
      where.date = {}
      if (filter.startDate) where.date.gte = filter.startDate
      if (filter.endDate) where.date.lte = filter.endDate
    }

    const [records, total] = await Promise.all([
      prisma.fleetFueling.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: LIST_INCLUDE,
      }),
      prisma.fleetFueling.count({ where }),
    ])

    return {
      data: records,
      meta: {
        total,
        page: filter.page,
        limit: filter.limit,
        totalPages: Math.ceil(total / filter.limit),
      },
    }
  },

  async getById(id: string, scope: RequestScope) {
    const record = await prisma.fleetFueling.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: LIST_INCLUDE,
    })

    if (!record) {
      throw new FleetFuelingError('NOT_FOUND', 'Abastecimento não encontrado.')
    }
    return record
  },

  async update(id: string, input: UpdateFleetFuelingInput, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.sha256Hash) {
      throw new FleetFuelingError(
        'ALREADY_ISSUED',
        'Este abastecimento já foi emitido e não pode mais ser alterado. Registre um novo abastecimento.'
      )
    }

    return prisma.fleetFueling.update({
      where: { id },
      data: {
        licensePlate: input.licensePlate ? assertPlate(input.licensePlate) : current.licensePlate,
        odometer: input.odometer ?? current.odometer,
        liters: new Prisma.Decimal(input.liters ?? Number(current.liters)),
        totalValue: new Prisma.Decimal(input.totalValue ?? Number(current.totalValue)),
        date: input.date ?? current.date,
      },
      include: LIST_INCLUDE,
    })
  },

  async remove(id: string, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.sha256Hash) {
      throw new FleetFuelingError(
        'ALREADY_ISSUED',
        'Este abastecimento já foi emitido e não pode ser excluído. O documento faz parte da prestação de contas.'
      )
    }

    await prisma.fleetFueling.delete({ where: { id } })
  },

  /**
   * Emite o relatório de prestação de contas do abastecimento.
   *
   * O PDF é gerado UMA vez e persistido — rege-lo produziria bytes diferentes e
   * invalidaria o hash já publicado no QR Code.
   */
  async issue(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (record.sha256Hash) {
      throw new FleetFuelingError(
        'ALREADY_ISSUED',
        'Este abastecimento já foi emitido. Baixe o documento existente.'
      )
    }

    const organization = await prisma.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true },
    })

    const registeredBy = [record.createdBy?.firstName, record.createdBy?.lastName]
      .filter(Boolean)
      .join(' ')

    const liters = Number(record.liters)
    const totalValue = Number(record.totalValue)

    const { bytes, sha256Hash } = await createOfficialPdf({
      title: 'RELATÓRIO DE ABASTECIMENTO',
      organizationName: organization?.name ?? 'Organização',
      publicId: record.publicId,
      sections: [
        {
          heading: 'Veículo',
          fields: [
            { label: 'Placa', value: formatPlate(record.licensePlate) },
            { label: 'Odômetro', value: `${record.odometer.toLocaleString('pt-BR')} km` },
          ],
        },
        {
          heading: 'Abastecimento',
          fields: [
            { label: 'Data', value: formatDate(record.date) },
            { label: 'Litros', value: `${formatNumber(liters, 3)} L` },
            {
              label: 'Preço por litro',
              value: formatCurrency(calculatePricePerLiter(totalValue, liters)),
            },
            { label: 'Valor total', value: formatCurrency(totalValue) },
          ],
        },
        {
          fields: [{ label: 'Registrado por', value: registeredBy || '-' }],
        },
      ],
      footNote: `Documento ${record.publicId}`,
    })

    const pdfFileKey = await saveFile(Buffer.from(bytes), {
      organizationId: scope.organizationId,
      scope: 'fleet-fuelings',
      originalName: `abastecimento-${record.publicId}.pdf`,
    })

    const issued = await prisma.fleetFueling.update({
      where: { id },
      data: { sha256Hash, pdfFileKey, issuedAt: new Date() },
      include: LIST_INCLUDE,
    })

    await auditLedgerService.record({
      userId: scope.userId,
      action: 'FLEET_FUELING_ISSUED',
      resource: 'FLEET_FUELING',
      resourceId: record.id,
      organizationId: scope.organizationId,
      details: { publicId: record.publicId, sha256Hash, licensePlate: record.licensePlate },
    })

    return issued
  },

  /** Bytes do PDF já emitido, para download. */
  async getPdf(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (!record.pdfFileKey) {
      throw new FleetFuelingError(
        'NOT_ISSUED',
        'Este abastecimento ainda não foi emitido. Emita o documento antes de baixá-lo.'
      )
    }

    const bytes = await fs.readFile(getFilePath(record.pdfFileKey))
    return { bytes, publicId: record.publicId }
  },
}

// ─── Formatação (conteúdo do PDF é pt-BR) ─────────────────────────────────────

/** Reinsere o hífen apenas para leitura humana: ABC1234 → ABC-1234. */
function formatPlate(normalized: string): string {
  return /^[A-Z]{3}\d{4}$/.test(normalized)
    ? `${normalized.slice(0, 3)}-${normalized.slice(3)}`
    : normalized
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}
