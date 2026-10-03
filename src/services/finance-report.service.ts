/**
 * Finance Report Service
 *
 * Gera o Relatório de Lançamentos Financeiros como um PDF oficial:
 * backend-side, com QR code de validação, hash SHA-256 e registro no
 * ExportedDocument — idêntico ao fluxo de Diárias, Abastecimento e
 * Calendário de Conselhos.
 *
 * O relatório é gerado on-demand e devolvido diretamente ao cliente (sem
 * salvar em storage) — assim como o Relatório de Protocolos.
 */

import { prisma } from '@/lib/prisma.js'
import { createTabularReportPdf } from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FinanceReportFilter {
  type?: 'INCOME' | 'EXPENSE'
  search?: string
  categoryNames?: string[]
  startDate?: Date
  endDate?: Date
}

export interface FinanceReportResult {
  bytes: Uint8Array
  publicId: string
  sha256Hash: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

/** Monta as linhas de subtítulo descrevendo os filtros aplicados. */
function buildSubtitles(filter: FinanceReportFilter): string[] {
  const lines: string[] = []

  if (filter.startDate && filter.endDate) {
    lines.push(`Período: ${formatDate(filter.startDate)} a ${formatDate(filter.endDate)}`)
  } else if (filter.startDate) {
    lines.push(`A partir de: ${formatDate(filter.startDate)}`)
  } else if (filter.endDate) {
    lines.push(`Até: ${formatDate(filter.endDate)}`)
  }

  if (filter.type === 'INCOME') lines.push('Tipo: Somente Receitas')
  else if (filter.type === 'EXPENSE') lines.push('Tipo: Somente Despesas')

  if (filter.categoryNames?.length) {
    lines.push(`Categorias: ${filter.categoryNames.join(', ')}`)
  }

  if (filter.search) {
    lines.push(`Busca: "${filter.search}"`)
  }

  if (lines.length === 0) lines.push('Todos os registros')

  return lines
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const financeReportService = {
  async generate(
    filter: FinanceReportFilter,
    organizationId: string,
    userId: string,
  ): Promise<FinanceReportResult> {
    // ── 1. Busca os lançamentos aplicando os mesmos filtros da listagem ──────

    const where = {
      organizationId,
      deletedAt: null,
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.startDate || filter.endDate
        ? {
            occurredAt: {
              ...(filter.startDate ? { gte: filter.startDate } : {}),
              ...(filter.endDate ? { lte: filter.endDate } : {}),
            },
          }
        : {}),
      ...(filter.categoryNames?.length
        ? { category: { name: { in: filter.categoryNames } } }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { description: { contains: filter.search, mode: 'insensitive' as const } },
              { category: { name: { contains: filter.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    }

    const entries = await prisma.financeEntry.findMany({
      where,
      include: { category: true },
      orderBy: { occurredAt: 'desc' },
    })

    // ── 2. Calcula totalizadores ─────────────────────────────────────────────

    let totalIncome = 0
    let totalExpense = 0
    for (const e of entries) {
      if (e.type === 'INCOME') totalIncome += e.amountCents
      else totalExpense += e.amountCents
    }
    const balance = totalIncome - totalExpense

    // ── 3. Dados da organização e do emissor ─────────────────────────────────

    const [org, user, logoPng] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      }),
      organizationBrandingService.getLogoBytes(organizationId),
    ])

    const exporterFullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null

    // ── 4. Gera o publicId (deve existir antes dos bytes — vai no QR code) ───

    const publicId = exportedDocumentService.newPublicId()

    // ── 5. Monta as linhas da tabela ─────────────────────────────────────────

    const rows: string[][] = entries.map(e => [
      formatDate(e.occurredAt),
      e.description,
      e.category?.name ?? 'Geral',
      e.type === 'INCOME' ? 'Receita' : 'Despesa',
      formatCurrency(e.amountCents),
    ])

    // ── 6. Gera o PDF com QR code e rodapé de validação ─────────────────────

    const { bytes, sha256Hash } = await createTabularReportPdf({
      title: 'RELATÓRIO DE LANÇAMENTOS FINANCEIROS',
      organizationName: org?.name ?? 'Organização',
      publicId,
      exporterName: exporterFullName,
      logoPng,
      subtitles: buildSubtitles(filter),
      columns: [
        { header: 'Data',       width: 70              },
        { header: 'Descrição',  width: 175             },
        { header: 'Categoria',  width: 110             },
        { header: 'Tipo',       width: 55              },
        { header: 'Valor (R$)', width: 85, align: 'right' },
      ],
      rows,
      summary: [
        { label: 'Total de Receitas', value: formatCurrency(totalIncome)  },
        { label: 'Total de Despesas', value: formatCurrency(totalExpense) },
        { label: 'Saldo Líquido',     value: formatCurrency(balance)      },
      ],
      emptyMessage: 'Nenhum lançamento encontrado para os filtros selecionados.',
    })

    // ── 7. Registra no catálogo universal de documentos exportados ───────────

    await exportedDocumentService.register({
      organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.FINANCE_REPORT,
      publicId,
      bytes,
      exporterFullName,
    })

    return { bytes, publicId, sha256Hash }
  },
}
