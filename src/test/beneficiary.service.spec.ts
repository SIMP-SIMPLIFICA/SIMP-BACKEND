import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Cadastro de beneficiários de diárias.
 *
 * O foco é a normalização do nome e o tratamento da duplicidade — que é o
 * caminho NORMAL desta rota, não a exceção: a interface tenta criar o nome a
 * cada vez que o campo perde o foco.
 */

const createMock = vi.fn()
const findManyMock = vi.fn()
const findFirstMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    beneficiary: {
      create: (...a: unknown[]) => createMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
      findFirst: (...a: unknown[]) => findFirstMock(...a),
      delete: (...a: unknown[]) => deleteMock(...a),
    },
  },
}))

const { beneficiaryService, normalizeBeneficiaryName, BeneficiaryError } = await import(
  '../services/beneficiary.service.js'
)

const SCOPE = { organizationId: 'org-1', userId: 'user-1' }

const EXISTING = { id: 'b-1', name: 'JOÃO DA SILVA', createdAt: new Date() }

/** Erro de violação de unicidade, como o Prisma o emite. */
function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

describe('Cadastro de beneficiários', () => {
  beforeEach(() => {
    for (const m of [createMock, findManyMock, findFirstMock, deleteMock]) m.mockReset()
    findManyMock.mockResolvedValue([])
    createMock.mockResolvedValue(EXISTING)
    findFirstMock.mockResolvedValue(EXISTING)
    deleteMock.mockResolvedValue(EXISTING)
  })

  describe('normalização do nome', () => {
    test('grava sempre em caixa alta', () => {
      expect(normalizeBeneficiaryName('joão da silva')).toBe('JOÃO DA SILVA')
    })

    test('remove espaços das pontas', () => {
      expect(normalizeBeneficiaryName('  Maria Souza  ')).toBe('MARIA SOUZA')
    })

    test('colapsa espaços internos', () => {
      // Sem isto, "JOÃO  SILVA" e "JOÃO SILVA" seriam pessoas diferentes para a
      // restrição de unicidade — exatamente o que ela deveria impedir.
      expect(normalizeBeneficiaryName('João   da    Silva')).toBe('JOÃO DA SILVA')
    })

    test('preserva a acentuação', () => {
      expect(normalizeBeneficiaryName('conceição')).toBe('CONCEIÇÃO')
    })

    test('a criação grava o nome já normalizado', async () => {
      await beneficiaryService.create('  joão   da silva ', SCOPE)
      expect(createMock.mock.calls[0][0].data.name).toBe('JOÃO DA SILVA')
    })

    test('nome só de espaços é recusado', async () => {
      await expect(beneficiaryService.create('   ', SCOPE)).rejects.toMatchObject({
        code: 'INVALID_NAME',
      })
      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('duplicidade é caminho normal, não erro', () => {
    test('nome repetido devolve o registro existente, sem lançar', async () => {
      createMock.mockRejectedValue(duplicateError())

      const result = await beneficiaryService.create('João da Silva', SCOPE)

      expect(result.beneficiary).toEqual(EXISTING)
      expect(result.created).toBe(false)
    })

    test('a busca do existente respeita a organização', async () => {
      createMock.mockRejectedValue(duplicateError())

      await beneficiaryService.create('João da Silva', SCOPE)

      expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
        name: 'JOÃO DA SILVA',
        organizationId: 'org-1',
      })
    })

    test('criação inédita sinaliza created=true', async () => {
      const result = await beneficiaryService.create('Novo Nome', SCOPE)
      expect(result.created).toBe(true)
    })

    test('erro que NÃO é duplicidade continua propagando', async () => {
      // Engolir qualquer erro esconderia falha real de banco.
      createMock.mockRejectedValue(new Error('conexão perdida'))

      await expect(beneficiaryService.create('Fulano', SCOPE)).rejects.toThrow(
        'conexão perdida'
      )
    })

    test('duplicidade sem registro recuperável não vira sucesso silencioso', async () => {
      createMock.mockRejectedValue(duplicateError())
      findFirstMock.mockResolvedValue(null)

      await expect(beneficiaryService.create('Fulano', SCOPE)).rejects.toBeInstanceOf(
        BeneficiaryError
      )
    })
  })

  describe('isolamento multi-tenant', () => {
    test('a listagem filtra pela organização do token', async () => {
      await beneficiaryService.list(SCOPE)
      expect(findManyMock.mock.calls[0][0].where.organizationId).toBe('org-1')
    })

    test('a criação grava na organização do token', async () => {
      await beneficiaryService.create('Fulano', SCOPE)
      expect(createMock.mock.calls[0][0].data.organizationId).toBe('org-1')
    })

    test('excluir registro de outra organização responde não encontrado', async () => {
      findFirstMock.mockResolvedValue(null)

      await expect(beneficiaryService.remove('b-9', SCOPE)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      expect(deleteMock).not.toHaveBeenCalled()
    })

    test('a exclusão confere a organização antes de apagar', async () => {
      await beneficiaryService.remove('b-1', SCOPE)

      expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
        id: 'b-1',
        organizationId: 'org-1',
      })
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('busca por trecho do nome', () => {
    test('a busca ignora a caixa das letras', async () => {
      // O usuário digita minúsculo; o banco guarda em caixa alta.
      await beneficiaryService.list(SCOPE, 'joão')

      expect(findManyMock.mock.calls[0][0].where.name).toMatchObject({
        contains: 'joão',
        mode: 'insensitive',
      })
    })

    test('busca vazia não vira filtro', async () => {
      await beneficiaryService.list(SCOPE, '   ')
      expect(findManyMock.mock.calls[0][0].where.name).toBeUndefined()
    })

    test('a listagem sai em ordem alfabética', async () => {
      await beneficiaryService.list(SCOPE)
      expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ name: 'asc' })
    })
  })
})
