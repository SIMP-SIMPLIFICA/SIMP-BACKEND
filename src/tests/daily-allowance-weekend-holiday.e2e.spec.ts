import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Alerta de fim de semana/feriado na Diária — regra do TCE (Épico 8,
 * FR-020 a FR-022) — teste de INTEGRAÇÃO.
 *
 * O que precisa do Postgres real: a checagem lê `Holiday` de verdade
 * (`holidayService.getHolidaysInRange`), não um mock — é o único jeito de
 * provar que a consulta por intervalo de data realmente encontra a linha.
 */

const BASE_URL = '/api/v1/daily-allowances'
const HOLIDAYS_URL = '/holidays'
const MODULE = 'dailyAllowances'

async function setupScenario() {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions: ['dailyAllowances:read', 'dailyAllowances:write', 'dailyAllowances:issue'],
  })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Teste',
      code: `ST${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, department }
}

function draftPayload(departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    departmentId,
    beneficiaryName: 'joão da silva',
    destination: 'Brasília/DF',
    purpose: 'Reunião no ministério',
    departureDate: '2026-09-14', // segunda
    returnDate: '2026-09-16', // quarta — dias úteis, por padrão
    dailyRate: 350,
    dayCount: 2,
    ...overrides,
  }
}

describe('Alerta de fim de semana/feriado na Diária (integração, Épico 8)', () => {
  test('período em dias úteis emite sem exigir justificativa', async () => {
    const { session, department } = await setupScenario()

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: draftPayload(department.id),
    })
    expect(created.statusCode).toBe(201)

    const issued = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })

    expect(issued.statusCode).toBe(200)
  })

  test('período que cruza sábado é recusado sem justificativa e aceito com ela', async () => {
    const { session, department } = await setupScenario()

    // Quinta (10/set) a sábado (12/set).
    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: draftPayload(department.id, { departureDate: '2026-09-10', returnDate: '2026-09-12' }),
    })
    expect(created.statusCode).toBe(201)

    const rejected = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error).toBe('WEEKEND_JUSTIFICATION_REQUIRED')

    // Corrige o rascunho com a justificativa e tenta de novo.
    const updated = await getApp().inject({
      method: 'PATCH',
      url: `${BASE_URL}/${created.json().id}`,
      headers: session.headers,
      payload: { weekendHolidayJustification: 'Evento com início no sábado, conforme convocação oficial.' },
    })
    expect(updated.statusCode).toBe(200)

    const issued = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })
    expect(issued.statusCode).toBe(200)
  })

  test('feriado municipal cadastrado em dia útil exige justificativa', async () => {
    const { session, department } = await setupScenario()

    // Cadastra um feriado municipal na terça (15/set), dentro do período
    // segunda-quarta que por si só não tocaria fim de semana algum.
    const holiday = await getApp().inject({
      method: 'POST',
      url: HOLIDAYS_URL,
      headers: session.headers,
      payload: { date: '2026-09-15', name: 'Aniversário do Município', scope: 'MUNICIPAL' },
    })
    expect(holiday.statusCode).toBe(201)

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: draftPayload(department.id), // segunda a quarta, sem justificativa
    })
    expect(created.statusCode).toBe(201)

    const rejected = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })

    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error).toBe('WEEKEND_JUSTIFICATION_REQUIRED')
  })

  test('feriado cadastrado em OUTRA organização não afeta esta diária', async () => {
    const { session, department } = await setupScenario()
    const other = await setupScenario()

    await getApp().inject({
      method: 'POST',
      url: HOLIDAYS_URL,
      headers: other.session.headers,
      payload: { date: '2026-09-15', name: 'Feriado de outra prefeitura', scope: 'MUNICIPAL' },
    })

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: draftPayload(department.id), // segunda a quarta — toca o dia 15, mas em outro tenant
    })

    const issued = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })

    expect(issued.statusCode).toBe(200)
  })

  describe('cadastro de feriados', () => {
    test('recusa duas datas iguais na mesma organização', async () => {
      const { session } = await setupScenario()

      const first = await getApp().inject({
        method: 'POST',
        url: HOLIDAYS_URL,
        headers: session.headers,
        payload: { date: '2026-12-25', name: 'Natal' },
      })
      expect(first.statusCode).toBe(201)

      const second = await getApp().inject({
        method: 'POST',
        url: HOLIDAYS_URL,
        headers: session.headers,
        payload: { date: '2026-12-25', name: 'Natal (duplicado)' },
      })

      expect(second.statusCode).toBe(409)
      expect(second.json().error).toBe('DUPLICATE_DATE')
    })

    test('exclui um feriado cadastrado', async () => {
      const { session } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: HOLIDAYS_URL,
        headers: session.headers,
        payload: { date: '2026-11-02', name: 'Finados' },
      })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${HOLIDAYS_URL}/${created.json().id}`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(204)
      expect(await prisma.holiday.count()).toBe(0)
    })
  })
})
