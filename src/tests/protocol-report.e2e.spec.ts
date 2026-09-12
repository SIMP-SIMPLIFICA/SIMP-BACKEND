import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Relatório de Protocolos + validação universal — teste de INTEGRAÇÃO.
 *
 * O valor aqui está no CICLO COMPLETO: gerar o PDF de verdade, conferir que o
 * hash foi registrado e validar esse mesmo documento pelo endpoint público.
 * Nenhum teste unitário cobre essa costura, e é nela que os erros aparecem.
 */

// As rotas de protocolo são montadas na RAIZ, fora do bloco /api/v1 — mesmo
// detalhe que derrubou a rota de validação no Épico 3.
const REPORT_URL = '/protocols/report'
const VALIDATE_URL = '/api/v1/public/documents/validate'

async function setupScenario() {
  const organization = await createTestOrganization({ modules: ['protocols'] })
  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions: ['protocols:read', 'protocols:admin'],
  })
  return { organization, session }
}

/** Cria um protocolo oficial direto no banco. */
async function seedProtocol(
  organizationId: string,
  creatorId: string,
  overrides: Partial<{ subject: string; documentType: string; createdAt: Date; status: 'RESERVADO' | 'EMITIDO' | 'CANCELADO' }> = {}
) {
  return prisma.officialDocument.create({
    data: {
      organizationId,
      creatorId,
      documentCategory: 'COMUNICACAO',
      documentType: overrides.documentType ?? 'Ofício',
      numberingType: 'SEQUENTIAL',
      year: 2026,
      sequenceNumber: Math.floor(Math.random() * 9000) + 1000,
      formattedNumber: `OF-${Math.floor(Math.random() * 9000) + 1000}/2026`,
      subject: overrides.subject ?? 'Solicitação de informações ao setor de obras',
      sector: 'GABINETE',
      status: overrides.status ?? 'EMITIDO',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })
}

describe('Protocol report (integração)', () => {
  describe('geração do PDF', () => {
    test('responde 200 com um PDF de verdade', async () => {
      const { organization, session } = await setupScenario()
      await seedProtocol(organization.id, session.user.id)

      const response = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('application/pdf')
      // Assinatura do formato: prova que saiu um PDF, não um JSON de erro.
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    test('gera relatório mesmo sem nenhum protocolo', async () => {
      // Um relatório vazio é resposta legítima: significa "nada no período".
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(200)
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    test('registra o documento exportado para validação pública', async () => {
      const { organization, session } = await setupScenario()
      await seedProtocol(organization.id, session.user.id)

      await getApp().inject({ method: 'GET', url: REPORT_URL, headers: session.headers })

      const exported = await prisma.exportedDocument.findFirst({
        where: { organizationId: organization.id },
      })

      expect(exported).not.toBeNull()
      expect(exported?.documentType).toBe('REPORT_PROTOCOLS')
      expect(exported?.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('o nome do emissor é gravado OFUSCADO', async () => {
      // O registro alimenta endpoint público: o nome completo não pode entrar.
      const { organization } = await setupScenario()
      const session = await createTestUserWithToken({
        organizationId: organization.id,
        permissions: ['protocols:read', 'protocols:admin'],
      })

      await getApp().inject({ method: 'GET', url: REPORT_URL, headers: session.headers })

      const exported = await prisma.exportedDocument.findFirst()
      // O helper cria "Servidor de Teste"; "de" é partícula preservada.
      expect(exported?.exporterName).toBe('Servidor de T***')
      expect(exported?.exporterName).not.toContain('Teste')
    })
  })

  describe('ciclo completo: exportar e validar', () => {
    test('o hash registrado corresponde aos BYTES entregues', async () => {
      // É a propriedade que sustenta a validação: o que o portal afirma tem de
      // ser o arquivo que a pessoa tem em mãos.
      const { organization, session } = await setupScenario()
      await seedProtocol(organization.id, session.user.id)

      const response = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: session.headers,
      })

      const { createHash } = await import('node:crypto')
      const deliveredHash = createHash('sha256').update(response.rawPayload).digest('hex')

      const exported = await prisma.exportedDocument.findFirst()
      expect(exported?.sha256Hash).toBe(deliveredHash)
    })

    test('o documento exportado é validável no portal público', async () => {
      const { organization, session } = await setupScenario()
      await seedProtocol(organization.id, session.user.id)

      await getApp().inject({ method: 'GET', url: REPORT_URL, headers: session.headers })
      const exported = await prisma.exportedDocument.findFirstOrThrow()

      const validation = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${exported.publicId}`,
      })

      expect(validation.statusCode).toBe(200)
      expect(validation.json().document).toMatchObject({
        type: 'EXPORTED_DOCUMENT',
        typeLabel: 'Relatório de Protocolos',
        sha256Hash: exported.sha256Hash,
        organization: { name: organization.name },
        exporterName: 'Servidor de T***',
      })
    })
  })

  describe('filtros', () => {
    test('o intervalo de datas recorta os registros', async () => {
      const { organization, session } = await setupScenario()

      await seedProtocol(organization.id, session.user.id, {
        createdAt: new Date('2026-03-15T10:00:00Z'),
        subject: 'Dentro do periodo',
      })
      await seedProtocol(organization.id, session.user.id, {
        createdAt: new Date('2025-01-10T10:00:00Z'),
        subject: 'Fora do periodo',
      })

      const response = await getApp().inject({
        method: 'GET',
        url: `${REPORT_URL}?startDate=2026-01-01&endDate=2026-12-31`,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(200)
      // O PDF com 1 registro é menor que o com 2 — comparação indireta, mas o
      // conteúdo de um PDF não é inspecionável como texto.
      const withFilter = response.rawPayload.length

      const withoutFilter = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: session.headers,
      })

      expect(withoutFilter.rawPayload.length).toBeGreaterThan(withFilter)
    })

    test('data inicial posterior à final é recusada', async () => {
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: `${REPORT_URL}?startDate=2026-12-31&endDate=2026-01-01`,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('VALIDATION_ERROR')
    })
  })

  describe('proteção', () => {
    test('sem autenticação responde 401', async () => {
      const response = await getApp().inject({ method: 'GET', url: REPORT_URL })
      expect(response.statusCode).toBe(401)
    })

    test('módulo de protocolos desabilitado responde 403', async () => {
      const organization = await createTestOrganization({ modules: [] })
      const session = await createTestUserWithToken({
        organizationId: organization.id,
        permissions: ['protocols:read'],
      })

      const response = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: session.headers,
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('isolamento multi-tenant', () => {
    test('o relatório não inclui protocolos de outra organização', async () => {
      const first = await setupScenario()
      const second = await setupScenario()

      await seedProtocol(first.organization.id, first.session.user.id)

      // A segunda organização não tem protocolo nenhum: seu relatório deve sair
      // vazio, e portanto menor que o da primeira.
      const firstReport = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: first.session.headers,
      })
      const secondReport = await getApp().inject({
        method: 'GET',
        url: REPORT_URL,
        headers: second.session.headers,
      })

      expect(firstReport.statusCode).toBe(200)
      expect(secondReport.statusCode).toBe(200)
      expect(secondReport.rawPayload.length).toBeLessThan(firstReport.rawPayload.length)
    })
  })
})
