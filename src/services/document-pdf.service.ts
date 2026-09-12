import { createHash } from 'node:crypto'
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { config } from '@/config/config.js'

/**
 * Primitivas de geração de documentos oficiais em PDF (Épico 3).
 *
 * Compartilhado pelas Tasks 3.1 (Recibo de Diária) e 3.2 (Relatório de
 * Abastecimento) para que cabeçalho, rodapé com QR Code e cálculo de hash
 * tenham UMA implementação só. A Task 3.4 (white-label) injeta a logo do tenant
 * em `logoPng` e passa a valer para todos os documentos de uma vez.
 *
 * O conteúdo textual é pt-BR de propósito: é o documento que o cidadão e o
 * Tribunal de Contas leem. O código em volta segue em inglês.
 */

// ─── Layout (pontos PostScript, A4 = 595 x 842) ───────────────────────────────

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 50
// QR discreto: o documento é o conteúdo, não o selo de validação.
const QR_SIZE = 50
const FOOTER_FONT_SIZE = 8
const FOOTER_LINE_HEIGHT = 10
/** Topo do rodapé — o conteúdo não deve invadir esta faixa. */
const FOOTER_TOP = MARGIN + QR_SIZE + 8

const COLOR_TEXT = rgb(0.1, 0.1, 0.12)
const COLOR_MUTED = rgb(0.45, 0.45, 0.5)
const COLOR_RULE = rgb(0.8, 0.8, 0.84)

// ─── Contratos ────────────────────────────────────────────────────────────────

export interface PdfField {
  label: string
  value: string
}

export interface PdfSection {
  heading?: string
  fields: PdfField[]
}

export interface OfficialPdfInput {
  /** Título do documento, ex: 'RECIBO DE DIÁRIA'. */
  title: string
  /** Nome da organização emissora, impresso no cabeçalho. */
  organizationName: string
  /** Identificador público — vira a URL do QR Code de validação. */
  publicId: string
  sections: PdfSection[]
  /** Observação livre impressa no rodapé. */
  footNote?: string
  /** Nome de quem emitiu, JÁ OFUSCADO. Impresso no rodapé quando presente. */
  exporterName?: string | null
  /**
   * Logo do tenant (Task 3.4). Aceita PNG e JPEG — os dois formatos que o
   * pdf-lib sabe embutir, e os dois em que uma prefeitura costuma ter a marca.
   * O nome do campo ficou como `logoPng` por já estar no contrato acordado.
   * Quando ausente, o cabeçalho cai num marcador neutro em vez de quebrar.
   */
  logoPng?: Uint8Array | null
}

export interface OfficialPdfResult {
  bytes: Uint8Array
  /** SHA-256 dos bytes do PDF — é o que o Portal de Validação confere. */
  sha256Hash: string
  validationUrl: string
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/** URL pública de validação, apontando para a página do frontend. */
export function buildValidationUrl(publicId: string): string {
  const base = config.urls.frontend.replace(/\/$/, '')
  return `${base}/validar-documento/${publicId}`
}

/** SHA-256 em hexadecimal dos bytes do documento. */
export function calculateDocumentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Remove caracteres que as fontes padrão do PDF não conseguem codificar.
 *
 * As StandardFonts do pdf-lib usam WinAnsi, que cobre o português (ç, ã, é) mas
 * NÃO cobre emoji nem símbolos exóticos. Sem esta limpeza, um servidor que
 * digitasse um emoji no campo "motivo" derrubaria a emissão inteira com
 * "WinAnsi cannot encode" — uma falha de dado do usuário virando erro 500.
 */
export function sanitizeForPdf(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”€]/g, '')
    .trim()
}

/** Gera o QR Code da URL de validação como PNG. */
export async function renderQrCodePng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  })
}

/** Assinatura JPEG (FF D8 FF). PNG começa com 89 50 4E 47. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

// ─── Desenho ──────────────────────────────────────────────────────────────────

interface DrawContext {
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
}

function drawText(ctx: DrawContext, text: string, size: number, bold = false, color = COLOR_TEXT) {
  ctx.page.drawText(sanitizeForPdf(text), {
    x: MARGIN,
    y: ctx.y,
    size,
    font: bold ? ctx.bold : ctx.font,
    color,
  })
}

/**
 * Quebra o texto em linhas que caibam na largura útil.
 *
 * O campo "motivo" é texto livre e costuma ser longo; sem quebra, o pdf-lib
 * escreveria uma linha só, saindo da página e sumindo do documento impresso.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizeForPdf(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  return lines.length > 0 ? lines : ['-']
}

/**
 * Monta um documento oficial padronizado e devolve bytes + hash.
 *
 * O hash é calculado sobre os bytes finais: é exatamente o arquivo que será
 * entregue ao cidadão que o Portal de Validação vai conferir.
 */
