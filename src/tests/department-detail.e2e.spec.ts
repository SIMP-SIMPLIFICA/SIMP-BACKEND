import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { extractPdfText } from './pdf-text.helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Detalhe do Setor e Dossiê — teste de INTEGRAÇÃO (Épico 4, Fase 0 do frontend).
 *
 * O dossiê é gerado de verdade e o PDF é lido: é a única forma de provar que ele
 * sai pelo motor universal (rodapé de validação presente) e que uma seção NÃO
 * pedida realmente não aparece — a asserção que impede o vazamento silencioso de
 * dados que o usuário optou por não exportar.
 */

const BASE_URL = '/departments'

async function setupScenario(
  permissions = ['departments:read', 'departments:write'],
  modules: string[] = []
) {
  const organization = await createTestOrganization({ modules })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Obras',
      code: `SO${Math.floor(Math.random() * 9000) + 1000}`,
      cnpj: '11222333000181',
      chiefName: 'MARIA DAS DORES',
    },
  })

  return { organization, session, department }
}

describe('Detalhe do departamento (integração)', () => {
  test('GET /:id devolve CNPJ, ordenador e as contagens dos vínculos', async () => {
    const { session, department } = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()

    expect(body.cnpj).toBe('11222333000181')
    expect(body.chiefName).toBe('MARIA DAS DORES')
    // As contagens vêm juntas para a tela saber quais abas têm conteúdo sem
    // disparar quatro requisições.
    expect(body._count).toMatchObject({ councils: 0, covenants: 0, virtualProcesses: 0, qddItems: 0 })
  })

  test('setor de outra organização responde 404, não 403', async () => {
    // 403 confirmaria que aquele identificador existe em algum lugar.
    const mine = await setupScenario()
    const theirs = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${theirs.department.id}`,
      headers: mine.session.headers,
    })

    expect(response.statusCode).toBe(404)
  })

  describe('CNPJ', () => {
    test('grava sem máscara quando o número é válido', async () => {
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/`,
        headers: session.headers,
        payload: { name: 'Secretaria Nova', code: 'SN01', cnpj: '11.222.333/0001-81' },
      })

      expect(response.statusCode).toBe(201)
      // Máscara é apresentação: guardá-la criaria dois registros do mesmo órgão.
      expect(response.json().cnpj).toBe('11222333000181')
    })

    test('recusa CNPJ com dígito verificador errado', async () => {
      // Validar só o formato deixaria passar qualquer número digitado ao acaso,
      // e o erro só apareceria quando o Tribunal devolvesse a prestação.
      const { session } = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/`,
        headers: session.headers,
        payload: { name: 'Secretaria Nova', code: 'SN02', cnpj: '11.222.333/0001-99' },
      })

      expect(response.statusCode).toBe(400)
    })

    test('campo em branco limpa o CNPJ em vez de gravar vazio', async () => {
      const { session, department } = await setupScenario()

      const response = await getApp().inject({
        method: 'PATCH',
        url: `${BASE_URL}/${department.id}`,
        headers: session.headers,
        payload: { cnpj: '' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().cnpj).toBeNull()
    })
  })

  describe('abas de vínculo', () => {
    test('listam convênios e processos do setor', async () => {
      const { organization, session, department } = await setupScenario()

      await prisma.covenant.create({
        data: {
          organizationId: organization.id,
          departmentId: department.id,
          number: '001/2026',
          processObject: 'Pavimentação asfáltica',
        },
      })
      await prisma.virtualProcess.create({
        data: {
          organizationId: organization.id,
          departmentId: department.id,
          processNumber: '010/2026',
          secretaria: 'Obras',
          source: 'Licitação',
          subject: 'Aquisição de equipamentos',
          category: 'Compras',
          createdById: session.user.id,
        },
      })

      const covenants = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${department.id}/covenants`,
        headers: session.headers,
      })
      const processes = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${department.id}/virtual-processes`,
        headers: session.headers,
      })

      expect(covenants.json()).toHaveLength(1)
      expect(covenants.json()[0].number).toBe('001/2026')
      expect(processes.json()).toHaveLength(1)
      expect(processes.json()[0].processNumber).toBe('010/2026')
    })

    test('devolve o CONSELHO, não o registro de vínculo', async () => {
      // O id da tabela de ligação não serve para navegar até lugar nenhum.
      const { organization, session, department } = await setupScenario()

      const council = await prisma.council.create({
        data: { organizationId: organization.id, name: 'Conselho Municipal de Obras', acronym: 'CMO' },
      })
      await prisma.councilDepartment.create({
        data: { organizationId: organization.id, councilId: council.id, departmentId: department.id },
      })

      const response = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${department.id}/councils`,
        headers: session.headers,
      })

      expect(response.json()).toHaveLength(1)
      expect(response.json()[0].id).toBe(council.id)
      expect(response.json()[0].acronym).toBe('CMO')
    })

    test('setor de outra organização responde 404, não lista vazia', async () => {
      // "Vazio" seria indistinguível de "setor sem convênios", escondendo o erro
      // de escopo.
      const mine = await setupScenario()
      const theirs = await setupScenario()

      const response = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${theirs.department.id}/covenants`,
        headers: mine.session.headers,
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('convênio e processo com setor', () => {
    test('recusa departamento de outra organização no convênio', async () => {
      // O módulo precisa estar ligado, senão o `requireModule` barra antes de a
      // validação de escopo do setor sequer rodar.
      const mine = await setupScenario(['departments:read', 'covenants:write'], ['covenants'])
      const theirs = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: '/covenants',
        headers: mine.session.headers,
        payload: {
          departmentId: theirs.department.id,
          number: '002/2026',
          processObject: 'Objeto qualquer',
        },
      })

      expect(response.statusCode).toBe(400)
    })
  })
})

describe('Dossiê do Setor (integração)', () => {
  /** Setor com conteúdo em todas as seções, para provar inclusão e omissão. */
  async function setupPopulated() {
    const scenario = await setupScenario()
    const { organization, department } = scenario

    const council = await prisma.council.create({
      data: { organizationId: organization.id, name: 'Conselho Municipal de Obras', acronym: 'CMO' },
    })
    await prisma.councilDepartment.create({
      data: { organizationId: organization.id, councilId: council.id, departmentId: department.id },
    })
    await prisma.qddItem.create({
      data: {
        organizationId: organization.id,
        departmentId: department.id,
        year: 2026,
        ficha: '0042',
        fonte: '1500',
        projetoAtividade: '2.001 - Manutenção',
        naturezaDespesa: '3.3.90.14',
        valorOrcado: 150000,
      },
    })
    await prisma.covenant.create({
      data: {
        organizationId: organization.id,
        departmentId: department.id,
        number: '001/2026',
        processObject: 'Pavimentação asfáltica',
      },
    })

    return scenario
  }

  test('sai pelo motor universal, com rodapé de validação e registro público', async () => {
    const { session, department } = await setupPopulated()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')

    const text = await extractPdfText(response.rawPayload)
    expect(text).toContain('DOSSI')
    // A marca do motor universal: sem esta linha, o documento não seria
    // conferível no Portal.
    expect(text).toContain('Confira a autenticidade deste documento')

    const registered = await prisma.exportedDocument.findFirst({
      where: { documentType: 'DEPARTMENT_DOSSIER' },
    })
    expect(registered).not.toBeNull()
  })

  test('sem parâmetro traz as seis seções', async () => {
    const { session, department } = await setupPopulated()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier`,
      headers: session.headers,
    })

    const text = await extractPdfText(response.rawPayload)
    expect(text).toContain('Conselhos vinculados')
    expect(text).toContain('Dotações do QDD')
    expect(text).toContain('Convênios')
    expect(text).toContain('Processos virtuais')
    expect(text).toContain('Servidores lotados')
    expect(text).toContain('11.222.333/0001-81')
  })

  test('seção NÃO pedida não aparece no documento', async () => {
    // O núcleo da promessa: o que o usuário optou por não exportar não pode
    // vazar no arquivo que ele vai anexar a um processo.
    const { session, department } = await setupPopulated()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier?sections=cnpj`,
      headers: session.headers,
    })

    const text = await extractPdfText(response.rawPayload)

    expect(text).toContain('11.222.333/0001-81')
    expect(text).not.toContain('Conselhos vinculados')
    expect(text).not.toContain('Dotações do QDD')
    expect(text).not.toContain('Pavimentação')
  })

  test('seção pedida e vazia diz isso em palavras', async () => {
    // Título seguido de espaço em branco parece falha de impressão, e a
    // diferença entre "não tem" e "não imprimiu" importa.
    const { session, department } = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier?sections=covenants`,
      headers: session.headers,
    })

    const text = await extractPdfText(response.rawPayload)
    expect(text).toContain('Nenhum convênio vinculado')
  })

  test('nome de seção desconhecido é descartado, não derruba a exportação', async () => {
    const { session, department } = await setupPopulated()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier?sections=cnpj,secaoQueNaoExiste`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const text = await extractPdfText(response.rawPayload)
    expect(text).toContain('11.222.333/0001-81')
  })

  test('lista de seções toda inválida responde 400, não PDF vazio', async () => {
    const { session, department } = await setupPopulated()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}/dossier?sections=nadaDisso`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('NO_SECTION')
  })

  test('setor de outra organização responde 404', async () => {
    const mine = await setupScenario()
    const theirs = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${theirs.department.id}/dossier`,
      headers: mine.session.headers,
    })

    expect(response.statusCode).toBe(404)
  })
})
