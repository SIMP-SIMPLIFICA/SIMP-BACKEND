import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Identidade visual por tenant — white-label (Épico 3, Task 3.4).
 *
 * O foco é o contrato do serviço: validação real do arquivo, ordem segura da
 * troca e — o ponto mais importante — a garantia de que um problema de imagem
 * NUNCA impede a emissão de um documento oficial.
 */

const findUniqueMock = vi.fn()
const updateMock = vi.fn()
const saveFileMock = vi.fn()
const deleteFileMock = vi.fn()
const readFileIfExistsMock = vi.fn()
const assertAllowedFileMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    organization: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
  },
}))

vi.mock('@/services/storage.service.js', () => ({
  saveFile: (...a: unknown[]) => saveFileMock(...a),
  deleteFile: (...a: unknown[]) => deleteFileMock(...a),
  readFileIfExists: (...a: unknown[]) => readFileIfExistsMock(...a),
  getFileUrl: (key: string) => `http://localhost:3000/uploads/${key}`,
}))

vi.mock('@/services/file-validation.service.js', () => ({
  assertAllowedFile: (...a: unknown[]) => assertAllowedFileMock(...a),
  UPLOAD_POLICIES: { IMAGES_ONLY: { name: 'IMAGES_ONLY', allowedMimes: [] } },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { warn: loggerWarnMock, error: loggerErrorMock, info: vi.fn() },
}))

const { organizationBrandingService, BrandingError } = await import(
  '../services/organization-branding.service.js'
)

