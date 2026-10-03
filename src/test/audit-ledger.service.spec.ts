import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

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

const loggerWarnMock = vi.fn()
const captureMessageMock = vi.fn()

vi.mock('@/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: (...a: unknown[]) => loggerWarnMock(...a), info: vi.fn() },
}))

vi.mock('@/config/sentry.js', () => ({
  Sentry: { captureMessage: (...a: unknown[]) => captureMessageMock(...a) },
}))

const { auditLedgerService } = await import('../services/audit-ledger.service.js')

describe('Serviço de Auditoria — adapter de ledger', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({})
    findManyMock.mockReset().mockResolvedValue([])
    countMock.mockReset().mockResolvedValue(0)
  })

  test('usa o driver local por padrão (ambiente offline)', () => {
    expect(auditLedgerService.driver).toBe('local')
  })

  test('a interface pública não expõe alteração nem remoção', () => {
    // Primeira camada da imutabilidade: sem método, não há como um controller
    // apagar histórico sem editar o serviço. A segunda camada é o trigger no
    // banco (prisma/sql/002-immutable-audit.sql).
    const methods = Object.keys(auditLedgerService)
    expect(methods).not.toContain('update')
    expect(methods).not.toContain('remove')
    expect(methods).not.toContain('delete')
  })

  test('registra a ação mapeando os campos do contrato para a tabela', async () => {
    await auditLedgerService.record({
      userId: 'u-1',
      action: 'ORGANIZATION_SUSPENDED',
      resource: 'ORGANIZATION',
      resourceId: 'org-1',
      ip: '203.0.113.10',
      organizationId: 'org-1',
      details: { reason: 'inadimplencia' },
    })

    expect(createMock).toHaveBeenCalledTimes(1)
    const { data } = createMock.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: 'u-1',
      action: 'ORGANIZATION_SUSPENDED',
      resource: 'ORGANIZATION',
      ipAddress: '203.0.113.10',
      organizationId: 'org-1',
      success: true,
    })
  })

  test('sem IP, registra SYSTEM — a coluna é obrigatória no banco', async () => {
    await auditLedgerService.record({ action: 'JOB_EXECUTED', resource: 'SYSTEM' })
    expect(createMock.mock.calls[0][0].data.ipAddress).toBe('SYSTEM')
  })

  test('o kill switch de auditoria desliga a escrita para QUALQUER chamador', async () => {
    // Único e válido para todos: antes só valia para os escritores legados
    // (db.createAuditLog). Migrá-los para este serviço sem trazer o flag
    // junto teria religado a trilha por engano num ambiente que a desativou
    // de propósito.
    //
    // Mockando `config` diretamente, não a env var: `ENABLE_AUDIT_LOGS=false`
    // como STRING passa por `z.coerce.boolean()`, e `Boolean('false')` é
    // `true` — um quirk conhecido do projeto, e testar via env cairia nele.
    vi.doMock('@/config/config.js', () => ({
      config: {
        features: { auditLogs: false },
        audit: { driver: 'local', qldb: { ledgerName: 'test' } },
      },
    }))
    vi.resetModules()

    const { auditLedgerService: freshService } = await import('../services/audit-ledger.service.js')
    await freshService.record({ action: 'ANY', resource: 'TEST' })

    expect(createMock).not.toHaveBeenCalled()
    vi.doUnmock('@/config/config.js')
  })

  test('falha ao registrar NÃO propaga para o chamador', async () => {
    // Auditoria é efeito colateral: se o registro falhar, a operação de negócio
    // que o usuário pediu não pode ser derrubada por causa disso.
    createMock.mockRejectedValue(new Error('banco fora do ar'))

    await expect(
      auditLedgerService.record({ action: 'ANY', resource: 'TEST' })
    ).resolves.toBeUndefined()
  })

  test('consulta devolve paginação calculada', async () => {
    findManyMock.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    countMock.mockResolvedValue(105)

    const r = await auditLedgerService.query({ page: 2, limit: 50 })

    expect(r.data).toHaveLength(2)
    expect(r.meta).toEqual({ total: 105, page: 2, limit: 50, totalPages: 3 })
  })

  test('consulta aplica o filtro de organização (isolamento multi-tenant)', async () => {
    await auditLedgerService.query({ page: 1, limit: 10, organizationId: 'org-9' })

    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-9' })
  })

  test('consulta ordena do mais recente para o mais antigo', async () => {
    await auditLedgerService.query({ page: 1, limit: 10 })
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })

  test('intervalo de datas vira filtro gte/lte', async () => {
    const startDate = new Date('2026-01-01T00:00:00Z')
    const endDate = new Date('2026-01-31T23:59:59Z')

    await auditLedgerService.query({ page: 1, limit: 10, startDate, endDate })

    expect(findManyMock.mock.calls[0][0].where.createdAt).toEqual({ gte: startDate, lte: endDate })
  })
})

