import { type DailyAllowanceStatus, type FundingSource, Prisma, type TransportMeans } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { readFile, saveFile } from '@/services/storage.service.js'
import { createFormDocumentPdf } from '@/services/document-pdf.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'
import { formatCpf, normalizeCpf } from '@/utils/cpf.util.js'
import { resolveChiefName } from '@/utils/department-chief.util.js'
import { currencyToWords } from '@/utils/currency-in-words.util.js'
import { formatStateLong } from '@/constants/brazilian-states.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { normalizeBeneficiaryName } from '@/services/beneficiary.service.js'
import { BudgetError, budgetService } from '@/services/budget.service.js'
import { holidayService } from '@/services/holiday.service.js'
import { withSerializableRetry } from '@/utils/serializable-retry.util.js'

/**
 * Diárias de servidor (Épico 3, Task 3.1; Épico 4, Fases 3 a 5).
 *
 * REGRA CENTRAL — EMITIDO É IMUTÁVEL:
 *   Enquanto `sha256Hash` é nulo o registro é rascunho e pode ser editado ou
 *   excluído. Assim que o PDF é emitido, o hash publicado passa a valer como
 *   prova pública: qualquer alteração posterior faria o Portal de Validação
 *   acusar adulteração num documento legítimo. Por isso update e delete são
 *   recusados após a emissão.
 *
 * CICLO DE VIDA: PENDING (rascunho) → ISSUED (Anexo I emitido, congelado) →
 * ACCOUNTED (Anexo II emitido, contas prestadas). As transições só andam para
 * frente; não há volta, porque cada passo publica um documento com hash.
 */

// ─── Erros de domínio ─────────────────────────────────────────────────────────

/** Erro de regra de negócio — o controller traduz para o status HTTP. */
export class DailyAllowanceError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'NO_ORGANIZATION'
      | 'ALREADY_ISSUED'
      | 'NOT_ISSUED'
      | 'ALREADY_ACCOUNTED'
      | 'INVALID_PERIOD'
      | 'INVALID_QDD_ITEM'
      | 'TOO_EARLY'
      | 'WEEKEND_JUSTIFICATION_REQUIRED',
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
  /** Setor ao qual a despesa é imputada. Obrigatório desde o Épico 4. */
  departmentId: string
  /** Dotação do QDD que lastreia a diária. */
  qddItemId?: string
  /** Nome de quem viajou. Texto, não FK — ver o comentário no schema. */
  beneficiaryName: string
  destination: string
  purpose: string
  departureDate: Date
  returnDate: Date
  dailyRate: number
  dayCount: number

  /// Dados de registro do beneficiário, para o Anexo I (Épico 4). Ver o
  /// comentário do schema: são cópia textual, capturados AQUI, na criação.
  /** Único campo com o CPF completo, sem máscara — só para imprimir no Anexo I. */
  beneficiaryCpf?: string
  beneficiaryRegistrationNumber?: string
  beneficiaryRg?: string
  /** Órgão emissor do RG — campo da cartilha oficial de prestação de contas. */
  beneficiaryRgIssuer?: string
  beneficiaryJobTitle?: string
  beneficiaryLotacao?: string
  beneficiaryBankName?: string
  beneficiaryBankAgency?: string
  beneficiaryBankAccount?: string

  departureTime?: string
  arrivalTime?: string
  transportMeans?: TransportMeans
  fundingSource?: FundingSource

  /**
   * Justificativa legal exigida pelo TCE quando o período toca sábado,
   * domingo ou feriado cadastrado (Épico 8, FR-022). Capturada no rascunho —
   * a EXIGÊNCIA (bloquear sem ela) só é aplicada em `issue()`.
   */
  weekendHolidayJustification?: string
}

export type UpdateDailyAllowanceInput = Partial<CreateDailyAllowanceInput>

export interface ListDailyAllowanceFilter {
  page: number
  limit: number
  /** Busca parcial, sem distinção de maiúsculas. */
  beneficiaryName?: string
  /**
   * Busca única (Épico 8, FR-006): casa nome, CPF (dígitos) ou "Número da
   * Diária" (`formattedNumber`). Combina com os demais filtros — nunca os
   * substitui.
   */
  search?: string
  /**
   * CPF do beneficiário, em dígitos. Casamento EXATO.
   *
   * Só existe no backend: a tela nunca recebe o número inteiro de volta, e uma
   * busca parcial por CPF permitiria varrer a base por tentativa, transformando
   * o filtro num oráculo de "este CPF existe aqui?".
   */
  cpf?: string
  /** Busca parcial no destino. */
  destination?: string
  status?: DailyAllowanceStatus
  departmentId?: string
  issued?: boolean
  startDate?: Date
  endDate?: Date
}

/** Os mesmos filtros da listagem, sem paginação — relatórios levam tudo. */
export type ReportDailyAllowanceFilter = Omit<ListDailyAllowanceFilter, 'page' | 'limit'>

/** Uma nota fiscal ou documento comprobatório (Épico 8, FR-003). */
export interface AccountForReceiptInput {
  receiptNumber: string
  payeeName: string
  issuedAt: Date
  amount: number
}

export interface AccountForInput {
  accountabilityDate: Date
  activityReport: string
  /** Campos da cartilha oficial anexada pelo cliente (Épico 8, FR-003). */
  ticketNumber?: string
  eventAddress?: string
  contactsInfo?: string
  receipts?: AccountForReceiptInput[]
}