export async function createOfficialPdf(input: OfficialPdfInput): Promise<OfficialPdfResult> {
  const pdf = await PDFDocument.create()

  // Metadados fixos: o pdf-lib carimbaria data/hora de criação, o que tornaria
  // dois PDFs do mesmo conteúdo diferentes byte a byte.
  pdf.setTitle(sanitizeForPdf(input.title))
  pdf.setProducer('SIMP')
  pdf.setCreator('SIMP')

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const contentWidth = PAGE_WIDTH - MARGIN * 2

  const ctx: DrawContext = { page, font, bold, y: PAGE_HEIGHT - MARGIN }

  // ── Cabeçalho ──
  if (input.logoPng) {
    try {
      // O formato vem dos BYTES, não do que alguém declarou no upload: chamar
      // embedPng num JPEG lança, e a logo sumiria do documento em silêncio.
      const logo = isJpeg(input.logoPng)
        ? await pdf.embedJpg(input.logoPng)
        : await pdf.embedPng(input.logoPng)
      const scaled = logo.scaleToFit(120, 48)
      page.drawImage(logo, {
        x: MARGIN,
        y: ctx.y - scaled.height + 10,
        width: scaled.width,
        height: scaled.height,
      })
      ctx.y -= scaled.height + 6
    } catch {
      // Logo corrompida ou em formato inesperado não pode impedir a emissão de
      // um documento oficial — segue sem ela.
      ctx.y -= 6
    }
  }

  drawText(ctx, input.organizationName, 13, true)
  ctx.y -= 16
  drawText(ctx, 'Documento oficial', 9, false, COLOR_MUTED)
  ctx.y -= 22

  page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
    thickness: 1,
    color: COLOR_RULE,
  })
  ctx.y -= 28

  drawText(ctx, input.title, 16, true)
  ctx.y -= 30

  // ── Corpo ──
  for (const section of input.sections) {
    if (section.heading) {
      drawText(ctx, section.heading, 11, true)
      ctx.y -= 18
    }

    for (const field of section.fields) {
      drawText(ctx, field.label.toUpperCase(), 7.5, true, COLOR_MUTED)
      ctx.y -= 12

      for (const line of wrapText(field.value, font, 10.5, contentWidth)) {
        drawText(ctx, line, 10.5)
        ctx.y -= 14
      }
      ctx.y -= 6
    }
    ctx.y -= 8
  }

  // ── Rodapé universal de validação ──
  const validationUrl = await applyUniversalValidationFooter(pdf, {
    publicId: input.publicId,
    exporterName: input.exporterName,
    note: input.footNote,
  })

  const bytes = await pdf.save()

  return {
    bytes,
    sha256Hash: calculateDocumentHash(bytes),
    validationUrl,
  }
}

// ─── Rodapé universal ─────────────────────────────────────────────────────────

export interface UniversalFooterInput {
  /** Identificador público do documento — é o que vai dentro do QR Code. */
  publicId: string
  /**
   * Nome de quem emitiu, JÁ OFUSCADO (ver utils/lgpd-anonymizer.util.ts).
   *
   * O rodapé é impresso num documento que pode ir ao portal da transparência,
   * então o nome completo não entra aqui.
   */
  exporterName?: string | null
  /** Momento da emissão. Default: agora. */
  issuedAt?: Date
  /**
   * Hash a IMPRIMIR no rodapé.
   *
   * ATENÇÃO — NÃO é o hash de validação e normalmente deve ficar vazio. O hash
   * que o Portal confere é o SHA-256 dos bytes FINAIS do PDF, e esse número não
   * pode ser impresso dentro do próprio arquivo: imprimi-lo alteraria os bytes e
   * portanto o próprio hash. É circular por natureza.
   *
   * Use este campo apenas quando existir um hash de conteúdo EXTERNO que faça
   * sentido mostrar (por exemplo, o hash de um arquivo anexado que o PDF apenas
   * referencia).
   */
  printedHash?: string | null
  /** Observação livre, impressa na última linha. */
  note?: string | null
}