/**
 * `record(data, tx)` — auditoria DENTRO da transação do chamador (decisão D3
 * do Frotas, pré-requisito da TASK 1).
 *
 * Com `tx`, a trilha é parte da operação: grava pelo cliente da transação e,
 * se falhar, a falha sobe para o chamador e desfaz a operação inteira. Sem
 * `tx`, nada muda — os testes do bloco acima continuam valendo como estão.
 */
describe('Serviço de Auditoria — record(data, tx) dentro da transação', () => {
  const txCreateMock = vi.fn()
  const tx = { auditLog: { create: (...a: unknown[]) => txCreateMock(...a) } } as unknown as Prisma.TransactionClient

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({})
    txCreateMock.mockReset().mockResolvedValue({})
  })

  test('com tx, grava pelo cliente da transação e nunca pelo prisma global', async () => {
    await auditLedgerService.record(
      {
        userId: 'u-1',
        action: 'FLEET_AUTHORIZATION_ISSUED',
        resource: 'FLEET_FUELING',
        resourceId: 'ff-1',
        ip: '203.0.113.10',
        organizationId: 'org-1',
        details: { number: '0001/2026' },
      },
      tx
    )

    expect(txCreateMock).toHaveBeenCalledTimes(1)
    expect(createMock).not.toHaveBeenCalled()
    // Mesmo mapeamento de campos do caminho sem transação.
    expect(txCreateMock.mock.calls[0][0].data).toMatchObject({
      userId: 'u-1',
      action: 'FLEET_AUTHORIZATION_ISSUED',
      resource: 'FLEET_FUELING',
      resourceId: 'ff-1',
      ipAddress: '203.0.113.10',
      organizationId: 'org-1',
      metadata: { number: '0001/2026' },
      success: true,
    })
  })

  test('com tx, a falha ao registrar PROPAGA para o chamador', async () => {
    // Oposto deliberado do caminho sem tx: no Frotas, ação sem trilha não pode
    // acontecer. A exceção precisa sair daqui para o $transaction desfazer tudo.
    const failure = new Error('violação de chave estrangeira')
    txCreateMock.mockRejectedValue(failure)

    await expect(
      auditLedgerService.record({ action: 'FLEET_PLATE_MISMATCH', resource: 'FLEET_FUELING' }, tx)
    ).rejects.toBe(failure)
  })

  test('sem tx, a falha continua engolida — chamadas atuais não mudam', async () => {
    createMock.mockRejectedValue(new Error('banco fora do ar'))

    await expect(
      auditLedgerService.record({ action: 'ANY', resource: 'TEST' }, undefined)
    ).resolves.toBeUndefined()
    expect(txCreateMock).not.toHaveBeenCalled()
  })

  /** Serviço recarregado com `ENABLE_AUDIT_LOGS` desligado. */
  async function loadWithKillSwitchOff() {
    vi.doMock('@/config/config.js', () => ({
      config: {
        features: { auditLogs: false },
        audit: { driver: 'local', qldb: { ledgerName: 'test' } },
      },
    }))
    vi.resetModules()
    const { auditLedgerService: freshService } = await import('../services/audit-ledger.service.js')
    vi.doUnmock('@/config/config.js')
    return freshService
  }

  test('o kill switch também vale com tx: nada é gravado (D8)', async () => {
    const freshService = await loadWithKillSwitchOff()
    await expect(freshService.record({ action: 'ANY', resource: 'TEST' }, tx)).resolves.toBeUndefined()

    expect(txCreateMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  test('kill switch desligado + tx: avisa no log e no Sentry, só com ação e recurso (D8)', async () => {
    // O kill switch prevalece, mas a operação do Frotas passaria SEM trilha —
    // isso não pode acontecer em silêncio. Nenhum dado pessoal sai daqui:
    // nem `details`, nem `userId`, nem `ip`, nem `organizationId`.
    loggerWarnMock.mockReset()
    captureMessageMock.mockReset()
    const freshService = await loadWithKillSwitchOff()

    await freshService.record(
      {
        userId: 'u-1',
        action: 'FLEET_AUTHORIZATION_ISSUED',
        resource: 'FLEET_FUELING',
        resourceId: 'ff-1',
        ip: '203.0.113.10',
        organizationId: 'org-1',
        details: { driverCpf: '***.456.789-**' },
      },
      tx
    )

    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
    const [logContext] = loggerWarnMock.mock.calls[0]
    expect(logContext).toEqual({ action: 'FLEET_AUTHORIZATION_ISSUED', resource: 'FLEET_FUELING' })

    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    const [message, context] = captureMessageMock.mock.calls[0]
    expect(typeof message).toBe('string')
    expect(context).toMatchObject({
      level: 'warning',
      tags: { action: 'FLEET_AUTHORIZATION_ISSUED', resource: 'FLEET_FUELING' },
    })

    const everythingSent = JSON.stringify(captureMessageMock.mock.calls) + JSON.stringify(loggerWarnMock.mock.calls)
    for (const personal of ['u-1', 'ff-1', '203.0.113.10', 'org-1', 'driverCpf', '456.789']) {
      expect(everythingSent).not.toContain(personal)
    }
  })

  test('kill switch desligado SEM tx: continua silencioso, como hoje', async () => {
    // Os módulos existentes desligam a trilha de propósito; avisar a cada
    // chamada deles inundaria o log e o Sentry sem informação nova.
    loggerWarnMock.mockReset()
    captureMessageMock.mockReset()
    const freshService = await loadWithKillSwitchOff()

    await freshService.record({ action: 'users_listed', resource: 'USER' })

    expect(loggerWarnMock).not.toHaveBeenCalled()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })
})

describe('Serviço de Auditoria — adaptador QLDB', () => {
  const tx = { auditLog: { create: vi.fn() } } as unknown as Prisma.TransactionClient

  async function loadWithQldbDriver() {
    vi.doMock('@/config/config.js', () => ({
      config: {
        features: { auditLogs: true },
        audit: { driver: 'qldb', qldb: { ledgerName: 'ledger-teste' } },
      },
    }))
    vi.resetModules()
    const { auditLedgerService: qldbService } = await import('../services/audit-ledger.service.js')
    vi.doUnmock('@/config/config.js')
    return qldbService
  }

  test('recusa tx: o QLDB não participa de uma transação do PostgreSQL', async () => {
    // Aceitar o tx em silêncio daria uma garantia falsa: a operação no Postgres
    // poderia ser desfeita depois de o QLDB já ter registrado a ação (ou o
    // contrário). Melhor uma recusa explícita do que um "atômico" que não é.
    const qldbService = await loadWithQldbDriver()
    expect(qldbService.driver).toBe('qldb')

    await expect(
      qldbService.record({ action: 'FLEET_AUTHORIZATION_ISSUED', resource: 'FLEET_FUELING' }, tx)
    ).rejects.toThrow(/transação/)
  })

  test('sem tx, mantém o comportamento atual: falha logada, não propagada', async () => {
    const qldbService = await loadWithQldbDriver()

    await expect(
      qldbService.record({ action: 'ORGANIZATION_SUSPENDED', resource: 'ORGANIZATION' })
    ).resolves.toBeUndefined()
  })
})
