import { prisma } from '@/lib/prisma.js'
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { deleteFile, getFileUrl, readFileIfExists, saveFile } from '@/services/storage.service.js'
import { logger } from '@/utils/logger.js'

/**
 * Identidade visual POR SETOR (Épico 4, refinamento da Fase 1).
 *
 * Cada secretaria pode ter a própria marca no cabeçalho dos documentos dela.
 * Segue o mesmo desenho de `organization-branding.service.ts`: o banco guarda o
 * fileKey do StorageService, nunca URL absoluta — URL gravada apodrece quando
 * APP_URL muda de dev para produção, e não serve para ler os bytes na hora de
 * montar o PDF.
 *
 * CASCATA DELIBERADA: setor sem logo cai na logo da ORGANIZAÇÃO, e só então no
 * cabeçalho neutro. Um documento da Secretaria de Obras sem marca nenhuma
 * pareceria rascunho; com a marca da prefeitura, continua sendo documento
 * oficial daquele município.
 */

export class DepartmentBrandingError extends Error {
  constructor(
    readonly code: 'DEPARTMENT_NOT_FOUND' | 'NO_FILE' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FORMAT',
    message: string
  ) {
    super(message)
    this.name = 'DepartmentBrandingError'
  }
}

/**
 * O pdf-lib embute apenas PNG e JPEG. Aceitar WebP ou GIF faria o upload passar
 * e a logo simplesmente não aparecer no documento — falha silenciosa que só
 * apareceria num PDF já emitido.
 */
const LOGO_MIMES = ['image/png', 'image/jpeg'] as const

/** 2 MB: logo de cabeçalho não precisa de mais, e o PDF carrega esses bytes. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024

const LOGO_SCOPE = 'department-branding'

export const departmentBrandingService = {
  async uploadLogo(
    departmentId: string,
    organizationId: string,
    buffer: Buffer,
    declaredMime: string,
    fileName: string
  ) {
    const department = await prisma.department.findFirst({
      // O filtro por organização é o que impede trocar a logo do setor de outra
      // prefeitura conhecendo o id.
      where: { id: departmentId, organizationId },
      select: { id: true, logoUrl: true },
    })

    if (!department) {
      throw new DepartmentBrandingError('DEPARTMENT_NOT_FOUND', 'Departamento não encontrado.')
    }

    if (buffer.length === 0) {
      throw new DepartmentBrandingError('NO_FILE', 'Nenhum arquivo enviado.')
    }

    if (buffer.length > MAX_LOGO_BYTES) {
      throw new DepartmentBrandingError('FILE_TOO_LARGE', 'A logo deve ter no máximo 2 MB.')
    }

    // Assinatura binária real: a lista de MIMEs do cliente não é confiável.
    const detected = assertAllowedFile(buffer, {
      policy: UPLOAD_POLICIES.IMAGES_ONLY,
      declaredMime,
      fileName,
    })

    if (!LOGO_MIMES.includes(detected.mime as (typeof LOGO_MIMES)[number])) {
      throw new DepartmentBrandingError(
        'UNSUPPORTED_FORMAT',
        'A logo deve estar em PNG ou JPEG. Outros formatos não podem ser inseridos nos documentos oficiais.'
      )
    }

    const fileKey = await saveFile(buffer, {
      organizationId,
      scope: LOGO_SCOPE,
      originalName: fileName,
    })

    const updated = await prisma.department.update({
      where: { id: departmentId },
      data: { logoUrl: fileKey },
      select: { id: true, name: true, code: true, logoUrl: true },
    })

    // A anterior só sai DEPOIS de a nova estar gravada e referenciada: na ordem
    // inversa, uma falha no meio deixaria o setor sem logo nenhuma. Falha ao
    // apagar vira log — sobra um arquivo órfão, bem menos grave que recusar a
    // troca.
    if (department.logoUrl && department.logoUrl !== fileKey) {
      try {
        await deleteFile(department.logoUrl)
      } catch (error) {
        logger.warn(
          { error, departmentId, fileKey: department.logoUrl },
          'Não foi possível remover a logo anterior do setor; arquivo órfão mantido'
        )
      }
    }

    return { ...updated, logoPublicUrl: getFileUrl(fileKey) }
  },

  /** Remove a logo do setor; os documentos voltam a usar a da organização. */
  async removeLogo(departmentId: string, organizationId: string) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId },
      select: { id: true, logoUrl: true },
    })

    if (!department) {
      throw new DepartmentBrandingError('DEPARTMENT_NOT_FOUND', 'Departamento não encontrado.')
    }

    const updated = await prisma.department.update({
      where: { id: departmentId },
      data: { logoUrl: null },
      select: { id: true, name: true, code: true, logoUrl: true },
    })

    if (department.logoUrl) {
      try {
        await deleteFile(department.logoUrl)
      } catch (error) {
        logger.warn(
          { error, departmentId },
          'Não foi possível remover o arquivo da logo do setor; referência já limpa no banco'
        )
      }
    }

    return updated
  },

  /**
   * Bytes da logo para o cabeçalho, com a cascata setor → organização.
   *
   * NUNCA lança: a emissão de um documento oficial não pode falhar por causa de
   * um problema de imagem.
   */
  async getLogoBytes(
    departmentId: string | null | undefined,
    organizationId: string
  ): Promise<Uint8Array | undefined> {
    if (departmentId) {
      try {
        const department = await prisma.department.findFirst({
          where: { id: departmentId, organizationId },
          select: { logoUrl: true },
        })

        if (department?.logoUrl) {
          const bytes = await readFileIfExists(department.logoUrl)
          if (bytes) return bytes

          logger.warn(
            { departmentId, fileKey: department.logoUrl },
            'Logo do setor referenciada no banco não existe no storage; caindo na logo da organização'
          )
        }
      } catch (error) {
        logger.error(
          { error, departmentId },
          'Falha ao carregar a logo do setor; caindo na logo da organização'
        )
      }
    }

    return organizationBrandingService.getLogoBytes(organizationId)
  },
}
