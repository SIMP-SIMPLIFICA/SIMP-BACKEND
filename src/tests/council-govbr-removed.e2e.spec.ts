import { describe, expect, test } from 'vitest'
import { buildAnonymousHeaders, createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Remoção da assinatura gov.br dos Conselhos (decisão D9).
 *
 * Garante que a retirada do código não quebrou nada para quem já usava o
 * módulo: roles salvas antes da remoção ainda carregam `councils:sign` no
 * banco, e a tela de reunião continua listando os documentos — agora sem o
 * selo de assinatura.
 */

const MODULE = 'councils'

async function setupScenario(permissions: string[]) {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })
  const council = await prisma.council.create({
    data: { organizationId: organization.id, name: 'Conselho Municipal de Saúde', acronym: 'CMS' },
  })
  return { organization, session, council }
}

describe('Conselhos sem assinatura gov.br (integração)', () => {
  test('role antiga com "councils:sign" salvo continua funcionando: a permissão órfã é ignorada', async () => {
    const { session } = await setupScenario(['councils:read', 'councils:sign'])

    const response = await getApp().inject({ method: 'GET', url: '/councils', headers: session.headers })

    expect(response.statusCode).toBe(200)
  })

  test('"councils:sign" sozinha não concede mais nada', async () => {
    const { session } = await setupScenario(['councils:sign'])

    const response = await getApp().inject({ method: 'GET', url: '/councils', headers: session.headers })

    expect(response.statusCode).toBe(403)
  })

  test('as rotas de assinatura deixaram de existir, inclusive o callback público', async () => {
    const { session } = await setupScenario(['councils:read', 'councils:admin'])

    const initiate = await getApp().inject({
      method: 'POST',
      url: '/councils/sign/initiate',
      headers: session.headers,
      payload: { documentId: 'qualquer' },
    })
    const callback = await getApp().inject({
      method: 'GET',
      url: '/councils/sign/callback?code=x&state=y',
      headers: buildAnonymousHeaders(),
    })

    // 404 de ROTA inexistente (notFoundHandler), não o 404 "documento não
    // encontrado" que o controller antigo devolveria para o mesmo payload.
    expect(initiate.statusCode).toBe(404)
    expect(initiate.json().message).toBe('Endpoint POST:/councils/sign/initiate not found')
    expect(callback.statusCode).toBe(404)
    expect(callback.json().message).toMatch(/^Endpoint GET:\/councils\/sign\/callback/)
  })

  test('documentos da reunião continuam listados, sem dados de assinatura', async () => {
    const { organization, session, council } = await setupScenario(['councils:read'])
    const meeting = await prisma.councilMeeting.create({
      data: {
        organizationId: organization.id,
        councilId: council.id,
        title: 'Reunião Ordinária',
        scheduledAt: new Date('2026-09-10T14:00:00Z'),
        createdById: session.user.id,
      },
    })
    await prisma.councilDocument.create({
      data: {
        organizationId: organization.id,
        meetingId: meeting.id,
        title: 'Ata da Reunião Ordinária',
        fileKey: `organizations/${organization.id}/councils/ata.pdf`,
        fileName: 'ata.pdf',
        fileSize: 1024,
        uploadedById: session.user.id,
      },
    })

    const response = await getApp().inject({
      method: 'GET',
      url: `/councils/${council.id}/meetings/${meeting.id}/documents`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const [document] = response.json().data
    expect(document.title).toBe('Ata da Reunião Ordinária')
    expect(document).not.toHaveProperty('signatureRequests')
  })
})
