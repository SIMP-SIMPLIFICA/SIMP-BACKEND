import { describe, expect, test } from 'vitest'
import { isPrivateUploadPath } from '@/utils/private-upload-path.js'

describe('isPrivateUploadPath', () => {
  test('bloqueia qualquer segmento fleet-*, com / ou \\ e em qualquer caixa', () => {
    for (const path of [
      '/organizations/org1/fleet-fuelings/a.pdf',
      'organizations/org1/fleet-receipts/a.webp',
      '/organizations/org1/FLEET-FUELINGS/a.pdf',
      '/organizations/org1/fleet-fuelings\\a.pdf',
      '/organizations\\org1\\fleet-fuelings\\a.pdf',
      '/organizations/org1//fleet-fuelings/a.pdf',
      '/organizations/org1/./fleet-fuelings/a.pdf',
      '/organizations/org1/FLEET-~1/a.pdf',
      '/fleet-fuelings',
    ]) {
      expect(isPrivateUploadPath(path), path).toBe(true)
    }
  })

  test('libera os demais escopos', () => {
    for (const path of ['/organizations/org1/avatars/a.png', '/organizations/org1/daily-allowances/a.pdf', '/a-fleet-b/x.pdf', '/']) {
      expect(isPrivateUploadPath(path), path).toBe(false)
    }
  })

  test('% literal não quebra a checagem (sem decodificar de novo)', () => {
    expect(isPrivateUploadPath('/organizations/org1/fleet-fuelings/%zz.pdf')).toBe(true)
    expect(isPrivateUploadPath('/organizations/org1/avatars/%zz.png')).toBe(false)
  })
})
