import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Alerta de vencimento de convênio (Épico 8, FR-023/FR-024).
 *
 * Testa o CORPO do job (`runCovenantExpiryCheck`), exportado separado do
 * `cron.schedule` de propósito: agendador não se testa em unidade, regra de
 * negócio sim.
 */

const covenantFindManyMock = vi.fn()
const notificationFindFirstMock = vi.fn()
const userFindManyMock = vi.fn()
const notifyManyMock = vi.fn()
const getUsersWithPermissionMock = vi.fn()

vi.mock('@/lib/prisma.js', () => ({
  prisma: {
    covenant: { findMany: (...a: unknown[]) => covenantFindManyMock(...a) },
    notification: { findFirst: (...a: unknown[]) => notificationFindFirstMock(...a) },
    user: { findMany: (...a: unknown[]) => userFindManyMock(...a) },
  },
}))

vi.mock('@/services/notification.service.js', () => ({
  notificationService: { notifyMany: (...a: unknown[]) => notifyManyMock(...a) },
}))

vi.mock('@/services/rbac.service.js', () => ({
  getUsersWithPermission: (...a: unknown[]) => getUsersWithPermissionMock(...a),
}))

const { runCovenantExpiryCheck } = await import('./covenant-expiry-alert.job.js')

const NOW = new Date('2026-09-15T00:00:00Z')

function covenant(overrides: Partial<{ id: string; number: string; validityEndDate: Date | null; managerId: string | null }> = {}) {
  return {
    id: overrides.id ?? 'covenant-1',
    number: overrides.number ?? '001/2026',
    organizationId: 'org-1',
    validityEndDate: overrides.validityEndDate === undefined ? new Date('2026-11-14T00:00:00Z') : overrides.validityEndDate,
    department: { managerId: overrides.managerId ?? null },
  }
}

describe('Alerta de vencimento de convênio (Épico 8)', () => {
  beforeEach(() => {
    for (const m of [
      covenantFindManyMock, notificationFindFirstMock, userFindManyMock,
      notifyManyMock, getUsersWithPermissionMock,
    ]) m.mockReset()

    notificationFindFirstMock.mockResolvedValue(null)
    userFindManyMock.mockResolvedValue([{ id: 'user-1' }])
    getUsersWithPermissionMock.mockResolvedValue(new Set(['user-1']))
    notifyManyMock.mockResolvedValue(undefined)
  })

  test('convênio a exatos 60 dias do vencimento é notificado', async () => {
    // 15/set + 60 dias = 14/nov.
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-11-14T00:00:00Z') })])

    await runCovenantExpiryCheck(NOW)

    expect(notifyManyMock).toHaveBeenCalledTimes(1)
    expect(notifyManyMock.mock.calls[0][1]).toMatchObject({
      type: 'COVENANT_EXPIRING_60',
      entityId: 'covenant-1',
    })
  })

  test('convênio a exatos 30 dias do vencimento é notificado', async () => {
    // 15/set + 30 dias = 15/out.
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-10-15T00:00:00Z') })])

    await runCovenantExpiryCheck(NOW)

    expect(notifyManyMock.mock.calls[0][1]).toMatchObject({ type: 'COVENANT_EXPIRING_30' })
  })

  test('convênio fora das janelas de 60/30 dias não gera notificação', async () => {
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-11-01T00:00:00Z') })])

    await runCovenantExpiryCheck(NOW)

    expect(notifyManyMock).not.toHaveBeenCalled()
  })

  test('convênio sem validityEndDate é ignorado, sem erro', async () => {
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: null })])

    await expect(runCovenantExpiryCheck(NOW)).resolves.not.toThrow()
    expect(notifyManyMock).not.toHaveBeenCalled()
  })

  test('dedupe: já notificado nesta janela não notifica de novo', async () => {
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-11-14T00:00:00Z') })])
    notificationFindFirstMock.mockResolvedValue({ id: 'existing-notification' })

    await runCovenantExpiryCheck(NOW)

    expect(notifyManyMock).not.toHaveBeenCalled()
  })

  test('rodar duas vezes seguidas não duplica — a segunda vez já encontra a notificação da primeira', async () => {
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-11-14T00:00:00Z') })])

    await runCovenantExpiryCheck(NOW)
    expect(notifyManyMock).toHaveBeenCalledTimes(1)

    // Segunda execução: simula que a notificação da primeira já está no banco.
    notificationFindFirstMock.mockResolvedValue({ id: 'da-primeira-rodada' })
    await runCovenantExpiryCheck(NOW)

    expect(notifyManyMock).toHaveBeenCalledTimes(1)
  })

  test('destinatários somam o gestor do departamento e quem tem covenants:write', async () => {
    covenantFindManyMock.mockResolvedValue([
      covenant({ validityEndDate: new Date('2026-11-14T00:00:00Z'), managerId: 'manager-1' }),
    ])
    userFindManyMock.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }])
    getUsersWithPermissionMock.mockResolvedValue(new Set(['user-2']))

    await runCovenantExpiryCheck(NOW)

    const recipients = notifyManyMock.mock.calls[0][0] as string[]
    expect(recipients.sort()).toEqual(['manager-1', 'user-2'])
  })

  test('sem nenhum destinatário, não notifica e não lança erro', async () => {
    covenantFindManyMock.mockResolvedValue([covenant({ validityEndDate: new Date('2026-11-14T00:00:00Z') })])
    userFindManyMock.mockResolvedValue([])
    getUsersWithPermissionMock.mockResolvedValue(new Set())

    await expect(runCovenantExpiryCheck(NOW)).resolves.not.toThrow()
    expect(notifyManyMock).not.toHaveBeenCalled()
  })
})
