import archiver from 'archiver'
import ExcelJS from 'exceljs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import {
  calculateDocumentHash,
  createOfficialPdf,
  createTabularReportPdf,
} from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'
import {
  type ReportDailyAllowanceFilter,
  type RequestScope,
  dailyAllowanceService,
  formatDepartment,
} from '@/services/daily-allowance.service.js'

/**
 * Relatórios globais de diárias (Épico 4, Fase 5).
 *
 * Dois formatos, UMA fonte de dados: os dois consomem
 * `dailyAllowanceService.findForReport`, de modo que a planilha e o PDF nunca
 * possam divergir sobre quais diárias foram emitidas no período.
 *
 * O PDF sai pelo motor universal e é validável sozinho. A planilha não comporta
 * QR Code nem rodapé, então viaja dentro de um ZIP ao lado de um PDF-Manifesto
 * que carrega o SHA-256 dela — quem recebe o pacote confere o manifesto no
 * Portal e, por ele, a integridade do .xlsx.
 */

export interface ReportResult {
  bytes: Uint8Array
  publicId: string
  sha256Hash: string
}

export interface ExcelPackageResult {
  /** Bytes do ZIP: planilha + manifesto. */
  bytes: Buffer
  /** Identificador público DO MANIFESTO — é o que o Portal valida. */
  publicId: string
  /** SHA-256 da PLANILHA, o que o manifesto atesta. */
  spreadsheetHash: string
}

// ─── Apresentação (conteúdo em pt-BR) ─────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Rascunho',
  ISSUED: 'Emitida',
  ACCOUNTED: 'Contas prestadas',
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

