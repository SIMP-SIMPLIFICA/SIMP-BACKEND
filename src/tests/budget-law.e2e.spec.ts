import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Leis Orçamentárias — LOA, PPA, LDO — teste de INTEGRAÇÃO (Épico 4, Fase 2).
 *
 * O UPSERT é o cenário central: a tela apresenta um card por tipo e o usuário
 * só preenche ou corrige, sem noção de "criar" versus "editar". Só contra o
 * Postgres real se prova que reenviar o mesmo (setor, tipo, exercício) atualiza
 * em vez de duplicar.
 */

// Raiz, não `/api/v1`: acompanha `/departments` e `/qdd-items`.
const BASE_URL = '/budget-laws'

async function setupScenario(permissions = ['departments:read', 'departments:write']) {
  const organization = await createTestOrganization({})
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Planejamento',
      code: `SP${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, department }
}

function payload(departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    departmentId,
    type: 'LOA',
    year: 2026,
    lawNumber: '1.234/2025',
    publishedAt: '2025-12-15',
    details: 'Orçamento anual aprovado em sessão ordinária.',
    ...overrides,
  }
}

describe('Leis Orçamentárias (integração)', () => {
  describe('upsert', () => {
    test('cria com 200 e devolve o setor junto', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.type).toBe('LOA')
      expect(body.lawNumber).toBe('1.234/2025')
      expect(body.department.id).toBe(department.id)
    })

    test('reenviar o MESMO tipo e exercício ATUALIZA, não duplica', async () => {
      const { session, department } = await setupScenario()

      const first = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      const second = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id, { lawNumber: '1.234/2025 (Emenda 1)' }),
      })

      expect(second.statusCode).toBe(200)
      expect(second.json().id).toBe(first.json().id)
      expect(second.json().lawNumber).toBe('1.234/2025 (Emenda 1)')

      const count = await prisma.budgetLaw.count({ where: { departmentId: department.id } })
      expect(count).toBe(1)
    })

    test('PPA e LDO do mesmo exercício convivem, sem colidir com a LOA', async () => {
      const { session, department } = await setupScenario()

      const loa = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id, { type: 'LOA' }),
      })
      const ppa = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id, { type: 'PPA' }),
      })
      const ldo = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id, { type: 'LDO' }),
      })

      expect([loa, ppa, ldo].map(r => r.statusCode)).toEqual([200, 200, 200])
      expect(await prisma.budgetLaw.count({ where: { departmentId: department.id } })).toBe(3)
    })

    test('a MESMA lei em exercício diferente é um registro novo', async () => {
      const { session, department } = await setupScenario()

      await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id, { year: 2026 }),
      })
      const other = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id, { year: 2027 }),
      })

      expect(other.statusCode).toBe(200)
      expect(await prisma.budgetLaw.count({ where: { departmentId: department.id } })).toBe(2)
    })

    test('departamento de outra organização é recusado', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: mine.session.headers,
        payload: payload(theirs.department.id),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('INVALID_DEPARTMENT')
    })

    test('exercício implausível é recusado', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id, { year: 20266 }),
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('isolamento multi-tenant', () => {
    test('a listagem enxerga só as leis da própria organização', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()

      await getApp().inject({
        method: 'POST', url: BASE_URL, headers: mine.session.headers,
        payload: payload(mine.department.id),
      })

      const list = await getApp().inject({
        method: 'GET',
        url: BASE_URL,
        headers: theirs.session.headers,
      })

      expect(list.json()).toHaveLength(0)
    })
  })

  describe('exclusão', () => {
    test('remove com 204', async () => {
      const { session, department } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id),
      })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(204)
      expect(await prisma.budgetLaw.count()).toBe(0)
    })

    test('não se exclui lei de outra organização', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()

      const created = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: mine.session.headers,
        payload: payload(mine.department.id),
      })

      const attempt = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${created.json().id}`,
        headers: theirs.session.headers,
      })

      expect(attempt.statusCode).toBe(404)
    })
  })

  describe('proteção da rota', () => {
    test('sem autenticação responde 401', async () => {
      const response = await getApp().inject({ method: 'GET', url: BASE_URL })
      expect(response.statusCode).toBe(401)
    })

    test('somente leitura não grava', async () => {
      const { session, department } = await setupScenario(['departments:read'])

      const response = await getApp().inject({
        method: 'POST', url: BASE_URL, headers: session.headers,
        payload: payload(department.id),
      })

      expect(response.statusCode).toBe(403)
    })
  })
})
