import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Controle de abastecimento de frota (Épico 3, Task 3.2).
 *
 * Prisma, storage e PDF mockados: o alvo aqui são as REGRAS — normalização de
 * placa, isolamento multi-tenant e a imutabilidade após a emissão.
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
    fleetFueling: {
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

const {
  fleetFuelingService,
  normalizeLicensePlate,
  isValidLicensePlate,
  calculatePricePerLiter,
  FleetFuelingError,
} = await import('../services/fleet-fueling.service.js')

const SCOPE = { organizationId: 'org-1', userId: 'user-1' }

const VALID_INPUT = {
  licensePlate: 'ABC1234',
  odometer: 45000,
  liters: 42.5,
  totalValue: 297.5,
  date: new Date('2026-09-01T00:00:00Z'),
}

const DRAFT = {
  id: 'ff-1',
  publicId: 'pub-ff-1',
  organizationId: 'org-1',
  licensePlate: 'ABC1234',
  odometer: 45000,
  liters: 42.5,
  totalValue: 297.5,
  date: new Date('2026-09-01T00:00:00Z'),
  sha256Hash: null,
  pdfFileKey: null,
  createdBy: { id: 'user-1', firstName: 'Carlos', lastName: 'Lima' },
}

const ISSUED = { ...DRAFT, sha256Hash: 'a'.repeat(64), pdfFileKey: 'org-1/ff/x.pdf' }

describe('Abastecimento de frota (Task 3.2)', () => {
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
    saveFileMock.mockResolvedValue('org-1/fleet-fuelings/x.pdf')
    createPdfMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      sha256Hash: 'b'.repeat(64),
      validationUrl: 'https://exemplo/validar-documento/pub-ff-1',
    })
    auditRecordMock.mockResolvedValue(undefined)
  })

  describe('placa', () => {
    test('normaliza caixa, hífen e espaço', () => {
      // Sem isto, o mesmo veículo apareceria como três no relatório por placa.
      expect(normalizeLicensePlate('abc-1234')).toBe('ABC1234')
      expect(normalizeLicensePlate(' ABC 1234 ')).toBe('ABC1234')
      expect(normalizeLicensePlate('abc1d23')).toBe('ABC1D23')
    })

    test('aceita o formato antigo e o Mercosul', () => {
      // A frota municipal tem veículos dos dois períodos.
      expect(isValidLicensePlate('ABC1234')).toBe(true)
      expect(isValidLicensePlate('ABC1D23')).toBe(true)
    })

    test('recusa placas malformadas', () => {
      expect(isValidLicensePlate('AB1234')).toBe(false)
      expect(isValidLicensePlate('ABCD123')).toBe(false)
      expect(isValidLicensePlate('12341234')).toBe(false)
      expect(isValidLicensePlate('')).toBe(false)
    })

    test('a criação grava a placa já normalizada', async () => {
      await fleetFuelingService.create({ ...VALID_INPUT, licensePlate: 'abc-1234' }, SCOPE)
      expect(createMock.mock.calls[0][0].data.licensePlate).toBe('ABC1234')
    })

    test('a criação recusa placa inválida', async () => {
      await expect(
        fleetFuelingService.create({ ...VALID_INPUT, licensePlate: 'XX999' }, SCOPE)
      ).rejects.toMatchObject({ code: 'INVALID_PLATE' })

      expect(createMock).not.toHaveBeenCalled()
    })

    test('o filtro da listagem normaliza a placa buscada', async () => {
      // Buscar "abc-1234" precisa encontrar o registro gravado como "ABC1234".
      await fleetFuelingService.list({ page: 1, limit: 20, licensePlate: 'abc-1234' }, SCOPE)
      expect(findManyMock.mock.calls[0][0].where.licensePlate).toBe('ABC1234')
    })
  })

  describe('preço por litro', () => {
    test('divide o total pelos litros', () => {
      expect(calculatePricePerLiter(297.5, 42.5)).toBe(7)
    })

    test('arredonda a 3 casas', () => {
      expect(calculatePricePerLiter(100, 3)).toBe(33.333)
    })

    test('litros zero não gera divisão por zero', () => {
      expect(calculatePricePerLiter(100, 0)).toBe(0)
    })
  })

  describe('isolamento multi-tenant', () => {
    test('a listagem sempre filtra pela organização do token', async () => {
      await fleetFuelingService.list({ page: 1, limit: 20 }, SCOPE)
      expect(findManyMock.mock.calls[0][0].where.organizationId).toBe('org-1')
    })

    test('buscar por id não alcança outra organização', async () => {
      findFirstMock.mockResolvedValue(null)

      await expect(fleetFuelingService.getById('ff-9', SCOPE)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
        id: 'ff-9',
        organizationId: 'org-1',
      })
    })

    test('o registro guarda o autor vindo do token', async () => {
      await fleetFuelingService.create(VALID_INPUT, SCOPE)
      const { data } = createMock.mock.calls[0][0]
      expect(data.organizationId).toBe('org-1')
      expect(data.createdById).toBe('user-1')
    })
  })

  describe('imutabilidade após a emissão', () => {
    test('rascunho pode ser editado', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      updateMock.mockResolvedValue(DRAFT)

      await fleetFuelingService.update('ff-1', { odometer: 46000 }, SCOPE)
      expect(updateMock).toHaveBeenCalledTimes(1)
    })

    test('emitido NÃO pode ser editado (409)', async () => {
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(
        fleetFuelingService.update('ff-1', { odometer: 99999 }, SCOPE)
      ).rejects.toMatchObject({ code: 'ALREADY_ISSUED' })

      expect(updateMock).not.toHaveBeenCalled()
    })

    test('emitido NÃO pode ser excluído (409)', async () => {
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(fleetFuelingService.remove('ff-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(deleteMock).not.toHaveBeenCalled()
    })

    test('rascunho pode ser excluído', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      deleteMock.mockResolvedValue(DRAFT)

      await fleetFuelingService.remove('ff-1', SCOPE)
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('emissão', () => {
    test('gera o relatório, persiste o arquivo e grava o hash', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await fleetFuelingService.issue('ff-1', SCOPE)

      expect(createPdfMock.mock.calls[0][0]).toMatchObject({
        title: 'RELATÓRIO DE ABASTECIMENTO',
        publicId: 'pub-ff-1',
      })

      const { data } = updateMock.mock.calls[0][0]
      expect(data.sha256Hash).toBe('b'.repeat(64))
      expect(data.pdfFileKey).toBe('org-1/fleet-fuelings/x.pdf')
      expect(data.issuedAt).toBeInstanceOf(Date)
    })

    test('o PDF traz a placa formatada para leitura humana', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await fleetFuelingService.issue('ff-1', SCOPE)

      const sections = createPdfMock.mock.calls[0][0].sections
      const plate = sections[0].fields.find((f: { label: string }) => f.label === 'Placa')
      expect(plate.value).toBe('ABC-1234')
    })

    test('registra a emissão na trilha de auditoria', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await fleetFuelingService.issue('ff-1', SCOPE)

      expect(auditRecordMock.mock.calls[0][0]).toMatchObject({
        action: 'FLEET_FUELING_ISSUED',
        resource: 'FLEET_FUELING',
        organizationId: 'org-1',
      })
    })

    test('não emite duas vezes', async () => {
      // Reemitir geraria um segundo hash e invalidaria o comprovante já entregue.
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(fleetFuelingService.issue('ff-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(createPdfMock).not.toHaveBeenCalled()
    })
  })

  describe('download', () => {
    test('recusa download de abastecimento ainda não emitido', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await expect(fleetFuelingService.getPdf('ff-1', SCOPE)).rejects.toMatchObject({
        code: 'NOT_ISSUED',
      })
    })
  })

  test('o erro de domínio é da classe esperada', async () => {
    findFirstMock.mockResolvedValue(null)
    await expect(fleetFuelingService.getById('x', SCOPE)).rejects.toBeInstanceOf(FleetFuelingError)
  })
})
