import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Cadastro de beneficiários — teste de INTEGRAÇÃO.
 *
 * A duplicidade é o cenário CENTRAL aqui, não uma borda: a interface reenvia o
 * nome a cada vez que o campo perde o foco. Só um teste contra o Postgres real
 * prova que a restrição de unicidade dispara e que o serviço a trata — com
 * Prisma mockado, o P2002 seria uma ficção nossa.
 */

const BASE_URL = '/api/v1/beneficiaries'
const MODULE = 'dailyAllowances'

async function setupScenario(permissions = ['dailyAllowances:write', 'dailyAllowances:read']) {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })
  return { organization, session }
}

describe('Beneficiaries (integração)', () => {
  describe('criação e normalização', () => {
    test('grava o nome em CAIXA ALTA', async () => {
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'joão da silva' },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().name).toBe('JOÃO DA SILVA')

      // Confere no banco, não só na resposta.
      const stored = await prisma.beneficiary.findFirst()
      expect(stored?.name).toBe('JOÃO DA SILVA')
    })

    test('colapsa espaços internos e das pontas', async () => {
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: '  maria   das   dores  ' },
      })

      expect(response.json().name).toBe('MARIA DAS DORES')
    })
  })

  describe('duplicidade não é erro', () => {
    test('reenviar o mesmo nome devolve 200 com o registro existente', async () => {
      const { session } = await setupScenario()

      const first = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'João da Silva' },
      })
      expect(first.statusCode).toBe(201)

      const second = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'joão da silva' },
      })

      // Mesma pessoa, grafada de outro jeito: 200 e o MESMO id.
      expect(second.statusCode).toBe(200)
      expect(second.json().id).toBe(first.json().id)

      expect(await prisma.beneficiary.count()).toBe(1)
    })
  })

  describe('isolamento multi-tenant', () => {
    test('cada organização enxerga apenas a própria lista', async () => {
      const first = await setupScenario()
      const second = await setupScenario()

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: first.session.headers,
        payload: { name: 'Servidor da Primeira' },
      })

      const list = await getApp().inject({
        method: 'GET',
        url: BASE_URL,
        headers: second.session.headers,
      })

      expect(list.statusCode).toBe(200)
      expect(list.json()).toHaveLength(0)
    })

    test('duas prefeituras podem cadastrar o MESMO nome', async () => {
      // A unicidade é por organização: servidores homônimos em cidades
      // diferentes são pessoas diferentes.
      const first = await setupScenario()
      const second = await setupScenario()

      const a = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: first.session.headers,
        payload: { name: 'José Silva' },
      })
      const b = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: second.session.headers,
        payload: { name: 'José Silva' },
      })

      expect(a.statusCode).toBe(201)
      expect(b.statusCode).toBe(201)
      expect(a.json().id).not.toBe(b.json().id)
    })

    test('não é possível excluir beneficiário de outra organização', async () => {
      const first = await setupScenario()
      const second = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: first.session.headers,
        payload: { name: 'Alvo' },
      })

      const attempt = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${created.json().id}`,
        headers: second.session.headers,
      })

      expect(attempt.statusCode).toBe(404)
      expect(await prisma.beneficiary.count()).toBe(1)
    })
  })

  describe('exclusão', () => {
    test('remove da lista e responde 204', async () => {
      const { session } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Temporário' },
      })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(204)
      expect(await prisma.beneficiary.count()).toBe(0)
    })

    test('excluir beneficiário NÃO afeta a diária já registrada', async () => {
      // O documento guarda o nome como texto: apagar o cadastro não pode
      // reescrever o histórico de quem viajou.
      const { organization, session } = await setupScenario([
        'dailyAllowances:write',
        'dailyAllowances:read',
      ])

      const beneficiary = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Servidor Viajante' },
      })

      await getApp().inject({
        method: 'POST',
        url: '/api/v1/daily-allowances',
        headers: session.headers,
        payload: {
          beneficiaryName: 'Servidor Viajante',
          destination: 'Brasília/DF',
          purpose: 'Reunião',
          departureDate: '2026-09-10',
          returnDate: '2026-09-12',
          dailyRate: 350,
          dayCount: 2,
        },
      })

      await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${beneficiary.json().id}`,
        headers: session.headers,
      })

      const allowance = await prisma.dailyAllowance.findFirst({
        where: { organizationId: organization.id },
      })
      expect(allowance?.beneficiaryName).toBe('SERVIDOR VIAJANTE')
    })
  })

  describe('proteção da rota', () => {
    test('sem autenticação responde 401', async () => {
      const response = await getApp().inject({ method: 'GET', url: BASE_URL })
      expect(response.statusCode).toBe(401)
    })

    test('sem permissão de escrita não cria', async () => {
      const organization = await createTestOrganization({ modules: [MODULE] })
      const session = await createTestUserWithToken({
        organizationId: organization.id,
        permissions: ['dailyAllowances:read'],
      })

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: { name: 'Qualquer' },
      })

      expect(response.statusCode).toBe(403)
    })
  })
})
