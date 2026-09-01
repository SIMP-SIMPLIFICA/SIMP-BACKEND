import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { getFilePath, saveFile } from '@/services/storage.service.js'
import { createOfficialPdf } from '@/services/document-pdf.service.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import fs from 'node:fs/promises'

/**
 * Diárias de servidor (Épico 3, Task 3.1).
 *
 * REGRA CENTRAL — EMITIDO É IMUTÁVEL:
 *   Enquanto `documentHash` é nulo o registro é rascunho e pode ser editado ou
 *   excluído. Assim que o PDF é emitido, o hash publicado passa a valer como
 *   prova pública: qualquer alteração posterior faria o Portal de Validação
 *   acusar adulteração num documento legítimo. Por isso update e delete são
 *   recusados após a emissão.
 */

// ─── Erros de domínio ─────────────────────────────────────────────────────────

/** Erro de regra de negócio — o controller traduz para o status HTTP. */
export class DailyAllowanceError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_ORGANIZATION' | 'ALREADY_ISSUED' | 'NOT_ISSUED' | 'INVALID_PERIOD',
    message: string
  ) {
    super(message)
    this.name = 'DailyAllowanceError'
  }
}

// ─── Contratos ────────────────────────────────────────────────────────────────

/** Escopo do chamador — sempre vem do token, nunca do corpo da requisição. */
export interface RequestScope {
  organizationId: string
  userId: string
}

export interface CreateDailyAllowanceInput {
  userId: string
  destination: string
  purpose: string
  departureDate: Date
  returnDate: Date
  dailyRate: number
  dayCount: number
}

export type UpdateDailyAllowanceInput = Partial<CreateDailyAllowanceInput>

export interface ListDailyAllowanceFilter {
  page: number
  limit: number
  userId?: string
  issued?: boolean
  startDate?: Date
  endDate?: Date
}

const LIST_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DailyAllowanceInclude

// ─── Cálculo ──────────────────────────────────────────────────────────────────

/**
 * Total da diária, arredondado a 2 casas.
 *
 * O valor é calculado no servidor e nunca aceito do cliente: o total é dinheiro
 * público e não pode depender de um campo que o navegador consegue alterar.
 */
export function calculateTotalAmount(dailyRate: number, dayCount: number): number {
  return Math.round(dailyRate * dayCount * 100) / 100
}

