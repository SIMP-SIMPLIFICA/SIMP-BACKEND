import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

/**
 * Geração de documentos oficiais em PDF (Épico 3, Task 3.1).
 *
 * Aqui NADA de pdf-lib ou qrcode é mockado: o valor destes testes está em provar
 * que um PDF real sai com um hash que confere. Mockar a geração testaria só o
 * mock.
 */

vi.mock('@/config/config.js', () => ({
  config: { urls: { frontend: 'https://simp.prefeitura.gov.br' } },
}))

const {
  buildValidationUrl,
  calculateDocumentHash,
  sanitizeForPdf,
  renderQrCodePng,
  createOfficialPdf,
} = await import('../services/document-pdf.service.js')

const BASE_INPUT = {
  title: 'RECIBO DE DIÁRIA',
  organizationName: 'Prefeitura Municipal de Exemplo',
  publicId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  sections: [
    {
      heading: 'Servidor',
      fields: [
        { label: 'Nome', value: 'João da Conceição' },
        { label: 'Destino', value: 'Brasília/DF' },
      ],
    },
  ],
}

describe('Documentos oficiais em PDF (Task 3.1)', () => {
  describe('URL de validação', () => {
    test('aponta para a página pública do frontend', () => {
      expect(buildValidationUrl('abc-123')).toBe(
        'https://simp.prefeitura.gov.br/validar-documento/abc-123'
      )
    })

    test('não duplica a barra quando a base termina em /', async () => {
      vi.resetModules()
      vi.doMock('@/config/config.js', () => ({
        config: { urls: { frontend: 'https://simp.prefeitura.gov.br/' } },
      }))
      const mod = await import('../services/document-pdf.service.js')

      expect(mod.buildValidationUrl('abc')).toBe(
        'https://simp.prefeitura.gov.br/validar-documento/abc'
      )
      vi.doUnmock('@/config/config.js')
      vi.resetModules()
    })
  })

  describe('hash', () => {
    test('é o SHA-256 hexadecimal dos bytes', () => {
      const bytes = new Uint8Array([1, 2, 3, 4])
      const expected = createHash('sha256').update(bytes).digest('hex')

      expect(calculateDocumentHash(bytes)).toBe(expected)
      expect(calculateDocumentHash(bytes)).toMatch(/^[0-9a-f]{64}$/)
    })

    test('um único byte diferente muda o hash', () => {
      // É esta propriedade que sustenta o Portal de Validação: qualquer
      // adulteração do arquivo precisa ser detectável.
      const a = calculateDocumentHash(new Uint8Array([1, 2, 3]))
      const b = calculateDocumentHash(new Uint8Array([1, 2, 4]))
      expect(a).not.toBe(b)
    })
  })

  describe('sanitização de texto', () => {
    test('preserva acentuação portuguesa', () => {
      expect(sanitizeForPdf('Conceição, José e Ângela — ação')).toBe(
        'Conceição, José e Ângela — ação'
      )
    })

    test('remove emoji, que a fonte padrão não codifica', () => {
      expect(sanitizeForPdf('Viagem 🚗 urgente')).toBe('Viagem  urgente')
    })
  })

  describe('QR Code', () => {
    test('gera um PNG de verdade', async () => {
      const png = await renderQrCodePng('https://exemplo.gov.br/validar-documento/x')
      // Assinatura PNG: 89 50 4E 47
      expect(png.subarray(0, 4).toString('hex')).toBe('89504e47')
      expect(png.length).toBeGreaterThan(100)
    })
  })

  describe('montagem do documento', () => {
    test('produz um PDF válido com hash correspondente aos bytes', async () => {
      const result = await createOfficialPdf(BASE_INPUT)

      expect(Buffer.from(result.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
      expect(result.sha256Hash).toBe(calculateDocumentHash(result.bytes))
      expect(result.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('devolve a URL de validação que foi para o QR Code', async () => {
      const result = await createOfficialPdf(BASE_INPUT)
      expect(result.validationUrl).toBe(
        `https://simp.prefeitura.gov.br/validar-documento/${BASE_INPUT.publicId}`
      )
    })

    test('texto com emoji NÃO derruba a emissão', async () => {
      // Sem a sanitização, a fonte WinAnsi lançaria e um dado digitado pelo
      // servidor viraria erro 500 na emissão de um documento oficial.
      const result = await createOfficialPdf({
        ...BASE_INPUT,
        sections: [{ fields: [{ label: 'Motivo', value: 'Reunião 🎉 no ministério' }] }],
      })
      expect(result.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('motivo longo não quebra a geração (quebra de linha)', async () => {
      const result = await createOfficialPdf({
        ...BASE_INPUT,
        sections: [{ fields: [{ label: 'Motivo', value: 'Participação em reunião '.repeat(40) }] }],
      })
      expect(Buffer.from(result.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    })

    test('logo inválida não impede a emissão', async () => {
      // Documento oficial não pode deixar de sair por causa de um arquivo de
      // marca corrompido — a Task 3.4 depende desta tolerância.
      const result = await createOfficialPdf({
        ...BASE_INPUT,
        logoPng: new Uint8Array([1, 2, 3, 4, 5]),
      })
      expect(Buffer.from(result.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    })

    test('dois documentos com publicId diferente geram hashes diferentes', async () => {
      const a = await createOfficialPdf(BASE_INPUT)
      const b = await createOfficialPdf({ ...BASE_INPUT, publicId: 'outro-id' })
      expect(a.sha256Hash).not.toBe(b.sha256Hash)
    })
  })
})
