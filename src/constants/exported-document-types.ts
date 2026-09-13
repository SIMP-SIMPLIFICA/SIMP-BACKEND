/**
 * Tipos de documento exportável com validação universal.
 *
 * O campo `ExportedDocument.documentType` é String livre de propósito — a
 * promessa é validar QUALQUER PDF futuro do sistema, e um enum no banco exigiria
 * migração a cada relatório novo. Este arquivo é o catálogo em CÓDIGO: acrescentar
 * um tipo aqui basta para o portal público exibir o rótulo correto em pt-BR.
 *
 * Um tipo desconhecido (exportado por uma versão mais nova que o catálogo) cai
 * num rótulo genérico em vez de quebrar a validação — um documento legítimo não
 * pode deixar de ser atestado porque o rótulo não foi cadastrado.
 */

export const EXPORTED_DOCUMENT_TYPES = {
  REPORT_PROTOCOLS: 'REPORT_PROTOCOLS',
  COUNCIL_CALENDAR: 'COUNCIL_CALENDAR',
  FINANCE_REPORT: 'FINANCE_REPORT',
  DAILY_ALLOWANCE: 'DAILY_ALLOWANCE',
  /** Anexo II — prestação de contas do deslocamento. Documento próprio. */
  DAILY_ALLOWANCE_ACCOUNTABILITY: 'DAILY_ALLOWANCE_ACCOUNTABILITY',
  REPORT_DAILY_ALLOWANCES: 'REPORT_DAILY_ALLOWANCES',
  /**
   * PDF-Manifesto de uma planilha: não contém os dados, apenas atesta o
   * SHA-256 do .xlsx que viaja ao lado dele no ZIP. É o que dá validação
   * universal a um formato que não comporta QR Code nem rodapé.
   */
  DAILY_ALLOWANCE_XLS_MANIFEST: 'DAILY_ALLOWANCE_XLS_MANIFEST',
  FLEET_FUELING: 'FLEET_FUELING',
} as const

export type ExportedDocumentType =
  (typeof EXPORTED_DOCUMENT_TYPES)[keyof typeof EXPORTED_DOCUMENT_TYPES]

/** Rótulos exibidos ao cidadão no portal de validação. */
const LABELS: Record<string, string> = {
  [EXPORTED_DOCUMENT_TYPES.REPORT_PROTOCOLS]: 'Relatório de Protocolos',
  [EXPORTED_DOCUMENT_TYPES.COUNCIL_CALENDAR]: 'Calendário Anual de Reuniões',
  [EXPORTED_DOCUMENT_TYPES.FINANCE_REPORT]: 'Relatório de Lançamentos Financeiros',
  [EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE]: 'Recibo de Diária',
  [EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE_ACCOUNTABILITY]:
    'Prestação de Contas de Diária (Anexo II)',
  [EXPORTED_DOCUMENT_TYPES.REPORT_DAILY_ALLOWANCES]: 'Relatório de Diárias',
  [EXPORTED_DOCUMENT_TYPES.DAILY_ALLOWANCE_XLS_MANIFEST]:
    'Manifesto de Integridade de Planilha (Diárias)',
  [EXPORTED_DOCUMENT_TYPES.FLEET_FUELING]: 'Relatório de Abastecimento',
}

/** Rótulo em pt-BR do tipo, com fallback para tipo não catalogado. */
export function getExportedDocumentLabel(documentType: string): string {
  return LABELS[documentType] ?? 'Documento Oficial'
}
