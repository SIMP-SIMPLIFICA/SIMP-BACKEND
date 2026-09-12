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
} as const

export type ExportedDocumentType =
  (typeof EXPORTED_DOCUMENT_TYPES)[keyof typeof EXPORTED_DOCUMENT_TYPES]

/** Rótulos exibidos ao cidadão no portal de validação. */
const LABELS: Record<string, string> = {
  [EXPORTED_DOCUMENT_TYPES.REPORT_PROTOCOLS]: 'Relatório de Protocolos',
  [EXPORTED_DOCUMENT_TYPES.COUNCIL_CALENDAR]: 'Calendário Anual de Reuniões',
}

/** Rótulo em pt-BR do tipo, com fallback para tipo não catalogado. */
export function getExportedDocumentLabel(documentType: string): string {
  return LABELS[documentType] ?? 'Documento Oficial'
}