const LIST_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  department: {
    select: {
      id: true,
      name: true,
      code: true,
      // Para o Ordenador de Despesa do Anexo I — o mesmo `resolveChiefName`
      // que a página de detalhe do setor usa.
      manager: { select: { firstName: true, lastName: true } },
    },
  },
  qddItem: { select: { id: true, ficha: true, fonte: true, naturezaDespesa: true, year: true } },
  receipts: { orderBy: { issuedAt: 'asc' } },
} satisfies Prisma.DailyAllowanceInclude

type DailyAllowanceRecord = Prisma.DailyAllowanceGetPayload<{ include: typeof LIST_INCLUDE }>

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

/**
 * Confere o vínculo de QDD, traduzindo `BudgetError` (de `budgetService`,
 * compartilhado com `VirtualProcess`) para `DailyAllowanceError` — o
 * `handleError` do controller de diárias só reconhece o segundo. Sem esta
 * tradução, uma dotação de outra organização vazaria como 500 em vez do 400
 * de domínio esperado.
 */
async function assertQddItemLinkable(qddItemId: string, organizationId: string) {
  try {
    await budgetService.assertQddItemBelongsToOrganization(qddItemId, organizationId)
  } catch (error) {
    if (error instanceof BudgetError) {
      throw new DailyAllowanceError('INVALID_QDD_ITEM', error.message)
    }
    throw error
  }
}

/**
 * A prestação de contas só pode ser emitida a partir do dia de retorno da
 * viagem (Épico 8, FR-001) — nunca antes, mesmo que a requisição contorne a
 * UI. Comparação por DIA DE CALENDÁRIO (UTC), não por instante exato: a
 * diária guarda datas sem hora, e comparar `now` bruto faria a trava liberar
 * só depois da meia-noite UTC do dia de retorno, horas depois do que a tela
 * mostra como "hoje" (mesma técnica de `isAccountabilityLate`).
 */
function assertReturnDateReached(returnDate: Date, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const returnDay = Date.UTC(returnDate.getUTCFullYear(), returnDate.getUTCMonth(), returnDate.getUTCDate())

  if (today < returnDay) {
    throw new DailyAllowanceError(
      'TOO_EARLY',
      `A prestação de contas só pode ser emitida a partir de ${formatDate(returnDate)}, quando a viagem termina.`
    )
  }
}

/**
 * O período `[departureDate, returnDate]` (inclusive) toca sábado, domingo ou
 * um feriado cadastrado (Épico 8, FR-021)?
 *
 * Percorre dia a dia em vez de calcular por fórmula: o intervalo de uma
 * diária tem no máximo poucas semanas, então o custo é irrelevante, e
 * percorrer é o jeito mais direto de não errar limites (o dia de RETORNO
 * conta — um evento que termina no sábado ainda é uma diária de fim de
 * semana).
 */
