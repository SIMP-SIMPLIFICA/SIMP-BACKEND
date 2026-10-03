import type { OfficialDocumentCategory, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { type ReportColumn, createTabularReportPdf } from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import {
  type ProtocolAccessScope,
  buildProtocolVisibilityFilter,
} from '@/utils/protocol-access.util.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'

/**
 * Relatório de Protocolos Oficiais em PDF.
 *
 * Reaproveita `createTabularReportPdf`, então herda o rodapé universal de
 * validação, o QR Code e o cálculo de hash — o relatório nasce conferível no
 * Portal Público sem código específico para isso.
 *
 * A VISIBILIDADE é a MESMA da listagem (`buildProtocolVisibilityFilter`): quem
 * não é admin só enxerga o próprio departamento. Um relatório com regra mais
 * frouxa que a tela seria uma porta lateral para ler documento de outro setor.
 */

export interface ProtocolReportFilter {
  startDate?: Date
  endDate?: Date
  documentCategory?: OfficialDocumentCategory
  documentType?: string
}

/** Larguras somam 495pt — a faixa útil de uma página A4 com margem de 50. */
const COLUMNS: ReportColumn[] = [
  { header: 'Número', width: 85 },
  { header: 'Data', width: 52 },
  { header: 'Tipo', width: 80 },
  { header: 'Setor', width: 58 },
  { header: 'Situação', width: 55 },
  { header: 'Assunto', width: 165 },
]

const CATEGORY_LABELS: Record<string, string> = {
  COMUNICACAO: 'Comunicação',
  NORMATIVO: 'Normativo',
}

const STATUS_LABELS: Record<string, string> = {
  RESERVADO: 'Reservado',
  EMITIDO: 'Emitido',
  CANCELADO: 'Cancelado',
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
}

/** Descreve os filtros aplicados, para o leitor saber o que o relatório cobre. */
function describeFilters(filter: ProtocolReportFilter): string[] {
  const lines: string[] = []

  if (filter.startDate && filter.endDate) {
    lines.push(`Período: ${formatDate(filter.startDate)} a ${formatDate(filter.endDate)}`)
  } else if (filter.startDate) {
    lines.push(`A partir de: ${formatDate(filter.startDate)}`)
  } else if (filter.endDate) {
    lines.push(`Até: ${formatDate(filter.endDate)}`)
  } else {
    // Sem recorte de data o leitor precisa saber que o relatório é completo.
    lines.push('Período: todos os registros')
  }

  if (filter.documentCategory) {
    lines.push(`Categoria: ${CATEGORY_LABELS[filter.documentCategory] ?? filter.documentCategory}`)
  }
  if (filter.documentType) {
    lines.push(`Tipo: ${filter.documentType}`)
  }

  return lines
}

export const protocolReportService = {
  /**
   * Gera o PDF e registra o hash para validação pública.
   *
   * Devolve também o `publicId`, que o controller usa no nome do arquivo — assim
   * o documento baixado já carrega no nome o código que o valida.
   */
  async generate(filter: ProtocolReportFilter, scope: ProtocolAccessScope) {
    const visibility = await buildProtocolVisibilityFilter(scope)

    const where: Prisma.OfficialDocumentWhereInput = { ...visibility }

    if (filter.documentCategory) where.documentCategory = filter.documentCategory
    if (filter.documentType) where.documentType = filter.documentType

    if (filter.startDate || filter.endDate) {
      where.createdAt = {}
      if (filter.startDate) where.createdAt.gte = filter.startDate
      // O fim do intervalo cobre o dia inteiro: quem informa 31/12 espera os
      // documentos daquele dia, não até a meia-noite em ponto.
      if (filter.endDate) {
        const end = new Date(filter.endDate)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const [documents, organization, issuer] = await Promise.all([
      prisma.officialDocument.findMany({
        where,
        orderBy: [{ year: 'desc' }, { sequenceNumber: 'desc' }, { createdAt: 'desc' }],
        select: {
          formattedNumber: true,
          createdAt: true,
          documentType: true,
          documentCategory: true,
          sector: true,
          status: true,
          subject: true,
        },
      }),
      scope.organizationId
        ? prisma.organization.findUnique({
            where: { id: scope.organizationId },
            select: { name: true },
          })
        : null,
      prisma.user.findUnique({
        where: { id: scope.userId },
        select: { firstName: true, lastName: true },
      }),
    ])

    const rows = documents.map(doc => [
      doc.formattedNumber,
      formatDate(doc.createdAt),
      doc.documentType,
      doc.sector,
      STATUS_LABELS[doc.status] ?? doc.status,
      doc.subject,
    ])

    const countBy = (status: string) => documents.filter(d => d.status === status).length

    const publicId = exportedDocumentService.newPublicId()

    const { bytes, sha256Hash } = await createTabularReportPdf({
      title: 'RELATÓRIO DE PROTOCOLOS OFICIAIS',
      organizationName: organization?.name ?? 'Organização',
      publicId,
      exporterName: anonymizeUserName(issuer?.firstName, issuer?.lastName),
      subtitles: describeFilters(filter),
      columns: COLUMNS,
      rows,
      summary: [
        { label: 'Total de documentos', value: String(documents.length) },
        { label: 'Emitidos', value: String(countBy('EMITIDO')) },
        { label: 'Reservados', value: String(countBy('RESERVADO')) },
        { label: 'Cancelados', value: String(countBy('CANCELADO')) },
      ],
      emptyMessage: 'Nenhum protocolo encontrado para os filtros informados.',
      logoPng: scope.organizationId
        ? await organizationBrandingService.getLogoBytes(scope.organizationId)
        : null,
    })

    // Registro para validação pública. O hash vem do PDF já finalizado, então é
    // exatamente o arquivo que o usuário recebe.
    if (scope.organizationId) {
      await exportedDocumentService.register({
        organizationId: scope.organizationId,
        documentType: EXPORTED_DOCUMENT_TYPES.REPORT_PROTOCOLS,
        publicId,
        bytes,
        exporterFullName: [issuer?.firstName, issuer?.lastName].filter(Boolean).join(' '),
      })
    }

    return { bytes, publicId, sha256Hash, total: documents.length }
  },
}
