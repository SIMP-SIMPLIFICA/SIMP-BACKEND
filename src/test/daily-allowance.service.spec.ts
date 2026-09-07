import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Diárias de servidor (Épico 3, Task 3.1).
 *
 * Prisma, storage e geração de PDF são mockados: o que se testa aqui são as
 * REGRAS — isolamento multi-tenant, cálculo do valor e a imutabilidade após a
 * emissão. A geração real de PDF tem sua própria suíte.
 */

const findFirstMock = vi.fn()
const findManyMock = vi.fn()
const countMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const deleteMock = vi.fn()
const orgFindUniqueMock = vi.fn()
const saveFileMock = vi.fn()
const createPdfMock = vi.fn()
const auditRecordMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    dailyAllowance: {
      findFirst: (...a: unknown[]) => findFirstMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
      count: (...a: unknown[]) => countMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
      delete: (...a: unknown[]) => deleteMock(...a),
    },
    organization: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
  },
}))

vi.mock('@/services/storage.service.js', () => ({
  saveFile: (...a: unknown[]) => saveFileMock(...a),
  getFilePath: (key: string) => `/uploads/${key}`,
}))

vi.mock('@/services/document-pdf.service.js', () => ({
  createOfficialPdf: (...a: unknown[]) => createPdfMock(...a),
}))

vi.mock('@/services/audit-ledger.service.js', () => ({
  auditLedgerService: { record: (...a: unknown[]) => auditRecordMock(...a) },
}))

const { dailyAllowanceService, calculateTotalAmount, DailyAllowanceError } = await import(
  '../services/daily-allowance.service.js'
)

const SCOPE = { organizationId: 'org-1', userId: 'issuer-1' }

/** Rascunho: sem sha256Hash, ainda editável. */
const DRAFT = {
  id: 'da-1',
  publicId: 'pub-1',
  organizationId: 'org-1',
  beneficiaryName: 'JOÃO DA SILVA',
  destination: 'Brasília/DF',
  purpose: 'Reunião no ministério',
  departureDate: new Date('2026-09-10T00:00:00Z'),
  returnDate: new Date('2026-09-12T00:00:00Z'),
  dailyRate: 350,
  dayCount: 2.5,
  totalAmount: 875,
  sha256Hash: null,
  pdfFileKey: null,
  createdBy: { id: 'issuer-1', firstName: 'Maria', lastName: 'Souza' },
}

/** Emitido: hash publicado, portanto congelado. */
const ISSUED = { ...DRAFT, sha256Hash: 'a'.repeat(64), pdfFileKey: 'org-1/da/x.pdf' }

