import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Vínculo Conselho ↔ Departamento — teste de INTEGRAÇÃO (Épico 4, Fase 1).
 *
 * N:N livre: um conselho representa vários setores, e um setor tem assento em
 * vários conselhos. É o mesmo vínculo que `GET /departments/:id/councils` lê
 * do outro lado — os dois precisam concordar sobre o mesmo dado.
 */

const MODULE = 'councils'

async function setupScenario(permissions = ['councils:read', 'councils:write']) {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })

  const council = await prisma.council.create({
    data: { organizationId: organization.id, name: 'Conselho Municipal de Saúde', acronym: 'CMS' },
  })
  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Saúde',
      code: `SS${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, council, department }
}

describe('Vínculo Conselho ↔ Departamento (integração)', () => {
  test('vincula e a listagem do conselho devolve o SETOR, não o registro de vínculo', async () => {
    const { session, council, department } = await setupScenario()

    const linked = await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })

    expect(linked.statusCode).toBe(201)
    expect(linked.json().id).toBe(department.id)

    const list = await getApp().inject({
      method: 'GET',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
    })

    expect(list.json()).toHaveLength(1)
    expect(list.json()[0].id).toBe(department.id)
    expect(list.json()[0].code).toBe(department.code)
  })

  test('o mesmo vínculo aparece do lado do departamento', async () => {
    // A leitura já existia (`GET /departments/:id/councils`); é o mesmo par
    // (councilId, departmentId) que os dois lados devem enxergar.
    const { session, council, department } = await setupScenario()

    await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })

    const fromDepartment = await getApp().inject({
      method: 'GET',
      url: `/departments/${department.id}/councils`,
      headers: session.headers,
    })

    expect(fromDepartment.json()).toHaveLength(1)
    expect(fromDepartment.json()[0].id).toBe(council.id)
  })

  test('vincular duas vezes não duplica nem quebra', async () => {
    // P2002 tratado como sucesso: repetir o clique de "Vincular" na tela não
    // pode gerar erro — o resultado desejado (setor vinculado) já vale.
    const { session, council, department } = await setupScenario()

    const first = await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })
    const second = await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)

    const count = await prisma.councilDepartment.count({
      where: { councilId: council.id, departmentId: department.id },
    })
    expect(count).toBe(1)
  })

  test('desvincula com 204', async () => {
    const { session, council, department } = await setupScenario()

    await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })

    const removed = await getApp().inject({
      method: 'DELETE',
      url: `/councils/${council.id}/departments/${department.id}`,
      headers: session.headers,
    })

    expect(removed.statusCode).toBe(204)
    expect(await prisma.councilDepartment.count()).toBe(0)
  })

  test('recusa vincular setor de OUTRA organização', async () => {
    // A chave estrangeira aceitaria: ela não sabe nada sobre organizações.
    const mine = await setupScenario()
    const theirs = await setupScenario()

    const response = await getApp().inject({
      method: 'POST',
      url: `/councils/${mine.council.id}/departments`,
      headers: mine.session.headers,
      payload: { departmentId: theirs.department.id },
    })

    expect(response.statusCode).toBe(400)
  })

  test('não se vincula setor a conselho de OUTRA organização', async () => {
    const mine = await setupScenario()
    const theirs = await setupScenario()

    const response = await getApp().inject({
      method: 'POST',
      url: `/councils/${theirs.council.id}/departments`,
      headers: mine.session.headers,
      payload: { departmentId: mine.department.id },
    })

    expect(response.statusCode).toBe(404)
  })

  test('sem permissão de escrita não vincula', async () => {
    const { session, council, department } = await setupScenario(['councils:read'])

    const response = await getApp().inject({
      method: 'POST',
      url: `/councils/${council.id}/departments`,
      headers: session.headers,
      payload: { departmentId: department.id },
    })

    expect(response.statusCode).toBe(403)
  })
})