export function touchesWeekendOrHoliday(
  departureDate: Date,
  returnDate: Date,
  holidays: Pick<{ date: Date }, 'date'>[]
): boolean {
  const holidayDates = new Set(holidays.map(h => h.date.toISOString().slice(0, 10)))

  const cursor = new Date(
    Date.UTC(departureDate.getUTCFullYear(), departureDate.getUTCMonth(), departureDate.getUTCDate())
  )
  const end = new Date(Date.UTC(returnDate.getUTCFullYear(), returnDate.getUTCMonth(), returnDate.getUTCDate()))

  while (cursor <= end) {
    const dayOfWeek = cursor.getUTCDay() // 0 = domingo, 6 = sábado
    if (dayOfWeek === 0 || dayOfWeek === 6) return true
    if (holidayDates.has(cursor.toISOString().slice(0, 10))) return true
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return false
}

/** Prazo legal para prestar contas, contado do retorno. */
export const ACCOUNTABILITY_DEADLINE_DAYS = 5

/**
 * A prestação de contas está vencida?
 *
 * Só faz sentido para diária EMITIDA: um rascunho não gerou despesa, e uma já
 * prestada não pode atrasar retroativamente. O cálculo é feito no SERVIDOR e
 * enviado pronto — deixá-lo na tela significaria que o relógio do computador do
 * usuário decidiria quem está em atraso.
 */
export function isAccountabilityLate(
  record: Pick<DailyAllowanceRecord, 'status' | 'accountabilityDate' | 'returnDate'>,
  now = new Date()
): boolean {
  if (record.status !== 'ISSUED') return false
  if (record.accountabilityDate) return false

  const deadline = new Date(record.returnDate)
  deadline.setUTCDate(deadline.getUTCDate() + ACCOUNTABILITY_DEADLINE_DAYS)

  return now > deadline
}

/** Acrescenta os campos derivados que a tela consome mas não persistimos. */
function withDerivedFlags<T extends Pick<DailyAllowanceRecord, 'status' | 'accountabilityDate' | 'returnDate'>>(
  record: T,
  now = new Date()
) {
  return { ...record, isLate: isAccountabilityLate(record, now) }
}

// ─── Filtro ───────────────────────────────────────────────────────────────────

/**
 * Traduz os filtros da API para a cláusula do Prisma.
 *
 * Compartilhado pela listagem e pelos relatórios: se os dois montassem o `where`
 * por conta própria, o PDF um dia mostraria um conjunto de registros diferente
 * do que a tela exibe — e seria o PDF que iria ao Tribunal de Contas.
 *
 * É assíncrona por causa do CPF: o número mora em `Beneficiary`, e a diária
 * guarda só o nome (ver o comentário de `beneficiaryName` no schema), então o
 * filtro precisa resolver CPF → nome antes de consultar.
 */
export async function buildDailyAllowanceWhere(
  filter: ReportDailyAllowanceFilter,
  organizationId: string
): Promise<Prisma.DailyAllowanceWhereInput> {
  // organizationId é fixado pelo escopo do token: um filtro vindo da query
  // jamais pode alcançar outra organização.
  const where: Prisma.DailyAllowanceWhereInput = { organizationId }

  if (filter.beneficiaryName) {
    where.beneficiaryName = { contains: filter.beneficiaryName, mode: 'insensitive' }
  }

  // Busca única (Épico 8, FR-006): nome, CPF ou "Número da Diária" — o que o
  // usuário digitar. Um OR à parte dos filtros estruturados acima: os dois
  // compõem (AND), nunca um substitui o outro.
  if (filter.search) {
    const term = filter.search.trim()
    const digits = term.replace(/\D/g, '')
    where.OR = [
      { beneficiaryName: { contains: term, mode: 'insensitive' } },
      { formattedNumber: { contains: term, mode: 'insensitive' } },
      // CPF só entra por IGUALDADE EXATA de 11 dígitos, nunca `contains`: o
      // mesmo raciocínio do filtro `cpf` acima — busca parcial por CPF
      // transformaria a caixa de busca num oráculo para descobrir, dígito a
      // dígito, se um CPF existe na base.
      ...(digits.length === 11 ? [{ beneficiaryCpf: digits }] : []),
    ]
  }

  if (filter.destination) {
    where.destination = { contains: filter.destination, mode: 'insensitive' }
  }
  if (filter.status) where.status = filter.status
  if (filter.departmentId) where.departmentId = filter.departmentId

  if (filter.issued === true) where.sha256Hash = { not: null }
  if (filter.issued === false) where.sha256Hash = null

  if (filter.startDate || filter.endDate) {
    where.departureDate = {}
    if (filter.startDate) where.departureDate.gte = filter.startDate
    if (filter.endDate) where.departureDate.lte = filter.endDate
  }

  const cpf = normalizeCpf(filter.cpf)
  if (cpf) {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { cpf, organizationId },
      select: { name: true },
    })

    // CPF sem cadastro devolve lista vazia, nunca a lista inteira: silenciar o
    // filtro faria uma busca infrutífera parecer "todas as diárias do município".
    where.beneficiaryName = beneficiary ? beneficiary.name : { in: [] }
  }

  return where
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const dailyAllowanceService = {
  async create(input: CreateDailyAllowanceInput, scope: RequestScope) {
    assertPeriod(input.departureDate, input.returnDate)

    if (input.qddItemId) {
      await assertQddItemLinkable(input.qddItemId, scope.organizationId)
    }

    // Exercício da numeração: o ano da VIAGEM, não o de hoje — mesma âncora já
    // usada pelas fichas do QDD (`QddItem.year`), para que a numeração de uma
    // diária lançada em janeiro sobre uma viagem de dezembro não fique presa
    // ao ano "errado".
    const year = input.departureDate.getUTCFullYear()

    const record = await withSerializableRetry(() =>
      prisma.$transaction(
        async tx => {
          // Numeração legível ("Número da Diária", Épico 8, FR-002) — mesmo
          // padrão de OfficialDocument: sequencial por organização e ano.
          // Calculada e gravada DENTRO desta transação Serializable para que
          // duas criações concorrentes nunca recebam o mesmo número; o retry
          // acima cobre o conflito que o Postgres acusa quando isso quase
          // acontece.
          const last = await tx.dailyAllowance.aggregate({
            where: { organizationId: scope.organizationId, year },
            _max: { sequenceNumber: true },
          })
          const sequenceNumber = (last._max.sequenceNumber ?? 0) + 1
          const formattedNumber = `${String(sequenceNumber).padStart(4, '0')}/${year}`

          return tx.dailyAllowance.create({
            data: {
              organizationId: scope.organizationId,
              departmentId: input.departmentId,
              qddItemId: input.qddItemId,
              sequenceNumber,
              year,
              formattedNumber,
              beneficiaryName: normalizeBeneficiaryName(input.beneficiaryName),
              createdById: scope.userId,
              destination: input.destination,
              purpose: input.purpose,
              departureDate: input.departureDate,
              returnDate: input.returnDate,
              dailyRate: new Prisma.Decimal(input.dailyRate),
              dayCount: new Prisma.Decimal(input.dayCount),
              totalAmount: new Prisma.Decimal(calculateTotalAmount(input.dailyRate, input.dayCount)),
              // CPF em dígitos apenas — a máscara é apresentação, ver `cpf.util.ts`.
              beneficiaryCpf: normalizeCpf(input.beneficiaryCpf) ?? undefined,
              beneficiaryRegistrationNumber: input.beneficiaryRegistrationNumber,
              beneficiaryRg: input.beneficiaryRg,
              beneficiaryRgIssuer: input.beneficiaryRgIssuer,
              beneficiaryJobTitle: input.beneficiaryJobTitle,
              beneficiaryLotacao: input.beneficiaryLotacao,
              beneficiaryBankName: input.beneficiaryBankName,
              beneficiaryBankAgency: input.beneficiaryBankAgency,
              beneficiaryBankAccount: input.beneficiaryBankAccount,
              departureTime: input.departureTime,
              arrivalTime: input.arrivalTime,
              transportMeans: input.transportMeans,
              fundingSource: input.fundingSource,
              weekendHolidayJustification: input.weekendHolidayJustification,
            },
            include: LIST_INCLUDE,
          })
        },
        { isolationLevel: 'Serializable' }
      )
    )

    return withDerivedFlags(record)
  },

  async list(filter: ListDailyAllowanceFilter, scope: RequestScope) {
    const where = await buildDailyAllowanceWhere(filter, scope.organizationId)

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

    // Um só instante para a página inteira: calcular `now` por registro deixaria
    // duas linhas da mesma tabela julgadas por relógios diferentes.
    const now = new Date()

    return {
      data: records.map(record => withDerivedFlags(record, now)),
      meta: {
        total,
        page: filter.page,
        limit: filter.limit,
        totalPages: Math.ceil(total / filter.limit),
      },
    }
  },

  /** Todos os registros que casam com o filtro, para relatório. Sem paginação. */
  async findForReport(filter: ReportDailyAllowanceFilter, scope: RequestScope) {
    const where = await buildDailyAllowanceWhere(filter, scope.organizationId)

    const records = await prisma.dailyAllowance.findMany({
      where,
      orderBy: { departureDate: 'desc' },
      include: LIST_INCLUDE,
    })

    const now = new Date()
    return records.map(record => withDerivedFlags(record, now))
  },

  async getById(id: string, scope: RequestScope) {
    const record = await prisma.dailyAllowance.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: LIST_INCLUDE,
    })

    if (!record) {
      throw new DailyAllowanceError('NOT_FOUND', 'Diária não encontrada.')
    }
    return withDerivedFlags(record)
  },

  async update(id: string, input: UpdateDailyAllowanceInput, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.sha256Hash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida e não pode mais ser alterada. Emita uma nova diária.'
      )
    }

    const departureDate = input.departureDate ?? current.departureDate
    const returnDate = input.returnDate ?? current.returnDate
    assertPeriod(departureDate, returnDate)

    if (input.qddItemId) {
      await assertQddItemLinkable(input.qddItemId, scope.organizationId)
    }

    const dailyRate = input.dailyRate ?? Number(current.dailyRate)
    const dayCount = input.dayCount ?? Number(current.dayCount)

    const record = await prisma.dailyAllowance.update({
      where: { id },
      data: {
        departmentId: input.departmentId ?? current.departmentId,
        qddItemId: input.qddItemId ?? current.qddItemId,
        beneficiaryName: input.beneficiaryName
          ? normalizeBeneficiaryName(input.beneficiaryName)
          : current.beneficiaryName,
        destination: input.destination ?? current.destination,
        purpose: input.purpose ?? current.purpose,
        departureDate,
        returnDate,
        dailyRate: new Prisma.Decimal(dailyRate),
        dayCount: new Prisma.Decimal(dayCount),
        totalAmount: new Prisma.Decimal(calculateTotalAmount(dailyRate, dayCount)),
        ...(input.beneficiaryCpf !== undefined
          ? { beneficiaryCpf: normalizeCpf(input.beneficiaryCpf) }
          : {}),
        ...(input.beneficiaryRegistrationNumber !== undefined
          ? { beneficiaryRegistrationNumber: input.beneficiaryRegistrationNumber }
          : {}),
        ...(input.beneficiaryRg !== undefined ? { beneficiaryRg: input.beneficiaryRg } : {}),
        ...(input.beneficiaryRgIssuer !== undefined
          ? { beneficiaryRgIssuer: input.beneficiaryRgIssuer }
          : {}),
        ...(input.beneficiaryJobTitle !== undefined
          ? { beneficiaryJobTitle: input.beneficiaryJobTitle }
          : {}),
        ...(input.beneficiaryLotacao !== undefined
          ? { beneficiaryLotacao: input.beneficiaryLotacao }
          : {}),
        ...(input.beneficiaryBankName !== undefined
          ? { beneficiaryBankName: input.beneficiaryBankName }
          : {}),
        ...(input.beneficiaryBankAgency !== undefined
          ? { beneficiaryBankAgency: input.beneficiaryBankAgency }
          : {}),
        ...(input.beneficiaryBankAccount !== undefined
          ? { beneficiaryBankAccount: input.beneficiaryBankAccount }
          : {}),
        ...(input.departureTime !== undefined ? { departureTime: input.departureTime } : {}),
        ...(input.arrivalTime !== undefined ? { arrivalTime: input.arrivalTime } : {}),
        ...(input.transportMeans !== undefined ? { transportMeans: input.transportMeans } : {}),
        ...(input.fundingSource !== undefined ? { fundingSource: input.fundingSource } : {}),
        ...(input.weekendHolidayJustification !== undefined
          ? { weekendHolidayJustification: input.weekendHolidayJustification }
          : {}),
      },
      include: LIST_INCLUDE,
    })

    return withDerivedFlags(record)
  },

  async remove(id: string, scope: RequestScope) {
    const current = await this.getById(id, scope)

    if (current.sha256Hash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida e não pode ser excluída. O documento faz parte da prestação de contas.'
      )
    }

    await prisma.dailyAllowance.delete({ where: { id } })
  },

  /**
   * Emite o Anexo I: gera o PDF, calcula o SHA-256, congela o registro e
   * carimba a dotação orçamentária.
   *
   * O PDF é gerado UMA vez e persistido. Rege-lo a cada download produziria
   * bytes diferentes e o hash publicado deixaria de bater — o Portal de
   * Validação acusaria adulteração num documento legítimo.
   */
  async issue(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (record.sha256Hash) {
      throw new DailyAllowanceError(
        'ALREADY_ISSUED',
        'Esta diária já foi emitida. Baixe o documento existente.'
      )
    }

    // Regra do TCE (Épico 8, FR-021/FR-022): período em fim de semana ou
    // feriado cadastrado exige justificativa — checado no SERVIDOR, na
    // EMISSÃO, não no rascunho (o rascunho ainda pode ter datas incompletas
    // ou ser corrigido antes de virar despesa).
    const holidays = await holidayService.getHolidaysInRange(
      scope.organizationId,
      record.departureDate,
      record.returnDate
    )
    if (
      touchesWeekendOrHoliday(record.departureDate, record.returnDate, holidays) &&
      !record.weekendHolidayJustification?.trim()
    ) {
      throw new DailyAllowanceError(
        'WEEKEND_JUSTIFICATION_REQUIRED',
        'O período da viagem inclui sábado, domingo ou feriado cadastrado. Informe a justificativa legal antes de emitir.'
      )
    }

    const organization = await prisma.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true, city: true, state: true },
    })

    // ── Snapshot da dotação ──
    // Cópia TEXTUAL, tirada no instante da emissão: se o QDD for corrigido ou a
    // ficha remanejada amanhã, o documento já entregue continua descrevendo a
    // dotação que de fato lastreou a despesa. Mesma razão de `beneficiaryName`
    // ser texto e não chave estrangeira.
    const snapshot = record.qddItem
      ? {
          qddFichaSnapshot: record.qddItem.ficha,
          qddFonteSnapshot: record.qddItem.fonte,
          qddNaturezaSnapshot: record.qddItem.naturezaDespesa,
        }
      : {}

    // LGPD (Princípio VIII): o nome de quem emitiu sai OFUSCADO e vai para o
    // rodapé universal, nunca em texto plano no corpo do documento.
    // O nome COMPLETO só existe em memória, para o registro ofuscá-lo na
    // fronteira da persistência; o que entra no PDF é a forma já mascarada.
    const issuerFullName = [record.createdBy?.firstName, record.createdBy?.lastName]
      .filter(Boolean)
      .join(' ')
    const exporterName = anonymizeUserName(
      record.createdBy?.firstName,
      record.createdBy?.lastName
    )

    // White-label (Task 3.4): a logo do tenant entra no cabeçalho. O serviço
    // nunca lança — sem logo, o documento sai com cabeçalho neutro, porque uma
    // imagem faltando não pode impedir a emissão de um documento oficial.
    const logoPng = await organizationBrandingService.getLogoBytes(scope.organizationId)

    // Logo do SETOR primeiro; sem ela, a da organização — mesma cascata já
    // usada no dossiê do departamento.
    const issuedAt = new Date()
    const cityName = organization?.city || 'Município'
    const stateLong = formatStateLong(organization?.state)

    // Fora da transação, e de propósito: montar o PDF e gravá-lo em disco leva
    // centenas de milissegundos: segurar uma transação aberta por todo esse
    // tempo prenderia a conexão e, num pico de emissões, esgotaria o pool.
    //
    // GRADE NUMERADA, replicando o formulário físico "Afastamento e Concessão
    // de Diárias" que a prefeitura já usa — 20 campos, na mesma disposição do
    // papel. Não é texto corrido: é a estrutura que o usuário exigiu.
    const { bytes, sha256Hash } = await createFormDocumentPdf({
      title: 'FORMULÁRIO DE AFASTAMENTO E CONCESSÃO DE DIÁRIAS',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId: record.publicId,
      exporterName,
      blocks: [
        {
          type: 'grid',
          rows: [
            {
              cells: [
                { number: 1, label: 'Data', value: formatDate(issuedAt) },
                { number: 2, label: 'Matrícula Funcional', value: record.beneficiaryRegistrationNumber ?? '' },
              ],
            },
            {
              cells: [
                { number: 3, label: 'Ficha', value: record.qddItem?.ficha ?? '' },
                { number: 4, label: 'Fonte', value: record.qddItem?.fonte ?? '' },
              ],
            },
            {
              cells: [{ number: 5, label: 'Beneficiário', value: record.beneficiaryName }],
            },
            {
              cells: [
                { number: 6, label: 'Lotação', value: record.beneficiaryLotacao ?? '' },
                { number: 7, label: 'Cargo/Função', value: record.beneficiaryJobTitle ?? '' },
              ],
            },
            {
              cells: [
                // ÚNICA exceção do sistema à máscara de CPF — ver o comentário
                // em `beneficiaryCpf` no schema e `cpf.util.ts#formatCpf`.
                { number: 8, label: 'CPF', value: formatCpf(record.beneficiaryCpf) },
                { number: 9, label: 'RG/Órgão Expedidor', value: record.beneficiaryRg ?? '' },
                { number: 10, label: 'Banco/Agência/Conta', value: formatBankInfo(record) },
              ],
            },
            {
              cells: [
                { number: 11, label: 'Itinerário', value: record.destination },
                { number: 12, label: 'Horário de Saída', value: record.departureTime || 'EM ABERTO' },
                { number: 13, label: 'Meio de Transporte', value: TRANSPORT_LABELS[record.transportMeans ?? ''] ?? '' },
              ],
            },
            {
              cells: [
                {
                  number: 14,
                  label: 'Período da Viagem',
                  value: `${formatDate(record.departureDate)} a ${formatDate(record.returnDate)}`,
                },
                { number: 15, label: 'Horário de Chegada', value: record.arrivalTime || 'EM ABERTO' },
                { number: 16, label: 'Recursos', value: FUNDING_LABELS[record.fundingSource ?? ''] ?? '' },
              ],
            },
            {
              cells: [
                { number: 17, label: 'Número de Diárias', value: String(record.dayCount) },
                { number: 18, label: 'Valor Unitário (R$)', value: formatCurrency(record.dailyRate) },
                { number: 19, label: 'Valor Total (R$)', value: formatCurrency(record.totalAmount) },
              ],
            },
            {
              cells: [{ number: 20, label: 'Finalidade da Viagem', value: record.purpose }],
            },
          ],
        },
        {
          type: 'signature',
          name: resolveChiefName(record.department.manager),
          role: formatDepartment(record.department),
        },
        {
          type: 'text',
          heading: 'RECIBO',
          ruleBefore: true,
          lines: [
            `Valor: ${formatCurrency(record.totalAmount)}`,
            `Recebi da Prefeitura Municipal de ${cityName}${stateLong ? `, ${stateLong}` : ''} a importância ` +
              `de ${formatCurrency(record.totalAmount)} (${currencyToWords(Number(record.totalAmount))}) ` +
              'proveniente de diária de viagem, conforme formulário acima.',
            `${cityName}${organization?.state ? ` - ${organization.state}` : ''}, ${formatDate(issuedAt)}`,
          ],
        },
        {
          type: 'signature',
          name: record.beneficiaryName,
          role: record.beneficiaryJobTitle || undefined,
        },
      ],
    })

    const pdfFileKey = await saveFile(Buffer.from(bytes), {
      organizationId: scope.organizationId,
      scope: 'daily-allowances',
      originalName: `diaria-${record.publicId}.pdf`,
    })

    const { issued, budgetOverrun } = await prisma.$transaction(async tx => {
      // Trava de corrida: `updateMany` com `sha256Hash: null` no filtro só
      // acerta enquanto o registro ainda é rascunho. Dois cliques simultâneos
      // em "Emitir" gerariam dois PDFs com hashes distintos para a MESMA
      // diária, e o segundo sobrescreveria o primeiro — que já teria sido
      // baixado e arquivado por alguém.
      const claimed = await tx.dailyAllowance.updateMany({
        where: { id, organizationId: scope.organizationId, sha256Hash: null },
        data: { sha256Hash, pdfFileKey, issuedAt: new Date(), status: 'ISSUED', ...snapshot },
      })

      if (claimed.count === 0) {
        throw new DailyAllowanceError(
          'ALREADY_ISSUED',
          'Esta diária já foi emitida. Baixe o documento existente.'
        )
      }

      // ── Estouro de dotação ──
      // Calculado DEPOIS de gravar, e dentro da mesma transação, para que o
      // total já inclua esta diária e nenhuma emissão concorrente escape da
      // soma. Não bloqueia: suplementação e remanejamento são rotina na
      // administração pública, e travar a emissão engessaria o município. O que
      // se registra é o rastro para a auditoria.
      const overrun = record.qddItemId
        ? await budgetService.detectOverrun(tx, record.qddItemId)
        : false

      if (overrun) {
        await tx.dailyAllowance.update({
          where: { id },
          data: { budgetOverrun: true },
        })
      }

      const fresh = await tx.dailyAllowance.findUniqueOrThrow({
        where: { id },
        include: LIST_INCLUDE,
      })

      return { issued: fresh, budgetOverrun: overrun }
    })

    // Efeito colateral: a trilha registra quem emitiu documento oficial, mas uma
    // falha de auditoria não pode desfazer uma emissão já concluída.
    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE,
      publicId: record.publicId,
      bytes,
      exporterFullName: issuerFullName || undefined,
    })

    await auditLedgerService.record({
      userId: scope.userId,
      action: 'DAILY_ALLOWANCE_ISSUED',
      resource: 'DAILY_ALLOWANCE',
      resourceId: record.id,
      organizationId: scope.organizationId,
      details: { publicId: record.publicId, sha256Hash, budgetOverrun },
    })

    return withDerivedFlags(issued)
  },

  /**
   * Presta contas do deslocamento e emite o Anexo II.
   *
   * Exige que o Anexo I já tenha sido emitido: prestar contas de uma diária que
   * ninguém autorizou não descreve nada. E o Anexo II ganha identificador e hash
   * PRÓPRIOS — são dois documentos distintos circulando, cada um validável por
   * si no Portal.
   */
  async accountFor(id: string, input: AccountForInput, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (record.status !== 'ISSUED') {
      throw new DailyAllowanceError(
        record.status === 'ACCOUNTED' ? 'ALREADY_ACCOUNTED' : 'NOT_ISSUED',
        record.status === 'ACCOUNTED'
          ? 'A prestação de contas desta diária já foi registrada e não pode ser refeita.'
          : 'Emita a diária antes de prestar contas dela.'
      )
    }

    // Regra de liberação (Épico 8, FR-001): recusada no SERVIDOR, não apenas
    // pelo botão desabilitado na tela.
    assertReturnDateReached(record.returnDate)

    if (input.accountabilityDate < record.departureDate) {
      throw new DailyAllowanceError(
        'INVALID_PERIOD',
        'A data da prestação de contas não pode ser anterior à saída.'
      )
    }

    const organization = await prisma.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true },
    })

    const accountantFullName = [record.createdBy?.firstName, record.createdBy?.lastName]
      .filter(Boolean)
      .join(' ')
    const exporterName = anonymizeUserName(
      record.createdBy?.firstName,
      record.createdBy?.lastName
    )

    const logoPng = await organizationBrandingService.getLogoBytes(scope.organizationId)
    const accountabilityPublicId = exportedDocumentService.newPublicId()
    const receipts = input.receipts ?? []

    // GRADE, replicando campo a campo a cartilha oficial de Prestação de
    // Contas de Diária anexada pelo cliente (Épico 8, FR-004) — mesmo motor
    // do Anexo I (`createFormDocumentPdf`): o papel também é um formulário de
    // células com borda, não uma lista de campos em prosa como o Anexo II
    // anterior a este épico.
    const { bytes, sha256Hash } = await createFormDocumentPdf({
      title: 'PRESTAÇÃO DE CONTAS DE DIÁRIA (ANEXO II)',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId: accountabilityPublicId,
      exporterName,
      blocks: [
        {
          type: 'grid',
          rows: [
            {
              cells: [
                { label: 'Órgão/Entidade Concedente', value: organization?.name ?? 'Organização', span: 2 },
                { label: 'Data de Prestação de Contas', value: formatDate(input.accountabilityDate), span: 1 },
              ],
            },
            { cells: [{ label: 'Número do Processo de Solicitação', value: record.formattedNumber }] },
          ],
        },
        { type: 'text', heading: 'IDENTIFICAÇÃO DO BENEFICIÁRIO', lines: [] },
        {
          type: 'grid',
          rows: [
            { cells: [{ label: 'Nome', value: record.beneficiaryName }] },
            {
              cells: [
                { label: 'Cargo/Função', value: record.beneficiaryJobTitle ?? '' },
                { label: 'Lotação', value: record.beneficiaryLotacao ?? '' },
                { label: 'Matrícula', value: record.beneficiaryRegistrationNumber ?? '' },
              ],
            },
            {
              cells: [
                // ÚNICA exceção do sistema à máscara de CPF — mesmo motivo do
                // Anexo I: este anexo é o formulário físico que comprova a
                // identidade de quem recebeu o valor.
                { label: 'CPF', value: formatCpf(record.beneficiaryCpf) },
                { label: 'Identidade', value: record.beneficiaryRg ?? '' },
                { label: 'Órgão Emissor', value: record.beneficiaryRgIssuer ?? '' },
              ],
            },
          ],
        },
        { type: 'text', heading: 'PERÍODO DA VIAGEM', lines: [] },
        {
          type: 'grid',
          rows: [
            {
              cells: [
                { label: 'Data de Saída', value: formatDate(record.departureDate) },
                { label: 'Data de Volta', value: formatDate(record.returnDate) },
              ],
            },
            {
              cells: [
                { label: 'Horário de Saída', value: record.departureTime || 'EM ABERTO' },
                { label: 'Horário de Chegada', value: record.arrivalTime || 'EM ABERTO' },
              ],
            },
          ],
        },
        { type: 'text', heading: 'DOCUMENTOS COMPROBATÓRIOS', lines: [] },
        {
          type: 'grid',
          rows: [
            { cells: [{ label: 'Nº Bilhete de Passagem', value: input.ticketNumber ?? '' }] },
            // Uma linha por nota fiscal — a cartilha física tem exatamente essa
            // tabela (Número/Favorecido/Data/Valor), com quantas linhas o
            // comprovante exigir.
            ...receipts.map(receipt => ({
              cells: [
                { label: 'Número', value: receipt.receiptNumber, span: 1 },
                { label: 'Favorecido', value: receipt.payeeName, span: 2 },
                { label: 'Data', value: formatDate(receipt.issuedAt), span: 1 },
                { label: 'Valor', value: formatCurrency(receipt.amount), span: 1 },
              ],
            })),
          ],
        },
        { type: 'text', heading: 'INFORMAÇÕES COMPLEMENTARES', lines: [] },
        {
          type: 'grid',
          rows: [
            {
              cells: [
                {
                  label: 'Endereço e Local do Evento/Reunião/Atividade Desenvolvida',
                  value: input.eventAddress ?? '',
                },
              ],
            },
            {
              cells: [
                {
                  label: 'Nome, Cargo/Função e Telefone(s) de Contato(s) Efetuado(s)',
                  value: input.contactsInfo ?? '',
                },
              ],
            },
          ],
        },
        {
          type: 'text',
          heading: 'RELATÓRIO DE ATIVIDADES DESENVOLVIDAS',
          ruleBefore: true,
          lines: [input.activityReport],
        },
        { type: 'signature', name: record.beneficiaryName, role: 'Beneficiário' },
        {
          type: 'text',
          heading: 'APROVAÇÃO',
          ruleBefore: true,
          lines: [`Data: ${formatDate(new Date())}`],
        },
        // Nome em branco de propósito: quem analisa a prestação assina à mão
        // depois de impresso — o sistema não atribui esse nome (Épico 8,
        // Assumption "Aprovação é impressa, não é workflow digital").
        { type: 'signature', name: '', role: 'Setor Responsável pela Análise da Prestação de Contas' },
        // O Ordenador de Despesa É o chefe do departamento (`resolveChiefName`,
        // ver o comentário do util) — nunca um `chiefName` de texto livre, que
        // já foi removido do domínio por divergir do organograma real.
        { type: 'signature', name: resolveChiefName(record.department.manager), role: 'Ordenador de Despesas' },
      ],
      footNote:
        'Este anexo deve ser arquivado acompanhado dos comprovantes originais de ' +
        'despesa — notas fiscais, bilhetes de passagem e recibos de hospedagem — ' +
        'que permanecem à disposição do Controle Interno e do Tribunal de Contas.',
    })

    const accountabilityPdfFileKey = await saveFile(Buffer.from(bytes), {
      organizationId: scope.organizationId,
      scope: 'daily-allowances',
      originalName: `prestacao-contas-${accountabilityPublicId}.pdf`,
    })

    const accounted = await prisma.$transaction(async tx => {
      // Mesma trava da emissão: só avança quem encontrar o registro ainda em
      // ISSUED. Duas prestações simultâneas produziriam dois Anexos II válidos
      // para a mesma diária.
      const claimed = await tx.dailyAllowance.updateMany({
        where: { id, organizationId: scope.organizationId, status: 'ISSUED' },
        data: {
          status: 'ACCOUNTED',
          accountabilityDate: input.accountabilityDate,
          activityReport: input.activityReport,
          accountabilityTicketNumber: input.ticketNumber,
          accountabilityEventAddress: input.eventAddress,
          accountabilityContactsInfo: input.contactsInfo,
          accountabilityPublicId,
          accountabilitySha256Hash: sha256Hash,
          accountabilityPdfFileKey,
          accountabilityIssuedAt: new Date(),
        },
      })

      if (claimed.count === 0) {
        throw new DailyAllowanceError(
          'ALREADY_ACCOUNTED',
          'A prestação de contas desta diária já foi registrada e não pode ser refeita.'
        )
      }

      // Notas fiscais comprobatórias — gravadas na MESMA transação que o hash
      // do Anexo II (Épico 8, FR-026): um Anexo já registrado sem seus
      // comprovantes, ou comprovantes gravados sem o Anexo correspondente, são
      // os dois lados da mesma inconsistência que o Princípio VIII proíbe.
      // Não há endpoint de edição para `DailyAllowanceReceipt` — a
      // imutabilidade pós-hash (FR-005) é garantida por não existir caminho
      // de escrita nenhum além deste, não por uma trava adicional.
      if (receipts.length > 0) {
        await tx.dailyAllowanceReceipt.createMany({
          data: receipts.map(receipt => ({
            dailyAllowanceId: id,
            receiptNumber: receipt.receiptNumber,
            payeeName: receipt.payeeName,
            issuedAt: receipt.issuedAt,
            amount: new Prisma.Decimal(receipt.amount),
          })),
        })
      }

      return tx.dailyAllowance.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE })
    })

    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE_ACCOUNTABILITY,
      publicId: accountabilityPublicId,
      bytes,
      exporterFullName: accountantFullName || undefined,
    })

    await auditLedgerService.record({
      userId: scope.userId,
      action: 'DAILY_ALLOWANCE_ACCOUNTED',
      resource: 'DAILY_ALLOWANCE',
      resourceId: record.id,
      organizationId: scope.organizationId,
      details: { publicId: accountabilityPublicId, sha256Hash, receiptCount: receipts.length },
    })

    return withDerivedFlags(accounted)
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

    const bytes = await readFile(record.pdfFileKey)
    return { bytes, publicId: record.publicId }
  },

  /** Bytes do Anexo II já emitido, para download. */
  async getAccountabilityPdf(id: string, scope: RequestScope) {
    const record = await this.getById(id, scope)

    if (!record.accountabilityPdfFileKey || !record.accountabilityPublicId) {
      throw new DailyAllowanceError(
        'NOT_ISSUED',
        'A prestação de contas desta diária ainda não foi registrada.'
      )
    }

    const bytes = await readFile(record.accountabilityPdfFileKey)
    return { bytes, publicId: record.accountabilityPublicId }
  },
}