function formatCurrency(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

/**
 * Descreve, em pt-BR, os filtros aplicados.
 *
 * Impresso no cabeçalho de propósito: um relatório de diárias sem dizer que
 * filtrou por um setor parece a lista completa do município, e é assim que um
 * recorte parcial acaba anexado a um processo como se fosse o todo.
 *
 * O CPF aparece como "informado", nunca o número: o relatório pode ser
 * publicado, e imprimir o CPF pesquisado vazaria justamente o dado que o filtro
 * existe para não expor.
 */
function buildSubtitles(filter: ReportDailyAllowanceFilter, departmentLabel?: string): string[] {
  const lines: string[] = []

  if (filter.startDate && filter.endDate) {
    lines.push(`Período de saída: ${formatDate(filter.startDate)} a ${formatDate(filter.endDate)}`)
  } else if (filter.startDate) {
    lines.push(`Saídas a partir de: ${formatDate(filter.startDate)}`)
  } else if (filter.endDate) {
    lines.push(`Saídas até: ${formatDate(filter.endDate)}`)
  }

  if (departmentLabel) lines.push(`Setor: ${departmentLabel}`)
  if (filter.status) lines.push(`Situação: ${STATUS_LABELS[filter.status] ?? filter.status}`)
  if (filter.beneficiaryName) lines.push(`Servidor: "${filter.beneficiaryName}"`)
  if (filter.cpf) lines.push('CPF: filtro informado (número omitido por proteção de dados)')
  if (filter.destination) lines.push(`Destino: "${filter.destination}"`)
  if (filter.search) lines.push(`Busca: "${filter.search}"`)

  if (lines.length === 0) lines.push('Todos os registros')

  return lines
}

/** Nome do setor filtrado, para o cabeçalho. Silencioso quando não achar. */
async function resolveDepartmentLabel(
  departmentId: string | undefined,
  organizationId: string
): Promise<string | undefined> {
  if (!departmentId) return undefined

  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
    select: { name: true, code: true },
  })

  return department ? formatDepartment(department) : undefined
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const dailyAllowanceReportService = {
  /** Relatório tabular em PDF, validável pelo QR Code do rodapé universal. */
  async generatePdf(
    filter: ReportDailyAllowanceFilter,
    scope: RequestScope
  ): Promise<ReportResult> {
    const [records, organization, exporter, logoPng, departmentLabel] = await Promise.all([
      dailyAllowanceService.findForReport(filter, scope),
      prisma.organization.findUnique({
        where: { id: scope.organizationId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: scope.userId },
        select: { firstName: true, lastName: true },
      }),
      organizationBrandingService.getLogoBytes(scope.organizationId),
      resolveDepartmentLabel(filter.departmentId, scope.organizationId),
    ])

    // O identificador precisa existir ANTES de montar o PDF: é ele que vai
    // dentro do QR Code do rodapé.
    const publicId = exportedDocumentService.newPublicId()

    const totalAmount = records.reduce(
      (sum, record) => sum.plus(record.totalAmount),
      new Prisma.Decimal(0)
    )
    const lateCount = records.filter(record => record.isLate).length
    const overrunCount = records.filter(record => record.budgetOverrun).length

    const { bytes, sha256Hash } = await createTabularReportPdf({
      title: 'RELATÓRIO DE DIÁRIAS',
      organizationName: organization?.name ?? 'Organização',
      publicId,
      logoPng,
      exporterName: anonymizeUserName(exporter?.firstName, exporter?.lastName),
      subtitles: buildSubtitles(filter, departmentLabel),
      // A soma das larguras cabe na área útil da página (495 pt).
      columns: [
        { header: 'Saída', width: 52 },
        { header: 'Servidor', width: 128 },
        { header: 'Setor', width: 88 },
        { header: 'Destino', width: 95 },
        { header: 'Situação', width: 62 },
        { header: 'Valor', width: 70, align: 'right' },
      ],
      rows: records.map(record => [
        formatDate(record.departureDate),
        record.beneficiaryName,
        formatDepartment(record.department),
        record.destination,
        // O alerta viaja junto da situação: uma linha em atraso ou com dotação
        // estourada precisa saltar aos olhos de quem lê a folha impressa.
        [
          STATUS_LABELS[record.status] ?? record.status,
          record.isLate ? '(em atraso)' : '',
          record.budgetOverrun ? '(estouro)' : '',
        ]
          .filter(Boolean)
          .join(' '),
        formatCurrency(record.totalAmount),
      ]),
      summary: [
        { label: 'Diárias no relatório', value: String(records.length) },
        { label: 'Valor total', value: formatCurrency(totalAmount) },
        { label: 'Prestações de contas em atraso', value: String(lateCount) },
        { label: 'Emissões com estouro de dotação', value: String(overrunCount) },
      ],
      emptyMessage: 'Nenhuma diária encontrada para os filtros aplicados.',
    })

    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.REPORT_DAILY_ALLOWANCES,
      publicId,
      bytes,
      exporterFullName: [exporter?.firstName, exporter?.lastName].filter(Boolean).join(' '),
    })

    return { bytes, publicId, sha256Hash }
  },

  /**
   * Pacote ZIP: planilha limpa + PDF-Manifesto que atesta o hash dela.
   *
   * ORDEM OBRIGATÓRIA — a planilha primeiro, sempre: o manifesto IMPRIME o
   * SHA-256 do .xlsx, então a planilha precisa estar pronta e fechada antes de
   * o PDF existir. Inverter geraria um manifesto atestando bytes que ainda não
   * foram escritos.
   */
  async generateExcelPackage(
    filter: ReportDailyAllowanceFilter,
    scope: RequestScope
  ): Promise<ExcelPackageResult> {
    const [records, organization, exporter, logoPng, departmentLabel] = await Promise.all([
      dailyAllowanceService.findForReport(filter, scope),
      prisma.organization.findUnique({
        where: { id: scope.organizationId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: scope.userId },
        select: { firstName: true, lastName: true },
      }),
      organizationBrandingService.getLogoBytes(scope.organizationId),
      resolveDepartmentLabel(filter.departmentId, scope.organizationId),
    ])

    // ── 1. Planilha ──
    const spreadsheet = await buildSpreadsheet(records, organization?.name ?? 'Organização')
    const spreadsheetHash = calculateDocumentHash(spreadsheet)

    // ── 2. Manifesto ──
    const publicId = exportedDocumentService.newPublicId()

    const { bytes: manifestBytes } = await createOfficialPdf({
      title: 'MANIFESTO DE INTEGRIDADE DE PLANILHA',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId,
      exporterName: anonymizeUserName(exporter?.firstName, exporter?.lastName),
      sections: [
        {
          heading: 'Arquivo atestado',
          fields: [
            { label: 'Nome do arquivo', value: SPREADSHEET_FILENAME },
            { label: 'Formato', value: 'Planilha Excel (.xlsx)' },
            { label: 'Registros exportados', value: String(records.length) },
            { label: 'Algoritmo de integridade', value: 'SHA-256' },
            { label: 'Código de integridade (SHA-256)', value: spreadsheetHash },
          ],
        },
        {
          heading: 'Recorte exportado',
          fields: buildSubtitles(filter, departmentLabel).map((line, index) => ({
            label: `Filtro ${index + 1}`,
            value: line,
          })),
        },
        {
          heading: 'Como conferir',
          fields: [
            {
              label: 'Procedimento',
              value:
                'Calcule o SHA-256 do arquivo da planilha e compare com o código ' +
                'acima. Sendo idênticos, a planilha é exatamente a que foi exportada ' +
                'deste sistema. Leia o QR Code do rodapé para confirmar, no Portal ' +
                'de Validação, que este manifesto também não foi adulterado.',
            },
          ],
        },
      ],
      // `printedHash` é para hash de conteúdo EXTERNO — exatamente este caso. O
      // hash do próprio PDF não pode ser impresso dentro dele (imprimi-lo
      // mudaria os bytes e, com eles, o hash): esse fica no registro, alcançável
      // pelo QR Code.
      printedHash: spreadsheetHash,
    })

    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE_XLS_MANIFEST,
      publicId,
      bytes: manifestBytes,
      exporterFullName: [exporter?.firstName, exporter?.lastName].filter(Boolean).join(' '),
    })

    // ── 3. Pacote ──
    const bytes = await buildZip([
      { name: SPREADSHEET_FILENAME, content: Buffer.from(spreadsheet) },
      { name: `manifesto-${publicId}.pdf`, content: Buffer.from(manifestBytes) },
    ])

    return { bytes, publicId, spreadsheetHash }
  },
}

