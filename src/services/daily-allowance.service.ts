import { type DailyAllowanceStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { readFile, saveFile } from '@/services/storage.service.js'
import { createOfficialPdf } from '@/services/document-pdf.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'
import { normalizeCpf } from '@/utils/cpf.util.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { normalizeBeneficiaryName } from '@/services/beneficiary.service.js'

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
      | 'INVALID_QDD_ITEM',
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
}

export type UpdateDailyAllowanceInput = Partial<CreateDailyAllowanceInput>

export interface ListDailyAllowanceFilter {
  page: number
  limit: number
  /** Busca parcial, sem distinção de maiúsculas. */
  beneficiaryName?: string
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

export interface AccountForInput {
  accountabilityDate: Date
  activityReport: string
}

const LIST_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  department: { select: { id: true, name: true, code: true } },
  qddItem: { select: { id: true, ficha: true, fonte: true, naturezaDespesa: true, year: true } },
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
      await assertQddItemBelongsToOrganization(input.qddItemId, scope.organizationId)
    }

    const record = await prisma.dailyAllowance.create({
      data: {
        organizationId: scope.organizationId,
        departmentId: input.departmentId,
        qddItemId: input.qddItemId,
        beneficiaryName: normalizeBeneficiaryName(input.beneficiaryName),
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
      await assertQddItemBelongsToOrganization(input.qddItemId, scope.organizationId)
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

    const organization = await prisma.organization.findUnique({
      where: { id: scope.organizationId },
      select: { name: true },
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

    const sections = [
      {
        heading: 'Servidor',
        fields: [{ label: 'Nome', value: record.beneficiaryName }],
      },
      {
        heading: 'Unidade Orçamentária',
        fields: [
          { label: 'Setor', value: formatDepartment(record.department) },
          ...(record.qddItem
            ? [
                { label: 'Ficha (QDD)', value: record.qddItem.ficha },
                { label: 'Fonte de recurso', value: record.qddItem.fonte },
                { label: 'Natureza da despesa', value: record.qddItem.naturezaDespesa },
              ]
            : []),
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
    ]

    // Fora da transação, e de propósito: montar o PDF e gravá-lo em disco leva
    // centenas de milissegundos: segurar uma transação aberta por todo esse
    // tempo prenderia a conexão e, num pico de emissões, esgotaria o pool.
    const { bytes, sha256Hash } = await createOfficialPdf({
      title: 'RECIBO DE DIÁRIA',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId: record.publicId,
      exporterName,
      sections,
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
        ? await detectBudgetOverrun(tx, record.qddItemId)
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

    const { bytes, sha256Hash } = await createOfficialPdf({
      title: 'PRESTAÇÃO DE CONTAS DE DIÁRIA (ANEXO II)',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId: accountabilityPublicId,
      exporterName,
      sections: [
        {
          heading: 'Servidor',
          fields: [
            { label: 'Nome', value: record.beneficiaryName },
            { label: 'Setor', value: formatDepartment(record.department) },
          ],
        },
        {
          heading: 'Diária prestada',
          fields: [
            { label: 'Documento de origem (Anexo I)', value: record.publicId },
            { label: 'Destino', value: record.destination },
            { label: 'Saída', value: formatDate(record.departureDate) },
            { label: 'Retorno', value: formatDate(record.returnDate) },
            { label: 'Valor total recebido', value: formatCurrency(record.totalAmount) },
          ],
        },
        {
          heading: 'Prestação de contas',
          fields: [
            { label: 'Data da prestação', value: formatDate(input.accountabilityDate) },
            { label: 'Relatório de atividades', value: input.activityReport },
          ],
        },
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
      details: { publicId: accountabilityPublicId, sha256Hash },
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

// ─── Apoio ────────────────────────────────────────────────────────────────────

/**
 * A dotação existe e pertence à MESMA organização?
 *
 * Sem esta conferência, um `qddItemId` copiado de outro tenant lastrearia a
 * despesa na dotação de outra prefeitura — a chave estrangeira aceitaria, porque
 * ela não sabe nada sobre organizações.
 */
async function assertQddItemBelongsToOrganization(qddItemId: string, organizationId: string) {
  const exists = await prisma.qddItem.findFirst({
    where: { id: qddItemId, organizationId },
    select: { id: true },
  })

  if (!exists) {
    throw new DailyAllowanceError(
      'INVALID_QDD_ITEM',
      'A dotação orçamentária informada não existe nesta organização.'
    )
  }
}

/**
 * O empenhado na ficha já passou do orçado?
 *
 * Soma apenas o que foi EMITIDO (ISSUED ou ACCOUNTED): rascunho não compromete
 * dotação, e contá-lo acusaria estouro por diárias que talvez nunca saiam.
 *
 * Toda a aritmética em Decimal, nunca em Number: uma diferença de centavo no
 * ponto flutuante decidiria errado se houve estouro — e é uma flag de auditoria.
 */
async function detectBudgetOverrun(
  tx: Prisma.TransactionClient,
  qddItemId: string
): Promise<boolean> {
  const [qddItem, committed] = await Promise.all([
    tx.qddItem.findUnique({ where: { id: qddItemId }, select: { valorOrcado: true } }),
    tx.dailyAllowance.aggregate({
      where: { qddItemId, status: { in: ['ISSUED', 'ACCOUNTED'] } },
      _sum: { totalAmount: true },
    }),
  ])

  if (!qddItem) return false

  const total = committed._sum.totalAmount ?? new Prisma.Decimal(0)
  return total.greaterThan(qddItem.valorOrcado)
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