/**
 * Estampa o rodapé de validação em TODAS as páginas e devolve a URL pública.
 *
 * PONTO DE ENTRADA ÚNICO da validação universal: qualquer serviço que gere PDF
 * chama esta função e ganha QR Code, identificador e autoria sem reimplementar
 * layout nenhum.
 *
 * EM TODAS AS PÁGINAS, e não só na última: uma folha solta de um relatório de
 * vinte páginas continua circulando como documento. Sem o rodapé nela, essa
 * folha seria impossível de rastrear — e é justamente a folha avulsa que chega
 * à mão do fiscal.
 *
 * O QR é pequeno (50x50) e discreto de propósito: o documento é o conteúdo, não
 * o selo de validação.
 */
export async function applyUniversalValidationFooter(
  pdf: PDFDocument,
  input: UniversalFooterInput
): Promise<string> {
  const validationUrl = buildValidationUrl(input.publicId)
  const qrImage = await pdf.embedPng(await renderQrCodePng(validationUrl))

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const issuedAt = input.issuedAt ?? new Date()
  const pages = pdf.getPages()

  pages.forEach((page, index) => {
    const { width } = page.getSize()
    const textX = MARGIN + QR_SIZE + 10
    const textWidth = width - MARGIN - textX

    // Linha separando o conteúdo do rodapé.
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_TOP },
      end: { x: width - MARGIN, y: FOOTER_TOP },
      thickness: 0.5,
      color: COLOR_RULE,
    })

    page.drawImage(qrImage, { x: MARGIN, y: MARGIN, width: QR_SIZE, height: QR_SIZE })

    let cursor = FOOTER_TOP - 12

    page.drawText(sanitizeForPdf('Confira a autenticidade deste documento'), {
      x: textX,
      y: cursor,
      size: FOOTER_FONT_SIZE,
      font: bold,
      color: COLOR_TEXT,
    })
    cursor -= FOOTER_LINE_HEIGHT

    const lines: string[] = [validationUrl]

    if (input.exporterName) {
      lines.push(`Emitido por: ${input.exporterName} em ${formatIssuedAt(issuedAt)}`)
    }
    if (input.printedHash) {
      lines.push(`Código de integridade: ${input.printedHash}`)
    }
    if (input.note) {
      lines.push(input.note)
    }

    for (const line of lines) {
      for (const wrapped of wrapText(line, font, FOOTER_FONT_SIZE, textWidth)) {
        page.drawText(sanitizeForPdf(wrapped), {
          x: textX,
          y: cursor,
          size: FOOTER_FONT_SIZE,
          font,
          color: COLOR_MUTED,
        })
        cursor -= FOOTER_LINE_HEIGHT
      }
    }

    // Numeração à direita: um relatório de várias páginas precisa dela para que
    // se perceba uma folha faltando.
    if (pages.length > 1) {
      const label = `Página ${index + 1} de ${pages.length}`
      page.drawText(label, {
        x: width - MARGIN - font.widthOfTextAtSize(label, FOOTER_FONT_SIZE),
        y: FOOTER_TOP - 12,
        size: FOOTER_FONT_SIZE,
        font,
        color: COLOR_MUTED,
      })
    }
  })

  return validationUrl
}

/** Data e hora no formato lido no documento (pt-BR). */
function formatIssuedAt(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}

// ─── Relatórios tabulares ─────────────────────────────────────────────────────

export interface ReportColumn {
  header: string
  /** Largura da coluna em pontos. A soma deve caber na largura útil da página. */
  width: number
  align?: 'left' | 'right'
}

export interface ReportSignature {
  name: string
  role: string
}

export interface TabularReportInput {
  title: string
  organizationName: string
  publicId: string
  /** Nome de quem exportou, JÁ OFUSCADO. Vai para o rodapé. */
  exporterName?: string | null
  /** Linhas de contexto sob o título: período coberto, filtros aplicados. */
  subtitles?: string[]
  columns: ReportColumn[]
  rows: string[][]
  /** Bloco de resumo ao final (totais, contagens). */
  summary?: PdfField[]
  /**
   * Linhas de assinatura ao final do documento.
   *
   * Os nomes aqui NÃO são ofuscados, e isso é deliberado: quem assina um
   * documento oficial o faz publicamente, no exercício do cargo. A ofuscação da
   * LGPD se aplica ao metadado de QUEM EXPORTOU o arquivo, não aos signatários
   * do ato.
   */
  signatures?: ReportSignature[]
  logoPng?: Uint8Array | null
  /** Texto exibido quando não há nenhuma linha. */
  emptyMessage?: string
}

