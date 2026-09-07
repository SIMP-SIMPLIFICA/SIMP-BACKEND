import { describe, expect, test } from 'vitest'
import { deleteFile } from '@/services/storage.service.js'
import {
  buildAnonymousHeaders,
  createTestOrganization,
  createTestUserWithToken,
} from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Diárias de servidor — teste de INTEGRAÇÃO das rotas privadas (Task QA.4).
 *
 * Exercita a pilha inteira: autenticação por JWT, verificação de fingerprint,
 * kill switch de organização, feature flag de módulo, RBAC e o controller. Nada
 * é mockado — inclusive a geração real do PDF e o cálculo do SHA-256.
 */

const BASE_URL = '/api/v1/daily-allowances'
const MODULE = 'dailyAllowances'

/** Organização com o módulo ligado e um usuário com as permissões pedidas. */
async function setupScenario(permissions: string[]) {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions,
  })
  return { organization, session }
}

function draftPayload() {
  return {
    beneficiaryName: 'joão da silva',
    destination: 'Brasília/DF',
    purpose: 'Reunião no ministério para tratar do convênio',
    departureDate: '2026-09-10',
    returnDate: '2026-09-12',
    dailyRate: 350,
    dayCount: 2,
  }
}

describe('Daily allowances (integração)', () => {
  describe('caminho feliz: rascunho e emissão', () => {
    test('cria o rascunho com 201 e calcula o total no servidor', async () => {
      const { session } = await setupScenario(['dailyAllowances:write'])

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })

      expect(response.statusCode).toBe(201)

      const body = response.json()
      expect(body.destination).toBe('Brasília/DF')
      // 350 x 2 — calculado pelo servidor, nunca aceito do cliente.
      expect(Number(body.totalAmount)).toBe(700)
      // Rascunho: ainda não é documento.
      expect(body.sha256Hash).toBeNull()
      expect(body.publicId).toBeTruthy()
    })

    test('emite o documento com 200, gerando hash e PDF de verdade', async () => {
      const { session } = await setupScenario([
        'dailyAllowances:write',
        'dailyAllowances:issue',
      ])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })
      const draft = created.json()

      const issued = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${draft.id}/issue`,
        headers: session.headers,
      })

      expect(issued.statusCode).toBe(200)

      const body = issued.json()
      expect(body.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
      expect(body.issuedAt).toBeTruthy()
      expect(body.pdfFileKey).toBeTruthy()

      // O documento emitido também entrou na trilha de auditoria.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'DAILY_ALLOWANCE_ISSUED', resourceId: draft.id },
      })
      expect(audit).not.toBeNull()

      // Remove o PDF gerado: o teste escreve em disco de verdade.
      await deleteFile(body.pdfFileKey)
    })

    test('o documento emitido passa a ser validável no portal público', async () => {
      // Fecha o ciclo do Épico 3: o que a rota privada emite é exatamente o que
      // o portal público consegue atestar.
      const { session } = await setupScenario([
        'dailyAllowances:write',
        'dailyAllowances:issue',
      ])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })
      const draft = created.json()

      const issued = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${draft.id}/issue`,
        headers: session.headers,
      })
      const issuedBody = issued.json()

      const validation = await getApp().inject({
        method: 'GET',
        url: `/api/v1/public/documents/validate/${draft.publicId}`,
      })

      expect(validation.statusCode).toBe(200)
      expect(validation.json().document).toMatchObject({
        type: 'DAILY_ALLOWANCE',
        sha256Hash: issuedBody.sha256Hash,
      })

      await deleteFile(issuedBody.pdfFileKey)
    })

    test('emitido não pode mais ser alterado (409)', async () => {
      const { session } = await setupScenario([
        'dailyAllowances:write',
        'dailyAllowances:issue',
      ])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })
      const draft = created.json()

      const issued = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${draft.id}/issue`,
        headers: session.headers,
      })

      const update = await getApp().inject({
        method: 'PATCH',
        url: `${BASE_URL}/${draft.id}`,
        headers: session.headers,
        payload: { destination: 'Outro destino' },
      })

      expect(update.statusCode).toBe(409)
      expect(update.json().error).toBe('ALREADY_ISSUED')

      await deleteFile(issued.json().pdfFileKey)
    })
  })

  describe('a rota está de fato protegida', () => {
    test('sem cabeçalho de autenticação responde 401', async () => {
      await setupScenario(['dailyAllowances:write'])

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: buildAnonymousHeaders(),
        payload: { destination: 'X' },
      })

      expect(response.statusCode).toBe(401)
    })

    test('token válido apresentado de OUTRA rede responde 401', async () => {
      // Fingerprint (Épico 2): o token carrega a faixa de rede de origem. Um
      // token roubado e reapresentado de outro lugar é recusado.
      const { session } = await setupScenario(['dailyAllowances:write'])

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: {
          ...session.headers,
          'X-Forwarded-For': '203.0.113.99',
        },
        payload: draftPayload(),
      })

      expect(response.statusCode).toBe(401)
      expect(response.json().error).toBe('SESSION_INVALIDATED')
    })

    test('sem a permissão de escrita responde 403', async () => {
      const { session } = await setupScenario(['dailyAllowances:read'])

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })

      expect(response.statusCode).toBe(403)
    })

    test('emitir exige permissão própria, separada de escrita', async () => {
      // `issue` gera documento oficial e congela o registro — é ato de outra
      // natureza, e ter `write` não basta.
      const { session } = await setupScenario(['dailyAllowances:write'])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })

      const issued = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${created.json().id}/issue`,
        headers: session.headers,
      })

      expect(issued.statusCode).toBe(403)
    })

    test('módulo desabilitado responde 403 MODULE_DISABLED', async () => {
      const organization = await createTestOrganization({ modules: [] })
      const session = await createTestUserWithToken({
        organizationId: organization.id,
        permissions: ['dailyAllowances:write'],
      })

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload(),
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().error).toBe('MODULE_DISABLED')
    })
  })

  describe('isolamento multi-tenant', () => {
    test('uma organização não enxerga a diária de outra', async () => {
      const first = await setupScenario(['dailyAllowances:write', 'dailyAllowances:read'])
      const second = await setupScenario(['dailyAllowances:read'])

      const created = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: first.session.headers,
        payload: draftPayload(),
      })
      const draft = created.json()

      const foreign = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${draft.id}`,
        headers: second.session.headers,
      })

      expect(foreign.statusCode).toBe(404)

      // E a listagem da segunda organização volta vazia.
      const list = await getApp().inject({
        method: 'GET',
        url: BASE_URL,
        headers: second.session.headers,
      })
      expect(list.json().data).toHaveLength(0)
    })
  })
})
