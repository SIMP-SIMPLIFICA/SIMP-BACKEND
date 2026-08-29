import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Serviço de Auditoria — Adapter de ledger (Épico 2, Task 2.1).
 *
 * O Prisma é mockado: estes testes exercitam o CONTRATO do adapter (o que é
 * gravado, o que é consultado e o que acontece quando falha), não o banco.
 */

const createMock = vi.fn()
const findManyMock = vi.fn()
const countMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: (...a: unknown[]) => createMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
      count: (...a: unknown[]) => countMock(...a),
    },
  },
}))

vi.mock('@/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const { auditoriaService } = await import('../services/auditoria.service.js')

describe('Serviço de Auditoria — adapter de ledger', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({})
    findManyMock.mockReset().mockResolvedValue([])
    countMock.mockReset().mockResolvedValue(0)
  })

  test('usa o driver local por padrão (ambiente offline)', () => {
    expect(auditoriaService.driver).toBe('local')
  })

  test('a interface pública não expõe alteração nem remoção', () => {
    // Primeira camada da imutabilidade: sem método, não há como um controller
    // apagar histórico sem editar o serviço. A segunda camada é o trigger no
    // banco (prisma/sql/002-auditoria-imutavel.sql).
    const metodos = Object.keys(auditoriaService)
    expect(metodos).not.toContain('atualizar')
    expect(metodos).not.toContain('remover')
    expect(metodos).not.toContain('excluir')
  })

  test('registra a ação mapeando os campos pt-BR para a tabela', async () => {
    await auditoriaService.registrar({
      usuarioId: 'u-1',
      acao: 'SUSPENDEU_ORGANIZACAO',
      recurso: 'ORGANIZATION',
      recursoId: 'org-1',
      ip: '203.0.113.10',
      organizacaoId: 'org-1',
      detalhes: { motivo: 'inadimplencia' },
    })

    expect(createMock).toHaveBeenCalledTimes(1)
    const { data } = createMock.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: 'u-1',
      action: 'SUSPENDEU_ORGANIZACAO',
      resource: 'ORGANIZATION',
      ipAddress: '203.0.113.10',
      organizationId: 'org-1',
      success: true,
    })
  })

  test('sem IP, registra SISTEMA — a coluna é obrigatória no banco', async () => {
    await auditoriaService.registrar({ acao: 'JOB_EXECUTADO', recurso: 'SISTEMA' })
    expect(createMock.mock.calls[0][0].data.ipAddress).toBe('SISTEMA')
  })

  test('falha ao registrar NÃO propaga para o chamador', async () => {
    // Auditoria é efeito colateral: se o registro falhar, a operação de negócio
    // que o usuário pediu não pode ser derrubada por causa disso.
    createMock.mockRejectedValue(new Error('banco fora do ar'))

    await expect(
      auditoriaService.registrar({ acao: 'QUALQUER', recurso: 'TESTE' })
    ).resolves.toBeUndefined()
  })

  test('consulta devolve paginação calculada', async () => {
    findManyMock.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    countMock.mockResolvedValue(105)

    const r = await auditoriaService.consultar({ pagina: 2, limite: 50 })

    expect(r.dados).toHaveLength(2)
    expect(r.meta).toEqual({ total: 105, pagina: 2, limite: 50, totalPaginas: 3 })
  })

  test('consulta aplica o filtro de organização (isolamento multi-tenant)', async () => {
    await auditoriaService.consultar({ pagina: 1, limite: 10, organizacaoId: 'org-9' })

    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-9' })
  })

  test('consulta ordena do mais recente para o mais antigo', async () => {
    await auditoriaService.consultar({ pagina: 1, limite: 10 })
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })

  test('intervalo de datas vira filtro gte/lte', async () => {
    const inicio = new Date('2026-01-01T00:00:00Z')
    const fim = new Date('2026-01-31T23:59:59Z')

    await auditoriaService.consultar({ pagina: 1, limite: 10, dataInicio: inicio, dataFim: fim })

    expect(findManyMock.mock.calls[0][0].where.createdAt).toEqual({ gte: inicio, lte: fim })
  })
})
