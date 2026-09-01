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
const QR_SIZE = 80

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
  /** Observação livre impressa acima do rodapé. */
  footNote?: string
  /**
   * Logo do tenant em PNG. Preparado para a Task 3.4; quando ausente, o
   * cabeçalho cai num marcador neutro em vez de quebrar.
   */
  logoPng?: Uint8Array | null
}

export interface OfficialPdfResult {
  bytes: Uint8Array
  /** SHA-256 dos bytes do PDF — é o que o Portal de Validação confere. */
  documentHash: string
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
      const logo = await pdf.embedPng(input.logoPng)
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

  // ── Rodapé com QR Code ──
  const validationUrl = buildValidationUrl(input.publicId)
  const qrPng = await renderQrCodePng(validationUrl)
  const qrImage = await pdf.embedPng(qrPng)

  const footerY = MARGIN + QR_SIZE

  page.drawLine({
    start: { x: MARGIN, y: footerY + 16 },
    end: { x: PAGE_WIDTH - MARGIN, y: footerY + 16 },
    thickness: 1,
    color: COLOR_RULE,
  })

  page.drawImage(qrImage, { x: MARGIN, y: MARGIN, width: QR_SIZE, height: QR_SIZE })

  const textX = MARGIN + QR_SIZE + 14
  const footerTextWidth = PAGE_WIDTH - MARGIN - textX
  let footerCursor = footerY - 4

  const footerLines = [
    { text: 'Confira a autenticidade deste documento', size: 9, bold: true },
    { text: 'Aponte a câmera para o QR Code ou acesse:', size: 8, bold: false },
    { text: validationUrl, size: 7.5, bold: false },
  ]

  for (const line of footerLines) {
    for (const wrapped of wrapText(line.text, line.bold ? bold : font, line.size, footerTextWidth)) {
      page.drawText(sanitizeForPdf(wrapped), {
        x: textX,
        y: footerCursor,
        size: line.size,
        font: line.bold ? bold : font,
        color: line.bold ? COLOR_TEXT : COLOR_MUTED,
      })
      footerCursor -= line.size + 4
    }
  }

  if (input.footNote) {
    for (const wrapped of wrapText(input.footNote, font, 7.5, footerTextWidth)) {
      page.drawText(sanitizeForPdf(wrapped), {
        x: textX,
        y: footerCursor,
        size: 7.5,
        font,
        color: COLOR_MUTED,
      })
      footerCursor -= 11
    }
  }

  const bytes = await pdf.save()

  return {
    bytes,
    documentHash: calculateDocumentHash(bytes),
    validationUrl,
  }
}
