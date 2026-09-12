import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Calendário Anual de Reuniões — teste de INTEGRAÇÃO.
 *
 * O calendário era gerado no NAVEGADOR com jsPDF. Estes testes cobrem a migração
 * para o servidor, que é o que torna o hash confiável: sem controlar os bytes, o
 * hash registrado não significaria nada.
 */

const VALIDATE_URL = '/api/v1/public/documents/validate'

function calendarUrl(councilId: string, year: number) {
  // As rotas de conselho também ficam na RAIZ, fora de /api/v1.
  return `/councils/${councilId}/calendar/${year}/pdf`
}

async function setupScenario() {
  const organization = await createTestOrganization({ modules: ['councils'] })
  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions: ['councils:read', 'councils:write'],
  })

  const council = await prisma.council.create({
    data: {
      organizationId: organization.id,
      name: 'Conselho Municipal de Educação',
      acronym: `CME-${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  return { organization, session, council }
}

async function seedMeeting(
  organizationId: string,
  councilId: string,
  createdById: string,
  scheduledAt: Date,
  title = 'Reunião ordinária de planejamento'
) {
  return prisma.councilMeeting.create({
    data: { organizationId, councilId, createdById, title, scheduledAt },
  })
}

describe('Council calendar export (integração)', () => {
  describe('geração', () => {
    test('responde 200 com um PDF de verdade', async () => {
      const { organization, session, council } = await setupScenario()
      await seedMeeting(
        organization.id,
        council.id,
        session.user.id,
        new Date('2026-04-10T14:00:00Z')
      )

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('application/pdf')
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    test('exercício sem reuniões ainda gera documento', async () => {
      // "Nada agendado" é informação legítima para publicação e arquivo.
      const { session, council } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2030),
        headers: session.headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    test('as assinaturas da Mesa Diretora aumentam o documento', async () => {
      const { organization, session, council } = await setupScenario()

      const withoutBoard = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      await prisma.councilMembership.create({
        data: {
          organizationId: organization.id,
          councilId: council.id,
          userId: session.user.id,
          role: 'PRESIDENTE',
          isActive: true,
        },
      })

      const withBoard = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      expect(withBoard.rawPayload.length).toBeGreaterThan(withoutBoard.rawPayload.length)
    })
  })

  describe('validação universal', () => {
    test('registra o documento com o tipo correto', async () => {
      const { organization, session, council } = await setupScenario()

      await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      const exported = await prisma.exportedDocument.findFirst({
        where: { organizationId: organization.id },
      })

      expect(exported?.documentType).toBe('COUNCIL_CALENDAR')
      expect(exported?.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('o hash registrado corresponde aos bytes entregues', async () => {
      const { session, council } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      const { createHash } = await import('node:crypto')
      const delivered = createHash('sha256').update(response.rawPayload).digest('hex')

      const exported = await prisma.exportedDocument.findFirstOrThrow()
      expect(exported.sha256Hash).toBe(delivered)
    })

    test('o calendário é validável no portal público com rótulo em pt-BR', async () => {
      const { session, council } = await setupScenario()

      await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })
      const exported = await prisma.exportedDocument.findFirstOrThrow()

      const validation = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${exported.publicId}`,
      })

      expect(validation.statusCode).toBe(200)
      expect(validation.json().document).toMatchObject({
        type: 'EXPORTED_DOCUMENT',
        typeLabel: 'Calendário Anual de Reuniões',
      })
    })
  })

  describe('isolamento e proteção', () => {
    test('conselho de outra organização responde 404', async () => {
      const first = await setupScenario()
      const second = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(first.council.id, 2026),
        headers: second.session.headers,
      })

      expect(response.statusCode).toBe(404)
    })

    test('sem autenticação responde 401', async () => {
      const { council } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
      })

      expect(response.statusCode).toBe(401)
    })

    test('ano fora da faixa aceita é recusado', async () => {
      const { session, council } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 1800),
        headers: session.headers,
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('recorte do exercício', () => {
    test('reunião de outro ano não entra no calendário', async () => {
      const { organization, session, council } = await setupScenario()

      await seedMeeting(
        organization.id,
        council.id,
        session.user.id,
        new Date('2026-06-01T10:00:00Z')
      )
      await seedMeeting(
        organization.id,
        council.id,
        session.user.id,
        new Date('2025-06-01T10:00:00Z'),
        'Reunião do exercício anterior'
      )

      const onlyOneYear = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      // O calendário de 2026 tem 1 reunião; se o recorte falhasse, teria 2 e
      // portanto um PDF maior.
      await seedMeeting(
        organization.id,
        council.id,
        session.user.id,
        new Date('2026-07-01T10:00:00Z'),
        'Segunda reunião de 2026'
      )

      const twoMeetings = await getApp().inject({
        method: 'GET',
        url: calendarUrl(council.id, 2026),
        headers: session.headers,
      })

      expect(twoMeetings.rawPayload.length).toBeGreaterThan(onlyOneYear.rawPayload.length)
    })
  })
})
