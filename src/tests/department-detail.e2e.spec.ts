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

  // O Ordenador de Despesa é o CHEFE do setor, apontado em `managerId`. Não há
  // mais nome solto: derivar do cadastro é o que impede o nome impresso nos
  // empenhos divergir de quem de fato responde pela pasta.
  const chief = await createTestUserWithToken({
    organizationId: organization.id,
    permissions: [],
  })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Obras',
      code: `SO${Math.floor(Math.random() * 9000) + 1000}`,
      cnpj: '11222333000181',
      managerId: chief.user.id,
    },
  })

  return { organization, session, department, chief }
}

describe('Detalhe do departamento (integração)', () => {
  test('GET /:id devolve CNPJ, ordenador e as contagens dos vínculos', async () => {
    const { session, department, chief } = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${department.id}`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()

    expect(body.cnpj).toBe('11222333000181')
    // `chiefName` é DERIVADO do gestor, não coluna: vem pronto para tela e PDF
    // exibirem exatamente o mesmo nome.
    const expectedChief = [chief.user.firstName, chief.user.lastName].filter(Boolean).join(' ')
    expect(body.chiefName).toBe(expectedChief)
    expect(body.manager?.id).toBe(chief.user.id)
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

  describe('ordenador de despesa', () => {
    test('é definido já na CRIAÇÃO, não só na edição', async () => {
      // Antes o gestor só existia no update, e o setor nascia sem ordenador —
      // que é justamente o dado que os documentos dele precisam.
      const { organization, session } = await setupScenario()
      const chief = await createTestUserWithToken({
        organizationId: organization.id,
        permissions: [],
      })

      const created = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/`,
        headers: session.headers,
        payload: { name: 'Secretaria de Cultura', code: 'SCULT1', managerId: chief.user.id },
      })

      expect(created.statusCode).toBe(201)

      const detail = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
      })
      expect(detail.json().manager.id).toBe(chief.user.id)
      expect(detail.json().chiefName).not.toBe('Não informado')
    })

    test('recusa gestor de outra organização', async () => {
      // A chave estrangeira aceitaria: ela não sabe nada sobre organizações, e
      // o ordenador do setor passaria a ser um estranho.
      const mine = await setupScenario()
      const theirs = await setupScenario()

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/`,
        headers: mine.session.headers,
        payload: { name: 'Secretaria Nova', code: 'SN77', managerId: theirs.chief.user.id },
      })

      expect(response.statusCode).toBe(400)
    })

    test('setor sem chefe diz "Não informado", não vem vazio', async () => {
      // Campo em branco num documento oficial parece falha de impressão.
      const { session } = await setupScenario()

      const created = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/`,
        headers: session.headers,
        payload: { name: 'Secretaria Sem Chefe', code: 'SSC01' },
      })

      const detail = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${created.json().id}`,
        headers: session.headers,
      })

      expect(detail.json().chiefName).toBe('Não informado')
    })
  })

  describe('logo do setor', () => {
    /** PNG 1x1 válido — o validador confere a ASSINATURA, não a extensão. */
    const PNG_1X1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )

    /** Monta o corpo multipart na mão — o helper E2E não cobre upload. */
    function multipart(buffer: Buffer, filename: string, contentType: string) {
      const boundary = '----simpTestBoundary'
      const head = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`
      )
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
      return {
        payload: Buffer.concat([head, buffer, tail]),
        contentType: `multipart/form-data; boundary=${boundary}`,
      }
    }

    test('aceita PNG e grava o fileKey no setor', async () => {
      const { session, department } = await setupScenario()
      const { payload, contentType } = multipart(PNG_1X1, 'logo.png', 'image/png')

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${department.id}/logo`,
        headers: { ...session.headers, 'content-type': contentType },
        payload,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().logoUrl).toBeTruthy()

      const stored = await prisma.department.findUnique({ where: { id: department.id } })
      // fileKey do StorageService, NUNCA URL absoluta: URL gravada apodrece
      // quando APP_URL muda de dev para produção.
      expect(stored?.logoUrl).not.toMatch(/^https?:/)
    })

    test('recusa formato que o pdf-lib não embute', async () => {
      // Aceitar GIF faria o upload passar e a logo sumir do PDF — falha
      // silenciosa que só apareceria num documento já emitido.
      const { session, department } = await setupScenario()
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
      const { payload, contentType } = multipart(gif, 'logo.gif', 'image/gif')

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${department.id}/logo`,
        headers: { ...session.headers, 'content-type': contentType },
        payload,
      })

      expect(response.statusCode).toBe(415)
    })

    test('não se troca a logo do setor de outra organização', async () => {
      const mine = await setupScenario()
      const theirs = await setupScenario()
      const { payload, contentType } = multipart(PNG_1X1, 'logo.png', 'image/png')

      const response = await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${theirs.department.id}/logo`,
        headers: { ...mine.session.headers, 'content-type': contentType },
        payload,
      })

      expect(response.statusCode).toBe(404)
    })

    test('remover devolve o setor à logo da organização', async () => {
      const { session, department } = await setupScenario()
      const { payload, contentType } = multipart(PNG_1X1, 'logo.png', 'image/png')

      await getApp().inject({
        method: 'POST',
        url: `${BASE_URL}/${department.id}/logo`,
        headers: { ...session.headers, 'content-type': contentType },
        payload,
      })

      const removed = await getApp().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${department.id}/logo`,
        headers: session.headers,
      })

      expect(removed.statusCode).toBe(200)
      expect(removed.json().logoUrl).toBeNull()
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

describe('Listagem de departamentos — teto de paginação (regressão)', () => {
  // BUG REAL: `useDepartmentOptions()` no frontend pedia `limit: 200` para
  // popular o `DepartmentSelect` inteiro numa única página. O backend aceita
  // no máximo `MAX_PAGE_SIZE` (100, em `constants/pagination.ts`) — acima
  // disso o Zod recusa com 400 ANTES de qualquer consulta ao banco. A
  // requisição inteira falhava, e o seletor abria vazio e em silêncio em toda
  // tela que o usava (convênio, processo virtual, vínculo de conselho,
  // diária) — sem nenhum aviso de erro, porque o componente não tratava o
  // estado de falha.
  test('limit acima do teto responde 400, não uma lista vazia por engano', async () => {
    const { session } = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/?limit=200`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(400)
  })

  test('limit no teto (100) devolve os departamentos normalmente', async () => {
    // É o valor que qualquer seletor "traga tudo" deve usar — inclusive
    // `useDepartmentOptions()`, corrigido nesta mesma correção.
    const { session, department } = await setupScenario()

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/?limit=100`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const ids = response.json().data.map((d: { id: string }) => d.id)
    expect(ids).toContain(department.id)
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
    // Os títulos de seção saem em CAIXA ALTA no relatório executivo; a
    // asserção ignora a caixa para não quebrar a cada ajuste de estilo.
    expect(text).toMatch(/conselhos vinculados/i)
    expect(text).toMatch(/dotações do qdd/i)
    expect(text).toMatch(/convênios/i)
    expect(text).toMatch(/processos virtuais/i)
    expect(text).toMatch(/servidores lotados/i)
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
    expect(text).not.toMatch(/conselhos vinculados/i)
    expect(text).not.toMatch(/dotações do qdd/i)
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
    expect(text).toMatch(/nenhum convênio vinculado/i)
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
