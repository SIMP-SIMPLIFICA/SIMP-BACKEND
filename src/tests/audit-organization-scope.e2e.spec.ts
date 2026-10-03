import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Bug relatado pelo usuário: "Não vejo mais logs dentro do meu sistema."
 *
 * CAUSA RAIZ: dois escritores gravavam na mesma tabela `audit_logs` —
 * `db.createAuditLog` (legado, sem `organizationId` no contrato) e
 * `auditLedgerService.record` (canônico, com `organizationId`). O controller
 * de auditoria filtra por `organizationId` para qualquer usuário que não seja
 * Super Admin. Ações gravadas pelo escritor legado — login, listagem de
 * usuários, papéis, processos virtuais — nunca tinham `organizationId`, e por
 * isso NUNCA apareciam na consulta de um administrador comum, mesmo
 * acabadas de acontecer NA PRÓPRIA organização dele.
 *
 * Este teste reproduz o caminho ponta a ponta: uma ação real (listar
 * usuários, hoje migrada para o escritor canônico) precisa aparecer na
 * consulta da MESMA organização que a executou.
 */

const AUDIT_URL = '/api/v1/audit'
const USERS_URL = '/api/v1/users'

describe('Trilha de Auditoria — escopo por organização (regressão)', () => {
  test('ação de um admin comum aparece na consulta da PRÓPRIA organização', async () => {
    const organization = await createTestOrganization({})
    const session = await createTestUserWithToken({
      organizationId: organization.id,
      permissions: ['audit:read'],
    })

    // Ação real, que grava na trilha — hoje pelo escritor canônico.
    const listed = await getApp().inject({
      method: 'GET',
      url: USERS_URL,
      headers: session.headers,
    })
    expect(listed.statusCode).toBe(200)

    const audit = await getApp().inject({
      method: 'GET',
      url: `${AUDIT_URL}?action=users_listed`,
      headers: session.headers,
    })

    expect(audit.statusCode).toBe(200)
    const body = audit.json()

    // ANTES DA CORREÇÃO: `data` viria vazio aqui, porque o registro gravado
    // por `users_listed` tinha `organizationId: null` e não batia com o
    // filtro `where.organizationId = organization.id` que o controller aplica
    // para qualquer usuário que não seja Super Admin.
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0].action).toBe('users_listed')
    expect(body.data[0].organizationId).toBe(organization.id)
  })

  test('a mesma ação de OUTRA organização não aparece na consulta', async () => {
    // Confirma que o filtro não regrediu para "mostra tudo" ao ser corrigido —
    // isolamento multi-tenant continua valendo.
    const mine = await createTestUserWithToken({
      organizationId: (await createTestOrganization({})).id,
      permissions: ['audit:read'],
    })
    const theirs = await createTestUserWithToken({
      organizationId: (await createTestOrganization({})).id,
      permissions: [],
    })

    await getApp().inject({ method: 'GET', url: USERS_URL, headers: theirs.headers })

    const audit = await getApp().inject({
      method: 'GET',
      url: `${AUDIT_URL}?action=users_listed`,
      headers: mine.headers,
    })

    const fromOtherOrg = audit
      .json()
      .data.some((row: { organizationId: string | null }) => row.organizationId === theirs.user.organizationId)

    expect(fromOtherOrg).toBe(false)
  })

  test('nenhum registro gravado por uma ação autenticada fica com organizationId nulo', async () => {
    // A garantia geral, não só para `users_listed`: é a mesma regressão que
    // atingiu login, papéis e processos virtuais — todos migrados para o
    // mesmo `auditLedgerService.record()` nesta correção.
    const organization = await createTestOrganization({})
    const session = await createTestUserWithToken({
      organizationId: organization.id,
      permissions: [],
    })

    await getApp().inject({ method: 'GET', url: USERS_URL, headers: session.headers })

    const recorded = await prisma.auditLog.findFirst({
      where: { userId: session.user.id, action: 'users_listed' },
      orderBy: { createdAt: 'desc' },
    })

    expect(recorded?.organizationId).toBe(organization.id)
  })
})