function assertPeriod(departureDate: Date, returnDate: Date) {
  if (returnDate < departureDate) {
    throw new DailyAllowanceError(
      'INVALID_PERIOD',
      'A data de retorno não pode ser anterior à data de saída.'
    )
  }
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const dailyAllowanceService = {
  async create(input: CreateDailyAllowanceInput, scope: RequestScope) {
    assertPeriod(input.departureDate, input.returnDate)

    return prisma.dailyAllowance.create({
      data: {
        organizationId: scope.organizationId,
        userId: input.userId,
        createdById: scope.userId,
        destination: input.destination,
        purpose: input.purpose,
        departureDate: input.departureDate,
        returnDate: input.returnDate,
        dailyRate: new Prisma.Decimal(input.dailyRate),
        dayCount: new Prisma.Decimal(input.dayCount),
        totalAmount: new Prisma.Decimal(calculateTotalAmount(input.dailyRate, input.dayCount)),
      },
      include: LIST_INCLUDE,
    })
  },

  async list(filter: ListDailyAllowanceFilter, scope: RequestScope) {
    // organizationId é fixado pelo escopo do token: um filtro vindo da query
    // jamais pode alcançar outra organização.
    const where: Prisma.DailyAllowanceWhereInput = { organizationId: scope.organizationId }

    if (filter.userId) where.userId = filter.userId
    if (filter.issued === true) where.documentHash = { not: null }
    if (filter.issued === false) where.documentHash = null

    if (filter.startDate || filter.endDate) {
      where.departureDate = {}
      if (filter.startDate) where.departureDate.gte = filter.startDate
      if (filter.endDate) where.departureDate.lte = filter.endDate
    }

    const [records, total] = await Promise.all([
      prisma.dailyAllowance.findMany({
        where,
        orderBy: { departureDate: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: LIST_INCLUDE,
      }),
      prisma.dailyAllowance.count({ where }),
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
    const record = await prisma.dailyAllowance.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: LIST_INCLUDE,
    })

    if (!record) {
      throw new DailyAllowanceError('NOT_FOUND', 'Diária não encontrada.')
    }
    return record
  },

  async update(id: string, input: UpdateDailyAllowanceInput, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.documentHash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida e não pode mais ser alterada. Emita uma nova diária.'
      )
    }

    const departureDate = input.departureDate ?? current.departureDate
    const returnDate = input.returnDate ?? current.returnDate
    assertPeriod(departureDate, returnDate)

    const dailyRate = input.dailyRate ?? Number(current.dailyRate)
    const dayCount = input.dayCount ?? Number(current.dayCount)

    return prisma.dailyAllowance.update({
      where: { id },
      data: {
        userId: input.userId ?? current.userId,
        destination: input.destination ?? current.destination,
        purpose: input.purpose ?? current.purpose,
        departureDate,
        returnDate,
        dailyRate: new Prisma.Decimal(dailyRate),
        dayCount: new Prisma.Decimal(dayCount),
        totalAmount: new Prisma.Decimal(calculateTotalAmount(dailyRate, dayCount)),
      },
      include: LIST_INCLUDE,
    })
  },

  async remove(id: string, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.documentHash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida e não pode ser excluída. O documento faz parte da prestação de contas.'
      )
    }

    await prisma.dailyAllowance.delete({ where: { id } })
  },

  /**
   * Emite o PDF: gera o arquivo, calcula o SHA-256 e grava hash e chave.
   *
   * O PDF é gerado UMA vez e persistido. Rege-lo a cada download produziria
   * bytes diferentes e o hash publicado deixaria de bater — o Portal de
   * Validação acusaria adulteração num documento legítimo.
   */
  async issue(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (record.documentHash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida. Baixe o documento existente.'
      )
    }

    const organization = await prisma.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true },
    })

    const beneficiary = [record.user?.firstName, record.user?.lastName].filter(Boolean).join(' ')
    const issuer = [record.createdBy?.firstName, record.createdBy?.lastName].filter(Boolean).join(' ')

    const { bytes, documentHash } = await createOfficialPdf({
      title: 'RECIBO DE DIÁRIA',
      organizationName: organization?.name ?? 'Organização',
      publicId: record.publicId,
      sections: [
        {
          heading: 'Servidor',
          fields: [
            { label: 'Nome', value: beneficiary || record.user?.email || '-' },
            { label: 'E-mail', value: record.user?.email ?? '-' },
          ],
        },
        {
          heading: 'Deslocamento',
          fields: [
            { label: 'Destino', value: record.destination },
            { label: 'Motivo', value: record.purpose },
            { label: 'Saída', value: formatDate(record.departureDate) },
            { label: 'Retorno', value: formatDate(record.returnDate) },
          ],
        },
        {
          heading: 'Valores',
          fields: [
            { label: 'Valor unitário da diária', value: formatCurrency(record.dailyRate) },
            { label: 'Quantidade de diárias', value: String(record.dayCount) },
            { label: 'Valor total', value: formatCurrency(record.totalAmount) },
          ],
        },
        {
          fields: [{ label: 'Emitido por', value: issuer || '-' }],
        },
      ],
      footNote: `Documento ${record.publicId}`,
    })

    const pdfFileKey = await saveFile(Buffer.from(bytes), {
      organizationId: scope.organizationId,
      scope: 'daily-allowances',
      originalName: `diaria-${record.publicId}.pdf`,
    })

    const issued = await prisma.dailyAllowance.update({
      where: { id },
      data: { documentHash, pdfFileKey, issuedAt: new Date() },
      include: LIST_INCLUDE,
    })

    // Efeito colateral: a trilha registra quem emitiu documento oficial, mas uma
    // falha de auditoria não pode desfazer uma emissão já concluída.
    await auditLedgerService.record({
      userId: scope.userId,
      action: 'DAILY_ALLOWANCE_ISSUED',
      resource: 'DAILY_ALLOWANCE',
      resourceId: record.id,
      organizationId: scope.organizationId,
      details: { publicId: record.publicId, documentHash },
    })

    return issued
  },

  /** Bytes do PDF já emitido, para download. */
  async getPdf(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (!record.pdfFileKey) {
      throw new DailyAllowanceError(
        'NOT_ISSUED',
        'Esta diária ainda não foi emitida. Emita o documento antes de baixá-lo.'
      )
    }

    const bytes = await fs.readFile(getFilePath(record.pdfFileKey))
    return { bytes, publicId: record.publicId }
  },
}

// ─── Formatação (conteúdo do PDF é pt-BR) ─────────────────────────────────────

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

function formatCurrency(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}
