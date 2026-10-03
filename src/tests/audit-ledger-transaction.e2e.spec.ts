import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { createTestOrganization } from './e2e-auth-helper.js'
import { prisma } from './setup-e2e.js'

/**
 * Auditoria transacional — `auditLedgerService.record(data, tx)` (decisão D3
 * do Frotas, pré-requisito da TASK 1).
 *
 * Prova, contra o PostgreSQL real, que a trilha passou a fazer parte da
 * operação: se a auditoria falha, a escrita auditada é desfeita; se a
 * operação falha depois da auditoria, o registro de auditoria também some.
 *
 * Nada é mockado. A falha de auditoria é provocada pelo próprio banco: um
 * `organizationId` inexistente viola a chave estrangeira de `audit_logs`
 * (P2003) — o mesmo tipo de erro que derrubaria um registro real.
 */

const ACTION = 'E2E_TRANSACTIONAL_WRITE'

/** Escrita de negócio qualquer, dentro da transação: um departamento. */
function departmentData(organizationId: string) {
  return {
    organizationId,
    name: 'Secretaria Auditada',
    code: `AUD${randomUUID().slice(0, 8).toUpperCase()}`,
  }
}

describe('Auditoria transacional — record(data, tx)', () => {
  test('auditoria falha → a escrita de negócio é desfeita', async () => {
    const organization = await createTestOrganization({})
    const data = departmentData(organization.id)

    const attempt = prisma.$transaction(async tx => {
      const department = await tx.department.create({ data })

      await auditLedgerService.record(
        {
          action: ACTION,
          resource: 'DEPARTMENT',
          resourceId: department.id,
          // Organização inexistente: o banco recusa pela chave estrangeira.
          organizationId: `org-inexistente-${randomUUID()}`,
        },
        tx
      )

      return department
    })

    await expect(attempt).rejects.toMatchObject({ code: 'P2003' })

    // O departamento foi criado DENTRO da transação, antes da auditoria —
    // e não sobreviveu à falha dela.
    expect(await prisma.department.count({ where: { code: data.code } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: ACTION } })).toBe(0)
  })

  test('auditoria ok → escrita e registro são confirmados juntos', async () => {
    const organization = await createTestOrganization({})
    const data = departmentData(organization.id)

    const department = await prisma.$transaction(async tx => {
      const created = await tx.department.create({ data })
      await auditLedgerService.record(
        { action: ACTION, resource: 'DEPARTMENT', resourceId: created.id, organizationId: organization.id },
        tx
      )
      return created
    })

    expect(await prisma.department.count({ where: { id: department.id } })).toBe(1)

    const recorded = await prisma.auditLog.findMany({ where: { action: ACTION, resourceId: department.id } })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].organizationId).toBe(organization.id)
  })

  test('operação falha depois da auditoria → o registro de auditoria também é desfeito', async () => {
    // Prova o outro lado da atomicidade: a trilha nunca afirma uma ação que
    // não aconteceu. Sem o `tx`, o registro já estaria gravado fora da
    // transação e sobreviveria ao rollback.
    const organization = await createTestOrganization({})
    const resourceId = `rollback-${randomUUID()}`

    const attempt = prisma.$transaction(async tx => {
      await auditLedgerService.record(
        { action: ACTION, resource: 'DEPARTMENT', resourceId, organizationId: organization.id },
        tx
      )
      throw new Error('regra de negócio violada depois da auditoria')
    })

    await expect(attempt).rejects.toThrow('regra de negócio violada')
    expect(await prisma.auditLog.count({ where: { resourceId } })).toBe(0)
  })

  test('sem tx, o comportamento antigo continua: falha engolida, escrita mantida', async () => {
    // Regressão: os ~40 chamadores atuais não passam `tx` e não podem ter uma
    // operação derrubada por falha de auditoria.
    const organization = await createTestOrganization({})
    const department = await prisma.department.create({ data: departmentData(organization.id) })

    await expect(
      auditLedgerService.record({
        action: ACTION,
        resource: 'DEPARTMENT',
        resourceId: department.id,
        organizationId: `org-inexistente-${randomUUID()}`,
      })
    ).resolves.toBeUndefined()

    expect(await prisma.department.count({ where: { id: department.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { resourceId: department.id } })).toBe(0)
  })
})