const ORG_ID = 'org-1'
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('White-label por tenant (Task 3.4)', () => {
  beforeEach(() => {
    for (const m of [
      findUniqueMock, updateMock, saveFileMock, deleteFileMock,
      readFileIfExistsMock, assertAllowedFileMock, loggerWarnMock, loggerErrorMock,
    ]) m.mockReset()

    findUniqueMock.mockResolvedValue({ id: ORG_ID, logoUrl: null })
    saveFileMock.mockResolvedValue('organizations/org-1/branding/nova.png')
    updateMock.mockResolvedValue({
      id: ORG_ID,
      name: 'Prefeitura de Exemplo',
      logoUrl: 'organizations/org-1/branding/nova.png',
    })
    deleteFileMock.mockResolvedValue(undefined)
    assertAllowedFileMock.mockReturnValue({ mime: 'image/png', extensions: ['png'] })
  })

  describe('upload', () => {
    test('valida o conteúdo real do arquivo, não o MIME declarado', async () => {
      await organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/png', 'logo.png')

      expect(assertAllowedFileMock).toHaveBeenCalledTimes(1)
      expect(assertAllowedFileMock.mock.calls[0][1]).toMatchObject({
        declaredMime: 'image/png',
        fileName: 'logo.png',
      })
    })

    test('grava pelo StorageService e guarda o fileKey', async () => {
      const result = await organizationBrandingService.uploadLogo(
        ORG_ID, PNG_BYTES, 'image/png', 'logo.png'
      )

      expect(saveFileMock.mock.calls[0][1]).toMatchObject({
        organizationId: ORG_ID,
        scope: 'branding',
      })
      expect(updateMock.mock.calls[0][0].data.logoUrl).toBe('organizations/org-1/branding/nova.png')
      // A URL pública é derivada na leitura, não gravada no banco.
      expect(result.logoPublicUrl).toContain('/uploads/organizations/org-1/branding/nova.png')
    })

    test('recusa WebP e GIF, que o pdf-lib não sabe embutir', async () => {
      // Aceitar faria o upload passar e a logo sumir do PDF em silêncio — o
      // Super Admin só descobriria conferindo um documento já emitido.
      assertAllowedFileMock.mockReturnValue({ mime: 'image/webp', extensions: ['webp'] })

      await expect(
        organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/webp', 'logo.webp')
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })

      expect(saveFileMock).not.toHaveBeenCalled()
    })

    test('aceita JPEG', async () => {
      assertAllowedFileMock.mockReturnValue({ mime: 'image/jpeg', extensions: ['jpg'] })

      await organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/jpeg', 'logo.jpg')
      expect(saveFileMock).toHaveBeenCalledTimes(1)
    })

    test('recusa arquivo vazio', async () => {
      await expect(
        organizationBrandingService.uploadLogo(ORG_ID, Buffer.alloc(0), 'image/png', 'x.png')
      ).rejects.toMatchObject({ code: 'NO_FILE' })
    })

    test('recusa arquivo acima de 2 MB', async () => {
      const big = Buffer.alloc(2 * 1024 * 1024 + 1)

      await expect(
        organizationBrandingService.uploadLogo(ORG_ID, big, 'image/png', 'grande.png')
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })

      expect(assertAllowedFileMock).not.toHaveBeenCalled()
    })

    test('organização inexistente é recusada antes de gravar qualquer coisa', async () => {
      findUniqueMock.mockResolvedValue(null)

      await expect(
        organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/png', 'l.png')
      ).rejects.toBeInstanceOf(BrandingError)

      expect(saveFileMock).not.toHaveBeenCalled()
    })

    test('a logo anterior só é apagada DEPOIS de a nova ficar referenciada', async () => {
      // Ordem inversa deixaria a organização sem logo nenhuma se algo falhasse
      // no meio da troca.
      findUniqueMock.mockResolvedValue({ id: ORG_ID, logoUrl: 'antiga.png' })

      await organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/png', 'nova.png')

      expect(updateMock).toHaveBeenCalled()
      expect(deleteFileMock).toHaveBeenCalledWith('antiga.png')
      expect(updateMock.mock.invocationCallOrder[0]).toBeLessThan(
        deleteFileMock.mock.invocationCallOrder[0]
      )
    })

    test('falha ao apagar a logo antiga não derruba a troca', async () => {
      findUniqueMock.mockResolvedValue({ id: ORG_ID, logoUrl: 'antiga.png' })
      deleteFileMock.mockRejectedValue(new Error('disco ocupado'))

      await expect(
        organizationBrandingService.uploadLogo(ORG_ID, PNG_BYTES, 'image/png', 'nova.png')
      ).resolves.toMatchObject({ logoUrl: 'organizations/org-1/branding/nova.png' })

      expect(loggerWarnMock).toHaveBeenCalled()
    })
  })

  describe('remoção', () => {
    test('limpa a referência e apaga o arquivo', async () => {
      findUniqueMock.mockResolvedValue({ id: ORG_ID, logoUrl: 'antiga.png' })
      updateMock.mockResolvedValue({ id: ORG_ID, name: 'X', logoUrl: null })

      await organizationBrandingService.removeLogo(ORG_ID)

      expect(updateMock.mock.calls[0][0].data.logoUrl).toBeNull()
      expect(deleteFileMock).toHaveBeenCalledWith('antiga.png')
    })

    test('organização sem logo não tenta apagar arquivo', async () => {
      updateMock.mockResolvedValue({ id: ORG_ID, name: 'X', logoUrl: null })

      await organizationBrandingService.removeLogo(ORG_ID)
      expect(deleteFileMock).not.toHaveBeenCalled()
    })
  })

  describe('leitura para o PDF — nunca derruba a emissão', () => {
    test('devolve os bytes quando há logo', async () => {
      findUniqueMock.mockResolvedValue({ logoUrl: 'logo.png' })
      readFileIfExistsMock.mockResolvedValue(PNG_BYTES)

      expect(await organizationBrandingService.getLogoBytes(ORG_ID)).toBe(PNG_BYTES)
    })

    test('sem logo cadastrada devolve undefined (cabeçalho neutro)', async () => {
      findUniqueMock.mockResolvedValue({ logoUrl: null })

      expect(await organizationBrandingService.getLogoBytes(ORG_ID)).toBeUndefined()
      expect(readFileIfExistsMock).not.toHaveBeenCalled()
    })

    test('arquivo sumido do storage NÃO impede a emissão', async () => {
      // Sem esta tolerância, uma imagem faltando deixaria a prefeitura sem
      // conseguir emitir diária.
      findUniqueMock.mockResolvedValue({ logoUrl: 'sumida.png' })
      readFileIfExistsMock.mockResolvedValue(null)

      expect(await organizationBrandingService.getLogoBytes(ORG_ID)).toBeUndefined()
      expect(loggerWarnMock).toHaveBeenCalled()
    })

    test('erro de banco ou storage NÃO propaga', async () => {
      findUniqueMock.mockRejectedValue(new Error('banco fora do ar'))

      expect(await organizationBrandingService.getLogoBytes(ORG_ID)).toBeUndefined()
      expect(loggerErrorMock).toHaveBeenCalled()
    })
  })
})
