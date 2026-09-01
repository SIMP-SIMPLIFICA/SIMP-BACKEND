import { prisma } from '@/lib/prisma.js'

/**
 * Portal de Validação Pública (Épico 3, Task 3.3).
 *
 * Confere a autenticidade de um documento oficial a partir do `publicId` que
 * viaja no QR Code impresso no rodapé.
 *
 * ENDPOINT PÚBLICO — SEM AUTENTICAÇÃO. Duas consequências guiaram o desenho:
 *
 *   1. NADA DE DADO PESSOAL NA RESPOSTA. O retorno traz tipo, data, hash e o
 *      nome da organização emissora. Nome do servidor, e-mail e valores ficam
 *      de fora: expor quem viajou, para onde e por quanto num endpoint aberto
 *      seria vazamento de dado pessoal (LGPD) — o fiscal confere a AUTENTICIDADE
 *      contra o papel que já tem em mãos, não precisa que o sistema reimprima o
 *      conteúdo para a internet inteira.
 *
 *   2. SÓ DOCUMENTO EMITIDO É DOCUMENTO. Um rascunho já possui `publicId`, mas
 *      não tem hash nem existe como papel. As consultas exigem `sha256Hash` não
 *      nulo; sem isso, um rascunho apareceria como documento válido.
 *
 * PADRÃO DE REGISTRO: cada tipo validável é uma entrada em `SOURCES`. Acrescentar
 * um terceiro tipo é adicionar um item à lista, não reescrever o serviço.
 */

// ─── Contratos ────────────────────────────────────────────────────────────────

export type ValidatableDocumentType = 'DAILY_ALLOWANCE' | 'FLEET_FUELING'

export interface ValidatedDocument {
  type: ValidatableDocumentType
  /** Rótulo em pt-BR exibido ao cidadão. */
  typeLabel: string
  publicId: string
  sha256Hash: string
  issuedAt: Date | null
  organization: { name: string }
}

interface DocumentSource {
  type: ValidatableDocumentType
  typeLabel: string
  find(publicId: string): Promise<ValidatedDocument | null>
}

/** Campos comuns devolvidos pelas consultas de cada fonte. */
interface RawDocument {
  publicId: string
  sha256Hash: string | null
  issuedAt: Date | null
  organization: { name: string } | null
}

function toValidated(
  source: Pick<DocumentSource, 'type' | 'typeLabel'>,
  raw: RawDocument | null
): ValidatedDocument | null {
  // Defesa dupla: além do filtro na query, um registro sem hash nunca vira
  // documento válido aqui.
  if (!raw?.sha256Hash) return null

  return {
    type: source.type,
    typeLabel: source.typeLabel,
    publicId: raw.publicId,
    sha256Hash: raw.sha256Hash,
    issuedAt: raw.issuedAt,
    organization: { name: raw.organization?.name ?? 'Organização não identificada' },
  }
}

// ─── Fontes validáveis ────────────────────────────────────────────────────────

const SELECT_PUBLIC = {
  publicId: true,
  sha256Hash: true,
  issuedAt: true,
  organization: { select: { name: true } },
} as const

const SOURCES: DocumentSource[] = [
  {
    type: 'DAILY_ALLOWANCE',
    typeLabel: 'Recibo de Diária',
    async find(publicId) {
      const raw = await prisma.dailyAllowance.findFirst({
        where: { publicId, sha256Hash: { not: null } },
        select: SELECT_PUBLIC,
      })
      return toValidated({ type: 'DAILY_ALLOWANCE', typeLabel: 'Recibo de Diária' }, raw)
    },
  },
  {
    type: 'FLEET_FUELING',
    typeLabel: 'Relatório de Abastecimento',
    async find(publicId) {
      const raw = await prisma.fleetFueling.findFirst({
        where: { publicId, sha256Hash: { not: null } },
        select: SELECT_PUBLIC,
      })
      return toValidated({ type: 'FLEET_FUELING', typeLabel: 'Relatório de Abastecimento' }, raw)
    },
  },
]

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const documentValidationService = {
  /** Tipos consultados — exposto para diagnóstico e testes. */
  get supportedTypes(): ValidatableDocumentType[] {
    return SOURCES.map(s => s.type)
  },

  /**
   * Procura o documento em todas as fontes registradas.
   *
   * As consultas rodam em paralelo: são poucas e independentes, e o fiscal está
   * com o celular na mão no meio de uma diligência — encadear as buscas somaria
   * latência sem ganho nenhum.
   */
  async validate(publicId: string): Promise<ValidatedDocument | null> {
    const results = await Promise.all(SOURCES.map(source => source.find(publicId)))
    return results.find((r): r is ValidatedDocument => r !== null) ?? null
  },
}
