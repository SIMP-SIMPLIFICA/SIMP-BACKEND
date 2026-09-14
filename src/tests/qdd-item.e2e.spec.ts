import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * QDD — teste de INTEGRAÇÃO (Épico 4, Fase 0 do frontend).
 *
 * A unicidade da ficha é o cenário CENTRAL, não uma borda: a tela é editável em
 * linha e reenvia com facilidade. Só contra o Postgres real se prova que a
 * restrição dispara e que o serviço a traduz — com Prisma mockado, o P2002 seria
 * ficção nossa.
 */

// Raiz, não `/api/v1`: acompanha `/departments`, que é o recurso-pai do QDD.
const BASE_URL = '/qdd-items'

async function setupScenario(permissions = ['departments:read', 'departments:write']) {
  const organization = await createTestOrganization({})
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Educação',
      code: `SE${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, department }
}

function payload(departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    departmentId,
    year: 2026,
    ficha: '0042',
    fonte: '1500',
    projetoAtividade: '2.001 - Manutenção da Secretaria',
    naturezaDespesa: '3.3.90.14',
    valorOrcado: 150000,
    ...overrides,
  }
}

describe('QDD (integração)', () => {
  describe('cadastro', () => {
    test('cria a dotação com 201 e devolve o setor junto', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.ficha).toBe('0042')
      expect(body.department.id).toBe(department.id)
      // Decimal chega como string: converter antes de calcular.
      expect(Number(body.valorOrcado)).toBe(150000)
    })

    test('recusa valor orçado zerado', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id, { valorOrcado: 0 }),
      })

      expect(response.statusCode).toBe(400)
    })

    test('recusa exercício implausível', async () => {
      // Um "20266" digitado por engano criaria dotação invisível para sempre.
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

  describe('unicidade da ficha', () => {
    test('ficha repetida no mesmo setor e exercício responde 409', async () => {
      const { session, department } = await setupScenario()

      const first = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })
      expect(first.statusCode).toBe(201)

      const second = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      expect(second.statusCode).toBe(409)
      expect(second.json().error).toBe('DUPLICATE_FICHA')
      expect(second.json().message).toContain('0042')
    })

    test('a MESMA ficha em exercício diferente é permitida', async () => {
      // A ficha se repete de um ano para o outro; é a dupla ficha+exercício que
      // identifica a dotação.
      const { session, department } = await setupScenario()

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id, { year: 2026 }),
      })

      const other = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id, { year: 2027 }),
      })

      expect(other.statusCode).toBe(201)
    })

    test('a MESMA ficha em outro setor é permitida', async () => {
      const { organization, session, department } = await setupScenario()

      const another = await prisma.department.create({
        data: { organizationId: organization.id, name: 'Secretaria de Saúde', code: 'SS9001' },
      })

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      const other = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(another.id),
      })

      expect(other.statusCode).toBe(201)
    })
  })

  describe('isolamento multi-tenant', () => {
    test('não se cadastra dotação no setor de outra organização', async () => {
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

    test('a listagem enxerga apenas as dotações da própria organização', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: mine.session.headers,
        payload: payload(mine.department.id),
      })

      const list = await getApp().inject({
        method: 'GET',
        url: BASE_URL,
        headers: theirs.session.headers,
      })

      expect(list.statusCode).toBe(200)
      expect(list.json()).toHaveLength(0)
    })

    test('não se edita dotação de outra organização', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: mine.session.headers,
        payload: payload(mine.department.id),
      })

      const attempt = await getApp().inject({
        method: 'PATCH',
        url: `${BASE_URL}/${created.json().id}`,
        headers: theirs.session.headers,
        payload: { valorOrcado: 1 },
      })

      expect(attempt.statusCode).toBe(404)
    })
  })

  describe('edição e exclusão', () => {
    test('corrigir a ficha é permitido — é catálogo, não documento', async () => {
      const { session, department } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      const updated = await getApp().inject({
        method: 'PATCH',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
        payload: { valorOrcado: 200000, naturezaDespesa: '3.3.90.30' },
      })

      expect(updated.statusCode).toBe(200)
      expect(Number(updated.json().valorOrcado)).toBe(200000)
      expect(updated.json().naturezaDespesa).toBe('3.3.90.30')
    })

    test('dotação sem uso pode ser excluída', async () => {
      const { session, department } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(204)
      expect(await prisma.qddItem.count()).toBe(0)
    })

    test('dotação que lastreia diária EMITIDA não pode ser excluída', async () => {
      // O vínculo faz parte da prestação de contas: apagá-lo removeria o lastro
      // de uma despesa já documentada.
      const { organization, session, department } = await setupScenario([
        'departments:read',
        'departments:write',
      ])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })
      const qddItemId = created.json().id

      await prisma.dailyAllowance.create({
        data: {
          organizationId: organization.id,
          departmentId: department.id,
          qddItemId,
          beneficiaryName: 'SERVIDOR TESTE',
          createdById: session.user.id,
          destination: 'Brasília/DF',
          purpose: 'Reunião',
          departureDate: new Date('2026-09-10'),
          returnDate: new Date('2026-09-12'),
          dailyRate: 350,
          dayCount: 2,
          totalAmount: 700,
          status: 'ISSUED',
          sha256Hash: 'a'.repeat(64),
        },
      })

      const attempt = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${qddItemId}`,
        headers: session.headers,
      })

      expect(attempt.statusCode).toBe(409)
      expect(attempt.json().error).toBe('IN_USE')
      expect(await prisma.qddItem.count()).toBe(1)
    })

    test('RASCUNHO não impede a exclusão', async () => {
      // Um rascunho ainda pode trocar de ficha; travar por causa dele seria
      // arbitrário.
      const { organization, session, department } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })
      const qddItemId = created.json().id

      await prisma.dailyAllowance.create({
        data: {
          organizationId: organization.id,
          departmentId: department.id,
          qddItemId,
          beneficiaryName: 'SERVIDOR TESTE',
          createdById: session.user.id,
          destination: 'Brasília/DF',
          purpose: 'Reunião',
          departureDate: new Date('2026-09-10'),
          returnDate: new Date('2026-09-12'),
          dailyRate: 350,
          dayCount: 2,
          totalAmount: 700,
        },
      })

      // O rascunho precisa soltar a ficha antes, senão o Restrict do banco
      // barra — é a rede de segurança final funcionando.
      await prisma.dailyAllowance.updateMany({ where: { qddItemId }, data: { qddItemId: null } })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${qddItemId}`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(204)
    })
  })

  describe('proteção da rota', () => {
    test('sem autenticação responde 401', async () => {
      const response = await getApp().inject({ method: 'GET', url: BASE_URL })
      expect(response.statusCode).toBe(401)
    })

    test('somente leitura não cadastra dotação', async () => {
      const { session, department } = await setupScenario(['departments:read'])

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: payload(department.id),
      })

      expect(response.statusCode).toBe(403)
    })
  })
})