const ROW_HEIGHT = 16
const TABLE_FONT_SIZE = 8.5
const HEADER_FONT_SIZE = 8
const COLOR_TABLE_HEADER_BG = rgb(0.94, 0.95, 0.97)
const COLOR_ROW_ALT = rgb(0.985, 0.988, 0.992)

/**
 * Relatório tabular paginado com rodapé universal de validação.
 *
 * Segundo ponto de entrada do motor de PDFs, ao lado de `createOfficialPdf`:
 * aquele monta documento de UM registro (recibo, comprovante), este monta LISTA
 * de registros (relatórios, calendários). Os dois compartilham cabeçalho, rodapé
 * e cálculo de hash, então o comportamento de validação é idêntico nos dois.
 *
 * A paginação repete o cabeçalho da tabela em cada página — uma folha solta sem
 * cabeçalho é uma tabela de números sem significado.
 */
export async function createTabularReportPdf(
  input: TabularReportInput
): Promise<OfficialPdfResult> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(sanitizeForPdf(input.title))
  pdf.setProducer('SIMP')
  pdf.setCreator('SIMP')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const logo = await embedLogoSafely(pdf, input.logoPng)

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let cursor = await drawReportHeader(page, { input, font, bold, logo, isFirstPage: true })

  cursor = drawTableHeader(page, input.columns, cursor, bold)

  if (input.rows.length === 0) {
    page.drawText(sanitizeForPdf(input.emptyMessage ?? 'Nenhum registro no período.'), {
      x: MARGIN,
      y: cursor - 6,
      size: 10,
      font,
      color: COLOR_MUTED,
    })
    cursor -= 24
  }

  for (const [index, row] of input.rows.entries()) {
    // Quebra de página quando a próxima linha invadiria a faixa do rodapé.
    if (cursor - ROW_HEIGHT < FOOTER_TOP + 12) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      cursor = await drawReportHeader(page, { input, font, bold, logo, isFirstPage: false })
      cursor = drawTableHeader(page, input.columns, cursor, bold)
    }

    // Zebra discreta: numa tabela larga, ela evita que o olho troque de linha.
    if (index % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: cursor - ROW_HEIGHT + 4,
        width: PAGE_WIDTH - MARGIN * 2,
        height: ROW_HEIGHT,
        color: COLOR_ROW_ALT,
      })
    }

    drawTableRow(page, input.columns, row, cursor, font)
    cursor -= ROW_HEIGHT
  }

  // ── Resumo ──
  if (input.summary?.length) {
    if (cursor - 60 < FOOTER_TOP + 12) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      cursor = await drawReportHeader(page, { input, font, bold, logo, isFirstPage: false })
    }

    cursor -= 14
    page.drawLine({
      start: { x: MARGIN, y: cursor },
      end: { x: PAGE_WIDTH - MARGIN, y: cursor },
      thickness: 0.5,
      color: COLOR_RULE,
    })
    cursor -= 18

    for (const field of input.summary) {
      page.drawText(sanitizeForPdf(`${field.label}: `), {
        x: MARGIN,
        y: cursor,
        size: 9.5,
        font: bold,
        color: COLOR_TEXT,
      })
      const labelWidth = bold.widthOfTextAtSize(sanitizeForPdf(`${field.label}: `), 9.5)
      page.drawText(sanitizeForPdf(field.value), {
        x: MARGIN + labelWidth,
        y: cursor,
        size: 9.5,
        font,
        color: COLOR_TEXT,
      })
      cursor -= 14
    }
  }

  // ── Assinaturas ──
  if (input.signatures?.length) {
    const SIGNATURE_BLOCK_HEIGHT = 52
    cursor -= 24

    for (const signature of input.signatures) {
      // Quebra de página quando o bloco inteiro não couber: uma linha de
      // assinatura separada do nome que a identifica não serve para nada.
      if (cursor - SIGNATURE_BLOCK_HEIGHT < FOOTER_TOP + 12) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        cursor = await drawReportHeader(page, { input, font, bold, logo, isFirstPage: false })
        cursor -= 12
      }

      const centerX = PAGE_WIDTH / 2
      const lineHalfWidth = 130

      page.drawLine({
        start: { x: centerX - lineHalfWidth, y: cursor },
        end: { x: centerX + lineHalfWidth, y: cursor },
        thickness: 0.7,
        color: COLOR_TEXT,
      })
      cursor -= 13

      const name = sanitizeForPdf(signature.name)
      page.drawText(name, {
        x: centerX - bold.widthOfTextAtSize(name, 10) / 2,
        y: cursor,
        size: 10,
        font: bold,
        color: COLOR_TEXT,
      })
      cursor -= 12

      const role = sanitizeForPdf(signature.role)
      page.drawText(role, {
        x: centerX - font.widthOfTextAtSize(role, 9) / 2,
        y: cursor,
        size: 9,
        font,
        color: COLOR_MUTED,
      })
      cursor -= 27
    }
  }

  const validationUrl = await applyUniversalValidationFooter(pdf, {
    publicId: input.publicId,
    exporterName: input.exporterName,
  })

  const bytes = await pdf.save()

  return { bytes, sha256Hash: calculateDocumentHash(bytes), validationUrl }
}

