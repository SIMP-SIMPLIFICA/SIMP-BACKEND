import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Portal de Validação Pública (Épico 3, Task 3.3).
 *
 * O foco é o contrato de um endpoint ABERTO: o que ele encontra, o que ele
 * recusa e — sobretudo — o que ele NÃO devolve.
 */

const dailyFindFirstMock = vi.fn()
const fleetFindFirstMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    dailyAllowance: { findFirst: (...a: unknown[]) => dailyFindFirstMock(...a) },
    fleetFueling: { findFirst: (...a: unknown[]) => fleetFindFirstMock(...a) },
  },
}))

const { documentValidationService } = await import('../services/document-validation.service.js')

const PUBLIC_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const ISSUED_DAILY = {
  publicId: PUBLIC_ID,
  sha256Hash: 'a'.repeat(64),
  issuedAt: new Date('2026-09-01T12:00:00Z'),
  organization: { name: 'Prefeitura Municipal de Exemplo' },
}

const ISSUED_FLEET = {
  publicId: PUBLIC_ID,
  sha256Hash: 'b'.repeat(64),
  issuedAt: new Date('2026-09-02T12:00:00Z'),
  organization: { name: 'Prefeitura Municipal de Exemplo' },
}

describe('Validação pública de documentos (Task 3.3)', () => {
  beforeEach(() => {
    dailyFindFirstMock.mockReset().mockResolvedValue(null)
    fleetFindFirstMock.mockReset().mockResolvedValue(null)
  })

  describe('registro de tipos', () => {
    test('cobre diárias e abastecimentos', () => {
      expect(documentValidationService.supportedTypes).toEqual([
        'DAILY_ALLOWANCE',
        'FLEET_FUELING',
      ])
    })
  })

  describe('busca', () => {
    test('encontra uma diária emitida', async () => {
      dailyFindFirstMock.mockResolvedValue(ISSUED_DAILY)

      const result = await documentValidationService.validate(PUBLIC_ID)

      expect(result).toMatchObject({
        type: 'DAILY_ALLOWANCE',
        typeLabel: 'Recibo de Diária',
        sha256Hash: 'a'.repeat(64),
        organization: { name: 'Prefeitura Municipal de Exemplo' },
      })
    })

    test('encontra um abastecimento emitido', async () => {
      fleetFindFirstMock.mockResolvedValue(ISSUED_FLEET)

      const result = await documentValidationService.validate(PUBLIC_ID)

      expect(result).toMatchObject({
        type: 'FLEET_FUELING',
        typeLabel: 'Relatório de Abastecimento',
      })
    })

    test('consulta todas as fontes registradas', async () => {
      await documentValidationService.validate(PUBLIC_ID)

      expect(dailyFindFirstMock).toHaveBeenCalledTimes(1)
      expect(fleetFindFirstMock).toHaveBeenCalledTimes(1)
    })

    test('devolve nulo quando nenhuma fonte tem o identificador', async () => {
      expect(await documentValidationService.validate('inexistente')).toBeNull()
    })
  })

  describe('somente documento EMITIDO é documento', () => {
    test('a consulta exige hash não nulo', async () => {
      // Rascunho já tem publicId, mas não existe como papel. Sem este filtro,
      // um rascunho apareceria ao cidadão como documento válido.
      await documentValidationService.validate(PUBLIC_ID)

      expect(dailyFindFirstMock.mock.calls[0][0].where).toMatchObject({
        publicId: PUBLIC_ID,
        sha256Hash: { not: null },
      })
      expect(fleetFindFirstMock.mock.calls[0][0].where).toMatchObject({
        sha256Hash: { not: null },
      })
    })

    test('registro sem hash é tratado como inexistente (defesa dupla)', async () => {
      // Mesmo que a query deixasse passar, o serviço recusa.
      dailyFindFirstMock.mockResolvedValue({ ...ISSUED_DAILY, sha256Hash: null })

      expect(await documentValidationService.validate(PUBLIC_ID)).toBeNull()
    })
  })

  describe('privacidade do endpoint aberto', () => {
    test('a resposta NÃO carrega dado pessoal nem valores', async () => {
      dailyFindFirstMock.mockResolvedValue(ISSUED_DAILY)

      const result = await documentValidationService.validate(PUBLIC_ID)
      const keys = Object.keys(result ?? {})

      // Expor quem viajou, para onde e por quanto num endpoint sem autenticação
      // seria vazamento de dado pessoal (LGPD).
      expect(keys).toEqual([
        'type',
        'typeLabel',
        'publicId',
        'sha256Hash',
        'issuedAt',
        'organization',
      ])
      expect(JSON.stringify(result)).not.toMatch(/email|cpf|destination|purpose|totalAmount/i)
    })

    test('a consulta seleciona apenas os campos públicos', async () => {
      await documentValidationService.validate(PUBLIC_ID)

      const select = dailyFindFirstMock.mock.calls[0][0].select
      expect(Object.keys(select).sort()).toEqual([
        'issuedAt',
        'organization',
        'publicId',
        'sha256Hash',
      ])
    })

    test('organização ausente não vaza nulo para a interface', async () => {
      dailyFindFirstMock.mockResolvedValue({ ...ISSUED_DAILY, organization: null })

      const result = await documentValidationService.validate(PUBLIC_ID)
      expect(result?.organization.name).toBe('Organização não identificada')
    })
  })
})
