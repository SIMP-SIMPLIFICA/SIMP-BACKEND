import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Contas Bancárias (Épico 8, FR-015/FR-016/FR-018) — teste de INTEGRAÇÃO.
 *
 * O que precisa do Postgres real, e não de um mock: a coluna `department_id`
 * NOT NULL recusando a ausência de departamento, e o `onDelete: Restrict`
 * (mais a checagem explícita em `department.controller.ts`) recusando excluir
 * um departamento com conta vinculada.
 */

const BASE_URL = '/finance/accounts'

async function setupScenario(permissions: string[] = []) {
  const organization = await createTestOrganization({ modules: ['finance'] })
  // Rotas de conta bancária não têm `requirePermission` — só autenticação e
  // módulo habilitado (ver finance.routes.ts). Permissões vazias bastam, salvo
  // quando o cenário também precisa excluir departamento (ver describe abaixo).
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Fazenda',
      code: `SF${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, department }
}

describe('Contas Bancárias (integração, Épico 8)', () => {
  describe('departamento obrigatório (FR-015)', () => {
    test('recusa criar conta sem departamento', async () => {
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Conta Corrente Sicredi' },
      })

      expect(response.statusCode).toBe(400)
      expect(await prisma.bankAccount.count()).toBe(0)
    })

    test('recusa departamento de outra organização', async () => {
      const { session } = await setupScenario()
      const { department: foreignDepartment } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Conta Corrente Sicredi', departmentId: foreignDepartment.id },
      })

      expect(response.statusCode).toBe(400)
    })

    test('cria a conta com departamento válido', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Conta Corrente Sicredi', departmentId: department.id },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().departmentId).toBe(department.id)
    })
  })

  describe('saldo inicial travado no servidor (FR-016)', () => {
    test('initialBalanceCents forjado no payload é ignorado — a conta nasce com 0', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        // O DTO não aceita este campo — mesmo assim tentamos, como faria uma
        // requisição direta à API contornando a tela.
        payload: { name: 'Conta Fraudada', departmentId: department.id, initialBalanceCents: 999_999 },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().initialBalanceCents).toBe(0)

      const stored = await prisma.bankAccount.findUnique({ where: { id: response.json().id } })
      expect(stored?.initialBalanceCents).toBe(0)
    })

    test('atualizar a conta enviando initialBalanceCents também não move o valor', async () => {
      const { session, department } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Conta Corrente Sicredi', departmentId: department.id },
      })

      const updated = await getApp().inject({
        method: 'PUT',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
        payload: { initialBalanceCents: 500_000 },
      })

      expect(updated.statusCode).toBe(200)
      expect(updated.json().initialBalanceCents).toBe(0)
    })
  })

  describe('exclusão de departamento com conta vinculada (FR-018)', () => {
    test('recusa excluir departamento com conta bancária vinculada', async () => {
      const { session, department } = await setupScenario(['departments:read', 'departments:delete'])

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Conta Corrente Sicredi', departmentId: department.id },
      })

      const response = await getApp().inject({
        method: 'DELETE',
        url: `/departments/${department.id}`,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(409)
      expect(await prisma.department.count({ where: { id: department.id } })).toBe(1)
    })
  })
})
