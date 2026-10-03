import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma.js'
import { calculateDocumentHash } from '@/services/document-pdf.service.js'
import { anonymizeName } from '@/utils/lgpd-anonymizer.util.js'
import { logger } from '@/utils/logger.js'

/**
 * Registro de documentos exportados — validação universal.
 *
 * Qualquer PDF que saia do sistema se anota aqui, e passa a ser conferível no
 * Portal Público pelo QR Code do rodapé.
 *
 * ORDEM OBRIGATÓRIA, e o motivo de a API ter dois passos:
 *
 *   1. `newPublicId()` ANTES de montar o PDF — o identificador precisa existir
 *      para entrar no QR Code.
 *   2. `register()` DEPOIS de salvar os bytes — o hash é calculado sobre o
 *      arquivo FINAL, que só existe quando o rodapé já foi estampado.
 *
 * Inverter isso produziria um hash que não corresponde ao arquivo entregue, e o
 * Portal passaria a acusar adulteração em documento legítimo.
 */

export interface RegisterExportInput {
  organizationId: string
  /** Ver constants/exported-document-types.ts. */
  documentType: string
  /** Identificador já impresso no QR Code do documento. */
  publicId: string
  /** Bytes FINAIS do PDF entregue ao usuário. */
  bytes: Uint8Array
  /**
   * Nome COMPLETO de quem exportou.
   *
   * A ofuscação acontece AQUI, antes de gravar: o banco nunca guarda o nome
   * inteiro, então nenhuma consulta futura ao registro — que alimenta endpoint
   * público — consegue vazá-lo.
   */
  exporterFullName?: string | null
}

export const exportedDocumentService = {
  /** Identificador público para estampar no QR Code antes de gerar o PDF. */
  newPublicId(): string {
    return randomUUID()
  },

  /**
   * Registra o documento exportado e devolve o hash gravado.
   *
   * Não lança para o chamador: o registro é efeito colateral da exportação, e
   * falhar aqui não pode impedir o usuário de receber o PDF que pediu. O que se
   * perde numa falha é a conferência pública daquele arquivo — incômodo, mas
   * menos grave que derrubar o download. A falha vira log de erro.
   */
  async register(input: RegisterExportInput): Promise<string | null> {
    const sha256Hash = calculateDocumentHash(input.bytes)

    try {
      await prisma.exportedDocument.create({
        data: {
          organizationId: input.organizationId,
          documentType: input.documentType,
          publicId: input.publicId,
          sha256Hash,
          exporterName: anonymizeName(input.exporterFullName),
        },
      })
      return sha256Hash
    } catch (error) {
      logger.error(
        { error, documentType: input.documentType, publicId: input.publicId },
        'Falha ao registrar documento exportado; o PDF segue entregue, mas não será validável'
      )
      return null
    }
  },
}