describe('Diárias de servidor (Task 3.1)', () => {
  beforeEach(() => {
    for (const m of [
      findFirstMock, findManyMock, countMock, createMock, updateMock,
      deleteMock, orgFindUniqueMock, saveFileMock, createPdfMock, auditRecordMock,
    ]) m.mockReset()

    findManyMock.mockResolvedValue([])
    countMock.mockResolvedValue(0)
    createMock.mockResolvedValue(DRAFT)
    updateMock.mockResolvedValue(ISSUED)
    orgFindUniqueMock.mockResolvedValue({ name: 'Prefeitura de Exemplo' })
    saveFileMock.mockResolvedValue('org-1/daily-allowances/x.pdf')
    createPdfMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      sha256Hash: 'b'.repeat(64),
      validationUrl: 'https://exemplo/validar-documento/pub-1',
    })
    auditRecordMock.mockResolvedValue(undefined)
  })

  describe('cálculo do valor', () => {
    test('multiplica valor unitário pela quantidade de diárias', () => {
      expect(calculateTotalAmount(350, 2)).toBe(700)
    })

    test('meia diária é suportada (praxe quando não há pernoite)', () => {
      expect(calculateTotalAmount(350, 2.5)).toBe(875)
    })

    test('arredonda a 2 casas, sem sujeira de ponto flutuante', () => {
      // 0.1 * 3 = 0.30000000000000004 em ponto flutuante.
      expect(calculateTotalAmount(0.1, 3)).toBe(0.3)
      expect(calculateTotalAmount(33.333, 3)).toBe(100)
    })
  })

  describe('criação', () => {
    test('o total é calculado no servidor, não aceito do cliente', async () => {
      await dailyAllowanceService.create(
        {
          beneficiaryName: 'joão da silva',
          destination: 'Brasília/DF',
          purpose: 'Reunião',
          departureDate: new Date('2026-09-10'),
          returnDate: new Date('2026-09-12'),
          dailyRate: 350,
          dayCount: 2,
        },
        SCOPE
      )

      const { data } = createMock.mock.calls[0][0]
      expect(Number(data.totalAmount)).toBe(700)
      // O nome é gravado SEMPRE em caixa alta, qualquer que seja a digitação.
      expect(data.beneficiaryName).toBe('JOÃO DA SILVA')
      // organizationId e emissor vêm do escopo do token.
      expect(data.organizationId).toBe('org-1')
      expect(data.createdById).toBe('issuer-1')
    })

    test('recusa retorno anterior à saída', async () => {
      await expect(
        dailyAllowanceService.create(
          {
            beneficiaryName: 'Fulano',
            destination: 'X',
            purpose: 'Y',
            departureDate: new Date('2026-09-12'),
            returnDate: new Date('2026-09-10'),
            dailyRate: 100,
            dayCount: 1,
          },
          SCOPE
        )
      ).rejects.toThrow(DailyAllowanceError)

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('isolamento multi-tenant', () => {
    test('a listagem sempre filtra pela organização do token', async () => {
      await dailyAllowanceService.list({ page: 1, limit: 20 }, SCOPE)
      expect(findManyMock.mock.calls[0][0].where.organizationId).toBe('org-1')
    })

    test('buscar por id não alcança outra organização', async () => {
      findFirstMock.mockResolvedValue(null)

      await expect(dailyAllowanceService.getById('da-9', SCOPE)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
        id: 'da-9',
        organizationId: 'org-1',
      })
    })
  })

  describe('imutabilidade após a emissão', () => {
    test('rascunho pode ser editado', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      updateMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.update('da-1', { destination: 'Goiânia/GO' }, SCOPE)
      expect(updateMock).toHaveBeenCalledTimes(1)
    })

    test('emitido NÃO pode ser editado', async () => {
      // Editar depois de emitir faria o hash publicado divergir do documento,
      // e o Portal de Validação acusaria adulteração num papel legítimo.
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(
        dailyAllowanceService.update('da-1', { destination: 'Outro' }, SCOPE)
      ).rejects.toMatchObject({ code: 'ALREADY_ISSUED' })

      expect(updateMock).not.toHaveBeenCalled()
    })

    test('emitido NÃO pode ser excluído', async () => {
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(dailyAllowanceService.remove('da-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(deleteMock).not.toHaveBeenCalled()
    })

    test('rascunho pode ser excluído', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      deleteMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.remove('da-1', SCOPE)
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('emissão', () => {
    test('gera o PDF, persiste o arquivo e grava o hash', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(createPdfMock).toHaveBeenCalledTimes(1)
      expect(createPdfMock.mock.calls[0][0]).toMatchObject({
        title: 'RECIBO DE DIÁRIA',
        publicId: 'pub-1',
      })

      expect(saveFileMock).toHaveBeenCalledTimes(1)
      const { data } = updateMock.mock.calls[0][0]
      expect(data.sha256Hash).toBe('b'.repeat(64))
      expect(data.pdfFileKey).toBe('org-1/daily-allowances/x.pdf')
      expect(data.issuedAt).toBeInstanceOf(Date)
    })

    test('registra a emissão na trilha de auditoria', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(auditRecordMock.mock.calls[0][0]).toMatchObject({
        action: 'DAILY_ALLOWANCE_ISSUED',
        resource: 'DAILY_ALLOWANCE',
        organizationId: 'org-1',
      })
    })

    test('não emite duas vezes', async () => {
      // Reemitir criaria um segundo documento com hash diferente para a mesma
      // diária, e o primeiro, já entregue, passaria a ser inválido.
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(dailyAllowanceService.issue('da-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(createPdfMock).not.toHaveBeenCalled()
    })
  })

  describe('download', () => {
    test('recusa download de diária ainda não emitida', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await expect(dailyAllowanceService.getPdf('da-1', SCOPE)).rejects.toMatchObject({
        code: 'NOT_ISSUED',
      })
    })
  })
})