// ─── Planilha ─────────────────────────────────────────────────────────────────

const SPREADSHEET_FILENAME = 'diarias.xlsx'

type ReportRecord = Awaited<ReturnType<typeof dailyAllowanceService.findForReport>>[number]

/**
 * Planilha LIMPA: só os dados, sem selo nem rodapé.
 *
 * A integridade é responsabilidade do manifesto que viaja junto. Tentar carimbar
 * o hash dentro da própria planilha recriaria a circularidade que o manifesto
 * existe para resolver — e ainda quebraria o "Ctrl+A, soma" de quem só quer
 * conferir a coluna de valores.
 *
 * Valores e datas saem como número e data de verdade, não como texto: o
 * conferente precisa somar a coluna sem antes converter célula por célula.
 */
async function buildSpreadsheet(
  records: ReportRecord[],
  organizationName: string
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SIMP'

  // Sem `created`/`modified` variáveis: o ExcelJS carimbaria o instante da
  // geração e duas exportações do mesmo recorte teriam hashes diferentes, o que
  // faria o manifesto parecer instável sem que nenhum dado tivesse mudado.
  const epoch = new Date(0)
  workbook.created = epoch
  workbook.modified = epoch

  const sheet = workbook.addWorksheet('Diárias')

  sheet.columns = [
    { header: 'Saída', key: 'departureDate', width: 12 },
    { header: 'Retorno', key: 'returnDate', width: 12 },
    { header: 'Servidor', key: 'beneficiaryName', width: 34 },
    { header: 'Setor', key: 'department', width: 28 },
    { header: 'Destino', key: 'destination', width: 28 },
    { header: 'Motivo', key: 'purpose', width: 40 },
    { header: 'Ficha (QDD)', key: 'ficha', width: 12 },
    { header: 'Fonte', key: 'fonte', width: 12 },
    { header: 'Natureza da despesa', key: 'natureza', width: 22 },
    { header: 'Valor unitário', key: 'dailyRate', width: 14 },
    { header: 'Qtd. diárias', key: 'dayCount', width: 12 },
    { header: 'Valor total', key: 'totalAmount', width: 14 },
    { header: 'Situação', key: 'status', width: 18 },
    { header: 'Estouro de dotação', key: 'budgetOverrun', width: 18 },
    { header: 'Prestação em atraso', key: 'isLate', width: 18 },
    { header: 'Data da prestação', key: 'accountabilityDate', width: 16 },
    { header: 'Código de verificação', key: 'publicId', width: 38 },
  ]

  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const record of records) {
    sheet.addRow({
      departureDate: record.departureDate,
      returnDate: record.returnDate,
      beneficiaryName: record.beneficiaryName,
      department: formatDepartment(record.department),
      destination: record.destination,
      purpose: record.purpose,
      // Snapshot primeiro: é o que valia no documento emitido. O cadastro atual
      // só responde por rascunhos, que ainda não carimbaram nada.
      ficha: record.qddFichaSnapshot ?? record.qddItem?.ficha ?? '',
      fonte: record.qddFonteSnapshot ?? record.qddItem?.fonte ?? '',
      natureza: record.qddNaturezaSnapshot ?? record.qddItem?.naturezaDespesa ?? '',
      dailyRate: Number(record.dailyRate),
      dayCount: Number(record.dayCount),
      totalAmount: Number(record.totalAmount),
      status: STATUS_LABELS[record.status] ?? record.status,
      budgetOverrun: record.budgetOverrun ? 'Sim' : 'Não',
      isLate: record.isLate ? 'Sim' : 'Não',
      accountabilityDate: record.accountabilityDate ?? '',
      publicId: record.publicId,
    })
  }

  const currencyFormat = 'R$ #,##0.00'
  sheet.getColumn('dailyRate').numFmt = currencyFormat
  sheet.getColumn('totalAmount').numFmt = currencyFormat
  for (const key of ['departureDate', 'returnDate', 'accountabilityDate']) {
    sheet.getColumn(key).numFmt = 'dd/mm/yyyy'
  }

  // Rodapé de impressão: a planilha impressa também precisa dizer de onde veio.
  sheet.headerFooter.oddFooter = `&L${organizationName}&RPágina &P de &N`

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

// ─── Empacotamento ────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string
  content: Buffer
}

/**
 * Monta o ZIP em memória, SEM compressão (`store`).
 *
 * Deliberado: o manifesto atesta o SHA-256 da planilha, e guardar os bytes
 * literais elimina qualquer dúvida sobre o que o descompactador devolve. Um
 * relatório de diárias tem poucas centenas de KB — o que se perde em tamanho
 * não se compara à clareza de "o arquivo dentro do pacote é byte a byte o
 * arquivo que foi assinado".
 */
function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { store: true })
    const chunks: Buffer[] = []

    archive.on('data', chunk => chunks.push(chunk))
    archive.on('warning', reject)
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))

    for (const entry of entries) {
      // `date` fixa pelo mesmo motivo dos metadados da planilha: sem ela, o ZIP
      // do mesmo conteúdo teria bytes diferentes a cada exportação.
      archive.append(entry.content, { name: entry.name, date: new Date(0) })
    }

    void archive.finalize()
  })
}
