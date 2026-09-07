import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Portal de Validação Pública — teste de INTEGRAÇÃO (Task QA.2).
 *
 * Diferente dos testes unitários, aqui nada é mockado: os registros são
 * gravados no Postgres de teste e a requisição percorre a árvore real de rotas
 * do Fastify — plugins, hooks, serialização e todo o resto.
 *
 * É exatamente o tipo de teste que teria pego, sozinho, o problema encontrado à
 * mão no Épico 3: a rota estava registrada no prefixo errado e continuava
 * inalcançável, com os testes unitários todos verdes.
 *
 * `app.inject()` em vez de `listen()`: percorre as rotas em memória, sem abrir
 * porta — mais rápido e sem conflito com um servidor de desenvolvimento ligado.
 */

const VALIDATE_URL = '/api/v1/public/documents/validate'

/** Nome de quem viajou. Dado pessoal — NÃO pode aparecer na resposta pública. */
const BENEFICIARY_NAME = 'JOÃO DA SILVA'

/** Cria organização, servidor e uma diária EMITIDA (com hash). */
async function seedIssuedDailyAllowance() {
  const organization = await prisma.organization.create({
    data: { name: 'Prefeitura Municipal de Teste', slug: `teste-${randomUUID().slice(0, 8)}` },
  })

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `servidor-${randomUUID().slice(0, 8)}@prefeitura.gov.br`,
      password: 'hash-irrelevante-para-este-teste',
      firstName: 'João',
      lastName: 'da Silva',
      organizationId: organization.id,
    },
  })

  const sha256Hash = 'a'.repeat(64)

  const allowance = await prisma.dailyAllowance.create({
    data: {
      organizationId: organization.id,
      beneficiaryName: BENEFICIARY_NAME,
      createdById: user.id,
      destination: 'Brasília/DF',
      purpose: 'Reunião no ministério para tratar do convênio',
      departureDate: new Date('2026-09-10T00:00:00Z'),
      returnDate: new Date('2026-09-12T00:00:00Z'),
      dailyRate: 350,
      dayCount: 2.5,
      totalAmount: 875,
      sha256Hash,
      issuedAt: new Date('2026-09-09T13:00:00Z'),
      pdfFileKey: 'organizations/x/daily-allowances/teste.pdf',
    },
  })

  return { organization, user, allowance, sha256Hash }
}

describe('GET /api/v1/public/documents/validate/:uuid (integração)', () => {
  describe('documento emitido', () => {
    test('responde 200 confirmando a autenticidade', async () => {
      const { allowance, organization, sha256Hash } = await seedIssuedDailyAllowance()

      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${allowance.publicId}`,
      })

      expect(response.statusCode).toBe(200)

      const body = response.json()
      expect(body.valid).toBe(true)
      expect(body.document).toMatchObject({
        type: 'DAILY_ALLOWANCE',
        typeLabel: 'Recibo de Diária',
        publicId: allowance.publicId,
        sha256Hash,
        organization: { name: organization.name },
      })
      expect(body.document.issuedAt).toBe('2026-09-09T13:00:00.000Z')
    })

    test('NÃO vaza dado pessoal nem valores (regra do Épico 3)', async () => {
      const { allowance, user } = await seedIssuedDailyAllowance()

      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${allowance.publicId}`,
      })

      // A verificação é sobre o CORPO INTEIRO, não só sobre os campos que
      // conhecemos: é assim que um vazamento introduzido por descuido aparece.
      const raw = response.body

      expect(raw).not.toContain(user.email)
      // O nome de quem viajou é o dado pessoal central do documento.
      expect(raw).not.toContain(BENEFICIARY_NAME)
      expect(raw).not.toContain('João')
      expect(raw).not.toContain('da Silva')
      expect(raw).not.toContain('Brasília/DF')
      expect(raw).not.toContain('ministério')
      expect(raw).not.toContain('875')

      expect(Object.keys(response.json().document).sort()).toEqual([
        'issuedAt',
        'organization',
        'publicId',
        'sha256Hash',
        'type',
        'typeLabel',
      ])
    })

    test('dispensa autenticação — nenhum cabeçalho é enviado', async () => {
      const { allowance } = await seedIssuedDailyAllowance()

      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${allowance.publicId}`,
      })

      // Se a rota tivesse caído atrás do authMiddleware, viria 401 aqui.
      expect(response.statusCode).toBe(200)
    })
  })

  describe('documento inexistente', () => {
    test('uuid válido porém desconhecido responde 404', async () => {
      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${randomUUID()}`,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({
        valid: false,
        error: 'DOCUMENT_NOT_FOUND',
      })
    })

    test('uuid malformado responde o MESMO 404, sem revelar o formato esperado', async () => {
      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/nao-e-um-uuid`,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().error).toBe('DOCUMENT_NOT_FOUND')
    })
  })

  describe('rascunho não é documento', () => {
    test('diária sem hash responde 404 mesmo existindo no banco', async () => {
      // Rascunho já tem publicId, mas não existe como papel. Devolvê-lo como
      // válido faria o portal atestar um documento que ninguém emitiu.
      const { allowance } = await seedIssuedDailyAllowance()

      await prisma.dailyAllowance.update({
        where: { id: allowance.id },
        data: { sha256Hash: null, issuedAt: null },
      })

      const response = await getApp().inject({
        method: 'GET',
        url: `${VALIDATE_URL}/${allowance.publicId}`,
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('isolamento entre testes', () => {
    test('o banco começa vazio a cada teste', async () => {
      // Prova que o `beforeEach` limpou o que os testes anteriores inseriram —
      // é o que garante que um teste não dependa da sobra de outro.
      expect(await prisma.dailyAllowance.count()).toBe(0)
      expect(await prisma.organization.count()).toBe(0)
    })
  })
})