/** Embute a logo tolerando arquivo inválido — nunca impede a emissão. */
async function embedLogoSafely(pdf: PDFDocument, logoPng?: Uint8Array | null) {
  if (!logoPng) return null
  try {
    return isJpeg(logoPng) ? await pdf.embedJpg(logoPng) : await pdf.embedPng(logoPng)
  } catch {
    return null
  }
}

interface HeaderContext {
  input: TabularReportInput
  font: PDFFont
  bold: PDFFont
  logo: Awaited<ReturnType<typeof embedLogoSafely>>
  isFirstPage: boolean
}

/** Desenha o cabeçalho e devolve a posição vertical onde o conteúdo começa. */
async function drawReportHeader(
  page: PDFPage,
  { input, font, bold, logo, isFirstPage }: HeaderContext
): Promise<number> {
  let y = PAGE_HEIGHT - MARGIN

  if (logo) {
    const scaled = logo.scaleToFit(110, 40)
    page.drawImage(logo, {
      x: MARGIN,
      y: y - scaled.height + 8,
      width: scaled.width,
      height: scaled.height,
    })
    y -= scaled.height + 4
  }

  page.drawText(sanitizeForPdf(input.organizationName), {
    x: MARGIN,
    y,
    size: 12,
    font: bold,
    color: COLOR_TEXT,
  })
  y -= 20

  page.drawText(sanitizeForPdf(input.title), {
    x: MARGIN,
    y,
    size: 15,
    font: bold,
    color: COLOR_TEXT,
  })
  y -= 18

  // O contexto (período, filtros) só na primeira página: repeti-lo em todas
  // roubaria espaço útil da tabela sem acrescentar informação.
  if (isFirstPage && input.subtitles?.length) {
    for (const subtitle of input.subtitles) {
      page.drawText(sanitizeForPdf(subtitle), {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: COLOR_MUTED,
      })
      y -= 13
    }
  }

  y -= 8
  return y
}

/** Faixa com os nomes das colunas. Repetida em toda página. */
function drawTableHeader(
  page: PDFPage,
  columns: ReportColumn[],
  y: number,
  bold: PDFFont
): number {
  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_HEIGHT + 4,
    width: PAGE_WIDTH - MARGIN * 2,
    height: ROW_HEIGHT,
    color: COLOR_TABLE_HEADER_BG,
  })

  let x = MARGIN + 4
  for (const column of columns) {
    page.drawText(sanitizeForPdf(column.header.toUpperCase()), {
      x,
      y: y - ROW_HEIGHT + 9,
      size: HEADER_FONT_SIZE,
      font: bold,
      color: COLOR_TEXT,
    })
    x += column.width
  }

  return y - ROW_HEIGHT - 4
}

/** Uma linha de dados, truncando o que não couber na coluna. */
function drawTableRow(
  page: PDFPage,
  columns: ReportColumn[],
  row: string[],
  y: number,
  font: PDFFont
): void {
  let x = MARGIN + 4

  for (const [index, column] of columns.entries()) {
    const raw = sanitizeForPdf(row[index] ?? '')
    const text = truncateToWidth(raw, font, TABLE_FONT_SIZE, column.width - 8)

    const offset =
      column.align === 'right'
        ? column.width - 8 - font.widthOfTextAtSize(text, TABLE_FONT_SIZE)
        : 0

    page.drawText(text, {
      x: x + offset,
      y: y - ROW_HEIGHT + 9,
      size: TABLE_FONT_SIZE,
      font,
      color: COLOR_TEXT,
    })
    x += column.width
  }
}

/**
 * Corta o texto para caber na largura, terminando em reticências.
 *
 * Numa tabela, deixar o texto transbordar sobrepõe a coluna vizinha e torna as
 * duas ilegíveis — truncar é a perda menor.
 */
function truncateToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text

  let result = text
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}...`
}