// ─── Formatação (conteúdo do PDF é pt-BR) ─────────────────────────────────────

export function formatDepartment(department: { name: string; code: string } | null): string {
  if (!department) return '-'
  return `${department.code} - ${department.name}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

function formatCurrency(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

/** Rótulos em pt-BR das opções do formulário físico — mesmas caixas de seleção. */
const TRANSPORT_LABELS: Record<string, string> = {
  RODOVIARIO: 'Rodoviário',
  AEREO: 'Aéreo',
  VEICULO_OFICIAL: 'Veículo Oficial',
  OUTRO: 'Outro',
}

const FUNDING_LABELS: Record<string, string> = {
  PROPRIO: 'Próprio',
  CONVENIO: 'Convênio',
}

/**
 * "BRADESCO · AG: 1725-6 · CONTA: 24309-4" — as três partes do campo 10 do
 * formulário físico, que trata banco/agência/conta como UMA célula só.
 * Partes ausentes somem, em vez de imprimir "· ·" vazio.
 */
function formatBankInfo(record: {
  beneficiaryBankName: string | null
  beneficiaryBankAgency: string | null
  beneficiaryBankAccount: string | null
}): string {
  const parts: string[] = []
  if (record.beneficiaryBankName) parts.push(record.beneficiaryBankName)
  if (record.beneficiaryBankAgency) parts.push(`AG: ${record.beneficiaryBankAgency}`)
  if (record.beneficiaryBankAccount) parts.push(`CONTA: ${record.beneficiaryBankAccount}`)
  return parts.join(' · ')
}
