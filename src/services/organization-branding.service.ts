import { prisma } from '@/lib/prisma.js'
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'
import { deleteFile, getFileUrl, readFileIfExists, saveFile } from '@/services/storage.service.js'
import { logger } from '@/utils/logger.js'

/**
 * Identidade visual por tenant — white-label (Épico 3, Task 3.4).
 *
 * A logo é gravada pelo StorageService (adaptador local hoje, S3 amanhã) e a
 * `Organization.logoUrl` guarda o fileKey devolvido por ele. A URL pública é
 * derivada na leitura: gravar URL absoluta no banco apodrece quando APP_URL
 * muda de dev para produção, e não serve para ler os bytes na hora de montar o
 * PDF.
 */

// ─── Erros de domínio ─────────────────────────────────────────────────────────

export class BrandingError extends Error {
  constructor(
    readonly code: 'ORGANIZATION_NOT_FOUND' | 'NO_FILE' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FORMAT',
    message: string
  ) {
    super(message)
    this.name = 'BrandingError'
  }
}

/**
 * Formatos aceitos para a LOGO, mais restrito que a política IMAGES_ONLY.
 *
 * O pdf-lib embute apenas PNG e JPEG. Aceitar WebP ou GIF faria o upload passar
 * e a logo simplesmente não aparecer no documento — uma falha silenciosa que o
 * Super Admin só descobriria ao conferir um PDF já emitido. Melhor recusar na
 * hora, com mensagem clara.
 */
const LOGO_MIMES = ['image/png', 'image/jpeg'] as const

/** 2 MB: logo de cabeçalho não precisa de mais, e o PDF carrega esses bytes. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024

const LOGO_SCOPE = 'branding'

export const organizationBrandingService = {
  /**
   * Substitui a logo da organização.
   *
   * A logo anterior é removida DEPOIS de a nova ser gravada e referenciada: se a
   * ordem fosse inversa, uma falha no meio deixaria a organização sem logo
   * nenhuma. Falha ao apagar a antiga vira log, não erro — no pior caso sobra um
   * arquivo órfão, o que é bem menos grave que recusar a troca.
   */
  async uploadLogo(
    organizationId: string,
    buffer: Buffer,
    declaredMime: string,
    fileName: string
  ) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, logoUrl: true },
    })

    if (!organization) {
      throw new BrandingError('ORGANIZATION_NOT_FOUND', 'Organização não encontrada.')
    }

    if (buffer.length === 0) {
      throw new BrandingError('NO_FILE', 'Nenhum arquivo enviado.')
    }

    if (buffer.length > MAX_LOGO_BYTES) {
      throw new BrandingError(
        'FILE_TOO_LARGE',
        'A logo deve ter no máximo 2 MB.'
      )
    }

    // Assinatura binária real: a lista de MIMEs do cliente não é confiável.
    // Devolve o MIME VERDADEIRO, que é o que vale para a checagem seguinte.
    const detected = assertAllowedFile(buffer, {
      policy: UPLOAD_POLICIES.IMAGES_ONLY,
      declaredMime,
      fileName,
    })

    if (!LOGO_MIMES.includes(detected.mime as (typeof LOGO_MIMES)[number])) {
      throw new BrandingError(
        'UNSUPPORTED_FORMAT',
        'A logo deve estar em PNG ou JPEG. Outros formatos não podem ser inseridos nos documentos oficiais.'
      )
    }

    const fileKey = await saveFile(buffer, {
      organizationId,
      scope: LOGO_SCOPE,
      originalName: fileName,
    })

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl: fileKey },
      select: { id: true, name: true, logoUrl: true },
    })

    if (organization.logoUrl && organization.logoUrl !== fileKey) {
      try {
        await deleteFile(organization.logoUrl)
      } catch (error) {
        logger.warn(
          { error, organizationId, fileKey: organization.logoUrl },
          'Não foi possível remover a logo anterior; arquivo órfão mantido'
        )
      }
    }

    return { ...updated, logoPublicUrl: getFileUrl(fileKey) }
  },

  /** Remove a logo, voltando o documento ao cabeçalho neutro. */
  async removeLogo(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, logoUrl: true },
    })

    if (!organization) {
      throw new BrandingError('ORGANIZATION_NOT_FOUND', 'Organização não encontrada.')
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl: null },
      select: { id: true, name: true, logoUrl: true },
    })

    if (organization.logoUrl) {
      try {
        await deleteFile(organization.logoUrl)
      } catch (error) {
        logger.warn(
          { error, organizationId },
          'Não foi possível remover o arquivo da logo; referência já limpa no banco'
        )
      }
    }

    return updated
  },

  /**
   * Bytes da logo para injeção no PDF, ou `undefined` quando não há logo.
   *
   * NUNCA lança: a emissão de um documento oficial não pode falhar por causa de
   * um problema de imagem. Sem logo, o cabeçalho fica neutro — que é exatamente
   * o comportamento do `document-pdf.service.ts` quando recebe `undefined`.
   */
  async getLogoBytes(organizationId: string): Promise<Uint8Array | undefined> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { logoUrl: true },
      })

      if (!organization?.logoUrl) return undefined

      const bytes = await readFileIfExists(organization.logoUrl)

      if (!bytes) {
        logger.warn(
          { organizationId, fileKey: organization.logoUrl },
          'Logo referenciada no banco não existe no storage; documento será emitido sem logo'
        )
        return undefined
      }

      return bytes
    } catch (error) {
      logger.error(
        { error, organizationId },
        'Falha ao carregar a logo da organização; documento será emitido sem logo'
      )
      return undefined
    }
  },
}
