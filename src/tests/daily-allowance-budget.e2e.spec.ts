import { describe, expect, test } from 'vitest'
import { calculateDocumentHash } from '@/services/document-pdf.service.js'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { extractPdfText } from './pdf-text.helper.js'
import { getApp, prisma } from './setup-e2e.js'
import { readZipEntries } from './zip-reader.helper.js'

/**
 * Motor orçamentário e prestação de contas — teste de INTEGRAÇÃO (Épico 4).
 *
 * Nada é mockado: o PDF é gerado de verdade, o hash é calculado sobre os bytes
 * finais e o ZIP é aberto e conferido. É a única forma de provar que o
 * PDF-Manifesto atesta o hash da planilha que de fato viaja com ele — com
 * mocks, essa correspondência seria uma ficção nossa.
 */

const BASE_URL = '/api/v1/daily-allowances'
const MODULE = 'dailyAllowances'

const ALL_PERMISSIONS = [
  'dailyAllowances:read',
  'dailyAllowances:write',
  'dailyAllowances:issue',
]

interface ScenarioOptions {
  /** Dotação da ficha. Omitir não cria QDD algum. */
  valorOrcado?: number
  permissions?: string[]
}

async function setupScenario({ valorOrcado, permissions = ALL_PERMISSIONS }: ScenarioOptions = {}) {
  const organization = await createTestOrganization({ modules: [MODULE] })
  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions,
  })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria de Administração',
      code: `SA${Math.floor(Math.random() * 9000) + 1000}`,
    },
  })

  const qddItem =
    valorOrcado === undefined
      ? null
      : await prisma.qddItem.create({
          data: {
            organizationId: organization.id,
            departmentId: department.id,
            year: 2026,
            ficha: '0042',
            fonte: '1500',
            projetoAtividade: '2.001 - Manutenção da Secretaria',
            naturezaDespesa: '3.3.90.14',
            valorOrcado,
          },
        })

  return { organization, session, department, qddItem }
}

interface DraftOptions {
  departmentId: string
  qddItemId?: string
  dailyRate?: number
  dayCount?: number
  beneficiaryName?: string
  departureDate?: string
  returnDate?: string
}

function draftPayload(options: DraftOptions) {
  return {
    departmentId: options.departmentId,
    qddItemId: options.qddItemId,
    beneficiaryName: options.beneficiaryName ?? 'joão da silva',
    destination: 'Brasília/DF',
    purpose: 'Reunião no ministério para tratar do convênio',
    // Padrão (10 a 12/set/2026) cruza sábado — por isso a justificativa
    // abaixo (Épico 8, FR-021/FR-022), sempre presente aqui porque este
    // arquivo testa o motor orçamentário, não a regra de fim de semana.
    departureDate: options.departureDate ?? '2026-09-10',
    returnDate: options.returnDate ?? '2026-09-12',
    dailyRate: options.dailyRate ?? 350,
    dayCount: options.dayCount ?? 2,
    weekendHolidayJustification: 'Reunião extraordinária de última hora, autorizada pelo secretário.',
  }
}

/** Cria o rascunho e emite, devolvendo o corpo da diária emitida. */
async function createAndIssue(
  session: { headers: Record<string, string> },
  options: DraftOptions
) {
  const created = await getApp().inject({
    method: 'POST',
    url: BASE_URL,
    headers: session.headers,
    payload: draftPayload(options),
  })
  expect(created.statusCode).toBe(201)

  const issued = await getApp().inject({
    method: 'POST',
    url: `${BASE_URL}/${created.json().id}/issue`,
    headers: session.headers,
  })
  expect(issued.statusCode).toBe(200)

  return issued.json()
}

describe('Motor orçamentário (integração)', () => {
  describe('snapshot da dotação', () => {
    test('a emissão carimba ficha, fonte e natureza no registro; ficha e fonte também no PDF', async () => {
      const { session, department, qddItem } = await setupScenario({ valorOrcado: 100000 })

      const issued = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
      })

      expect(issued.qddFichaSnapshot).toBe('0042')
      expect(issued.qddFonteSnapshot).toBe('1500')
      // Natureza da despesa é gravada para a prestação de contas e a auditoria,
      // mas NÃO é um dos 20 campos numerados do formulário físico — o Anexo I
      // não a imprime. Ficha e Fonte são os campos 3 e 4 do papel, esses sim.
      expect(issued.qddNaturezaSnapshot).toBe('3.3.90.14')

      const pdf = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${issued.id}/pdf`,
        headers: session.headers,
      })

      const text = await extractPdfText(pdf.rawPayload)
      expect(text).toContain('0042')
      expect(text).toContain('1500')
      expect(text).toContain('FICHA')
      expect(text).toContain('FONTE')
    })

    test('alterar o QDD depois NÃO reescreve o documento já emitido', async () => {
      // É a razão de o snapshot existir: o recibo entregue ao Tribunal de
      // Contas não pode mudar porque alguém corrigiu o cadastro.
      const { session, department, qddItem } = await setupScenario({ valorOrcado: 100000 })

      const issued = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
      })

      await prisma.qddItem.update({
        where: { id: qddItem!.id },
        data: { ficha: '9999', naturezaDespesa: '4.4.90.52' },
      })

      const reread = await getApp().inject({
        method: 'GET',
        url: `${BASE_URL}/${issued.id}`,
        headers: session.headers,
      })

      expect(reread.json().qddFichaSnapshot).toBe('0042')
      expect(reread.json().qddNaturezaSnapshot).toBe('3.3.90.14')
    })
  })

  describe('estouro de dotação', () => {
    test('PERMITE a emissão e registra o alerta', async () => {
      // Regra do Épico 4: suplementação e remanejamento são rotina. Bloquear
      // engessaria o município — o sistema alerta, não trava.
      const { session, department, qddItem } = await setupScenario({ valorOrcado: 500 })

      const issued = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
        dailyRate: 350,
        dayCount: 2, // 700 > 500
      })

      expect(issued.status).toBe('ISSUED')
      expect(issued.budgetOverrun).toBe(true)
      expect(issued.sha256Hash).toHaveLength(64)
    })

    test('só a soma ACUMULADA estoura: a primeira cabe, a segunda não', async () => {
      const { session, department, qddItem } = await setupScenario({ valorOrcado: 1000 })

      const first = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
        dailyRate: 400,
        dayCount: 2, // 800 de 1000
      })
      expect(first.budgetOverrun).toBe(false)

      const second = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
        dailyRate: 400,
        dayCount: 2, // acumulado 1600 > 1000
        beneficiaryName: 'maria das dores',
      })
      expect(second.budgetOverrun).toBe(true)

      // A primeira permanece sem alerta: ela não estourou nada quando saiu.
      const reread = await prisma.dailyAllowance.findUnique({ where: { id: first.id } })
      expect(reread?.budgetOverrun).toBe(false)
    })

    test('rascunho não compromete dotação', async () => {
      // Contar rascunhos acusaria estouro por diárias que talvez nunca saiam.
      const { session, department, qddItem } = await setupScenario({ valorOrcado: 1000 })

      await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: session.headers,
        payload: draftPayload({
          departmentId: department.id,
          qddItemId: qddItem!.id,
          dailyRate: 5000,
          dayCount: 1,
        }),
      })

      const issued = await createAndIssue(session, {
        departmentId: department.id,
        qddItemId: qddItem!.id,
        dailyRate: 100,
        dayCount: 1,
        beneficiaryName: 'carlos pereira',
      })

      expect(issued.budgetOverrun).toBe(false)
    })

    test('dotação de OUTRA organização é recusada', async () => {
      const mine = await setupScenario({ valorOrcado: 1000 })
      const theirs = await setupScenario({ valorOrcado: 1000 })

      const response = await getApp().inject({
        method: 'POST',
        url: BASE_URL,
        headers: mine.session.headers,
        payload: draftPayload({
          departmentId: mine.department.id,
          qddItemId: theirs.qddItem!.id,
        }),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('INVALID_QDD_ITEM')
    })
  })
})

describe('Prestação de contas — Anexo II (integração)', () => {
  const ACCOUNT_PAYLOAD = {
    accountabilityDate: '2026-09-15',
    activityReport: 'Participação na reunião técnica do ministério, conforme convocação.',
  }

  test('emite documento com publicId e hash PRÓPRIOS', async () => {
    const { session, department } = await setupScenario()

    const issued = await createAndIssue(session, { departmentId: department.id })

    const accounted = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${issued.id}/account-for`,
      headers: session.headers,
      payload: ACCOUNT_PAYLOAD,
    })

    expect(accounted.statusCode).toBe(200)
    const body = accounted.json()

    expect(body.status).toBe('ACCOUNTED')
    // Dois papéis distintos circulando: identificadores e hashes separados.
    expect(body.accountabilityPublicId).not.toBe(body.publicId)
    expect(body.accountabilitySha256Hash).not.toBe(body.sha256Hash)
    expect(body.accountabilitySha256Hash).toHaveLength(64)
  })

  test('o PDF traz a instrução sobre comprovantes e é validável no Portal', async () => {
    const { session, department } = await setupScenario()
    const issued = await createAndIssue(session, { departmentId: department.id })

    const accounted = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${issued.id}/account-for`,
      headers: session.headers,
      payload: ACCOUNT_PAYLOAD,
    })

    const pdf = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${issued.id}/accountability/pdf`,
      headers: session.headers,
    })

    expect(pdf.statusCode).toBe(200)
    const text = await extractPdfText(pdf.rawPayload)
    expect(text).toMatch(/notas fiscais/i)
    expect(text).toContain('PRESTA')

    // O hash gravado corresponde aos bytes ENTREGUES — é o que o Portal confere.
    expect(calculateDocumentHash(pdf.rawPayload)).toBe(
      accounted.json().accountabilitySha256Hash
    )

    // E o registro público existe, senão o QR Code levaria a lugar nenhum.
    const registered = await prisma.exportedDocument.findUnique({
      where: { publicId: accounted.json().accountabilityPublicId },
    })
    expect(registered?.documentType).toBe('DAILY_ALLOWANCE_ACCOUNTABILITY')
  })

  test('recusa prestação de contas de diária não emitida', async () => {
    const { session, department } = await setupScenario()

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: draftPayload({ departmentId: department.id }),
    })

    const response = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/account-for`,
      headers: session.headers,
      payload: ACCOUNT_PAYLOAD,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('NOT_ISSUED')
  })

  test('não presta contas duas vezes', async () => {
    const { session, department } = await setupScenario()
    const issued = await createAndIssue(session, { departmentId: department.id })

    const url = `${BASE_URL}/${issued.id}/account-for`
    await getApp().inject({
      method: 'POST',
      url,
      headers: session.headers,
      payload: ACCOUNT_PAYLOAD,
    })

    const second = await getApp().inject({
      method: 'POST',
      url,
      headers: session.headers,
      payload: ACCOUNT_PAYLOAD,
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe('ALREADY_ACCOUNTED')
  })

  test('a flag isLate vem calculada do SERVIDOR', async () => {
    const { session, department } = await setupScenario()

    // Deslocamento bem no passado: o prazo de 5 dias já venceu.
    const issued = await createAndIssue(session, {
      departmentId: department.id,
      departureDate: '2020-01-08',
      returnDate: '2020-01-10',
    })

    const list = await getApp().inject({
      method: 'GET',
      url: BASE_URL,
      headers: session.headers,
    })

    const found = list.json().data.find((item: { id: string }) => item.id === issued.id)
    expect(found.isLate).toBe(true)

    // Prestadas as contas, o atraso deixa de existir.
    await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${issued.id}/account-for`,
      headers: session.headers,
      payload: { ...ACCOUNT_PAYLOAD, accountabilityDate: '2026-09-15' },
    })

    const after = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${issued.id}`,
      headers: session.headers,
    })
    expect(after.json().isLate).toBe(false)
  })
})

describe('Relatórios globais (integração)', () => {
  test('o PDF lista os filtros aplicados no cabeçalho', async () => {
    // Um recorte parcial sem dizer que é parcial acaba anexado a um processo
    // como se fosse a lista completa do município.
    const { session, department } = await setupScenario()
    await createAndIssue(session, { departmentId: department.id })

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/pdf?status=ISSUED&destination=Bras`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')

    const text = await extractPdfText(response.rawPayload)
    expect(text).toContain('RELAT')
    expect(text).toMatch(/Situação: Emitida/)
    expect(text).toContain('JOÃO DA SILVA')
  })

  test('o filtro de CPF é exato e não vaza o número no relatório', async () => {
    const { session, organization, department } = await setupScenario()

    await prisma.beneficiary.create({
      data: { organizationId: organization.id, name: 'JOÃO DA SILVA', cpf: '12345678900' },
    })
    await createAndIssue(session, { departmentId: department.id })
    await createAndIssue(session, {
      departmentId: department.id,
      beneficiaryName: 'maria das dores',
    })

    const list = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}?cpf=123.456.789-00`,
      headers: session.headers,
    })

    expect(list.json().data).toHaveLength(1)
    expect(list.json().data[0].beneficiaryName).toBe('JOÃO DA SILVA')

    // CPF sem cadastro devolve vazio, JAMAIS a lista inteira.
    const miss = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}?cpf=99999999999`,
      headers: session.headers,
    })
    expect(miss.json().data).toHaveLength(0)

    // E o número não pode sair impresso num documento que vai ao portal.
    const report = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/pdf?cpf=123.456.789-00`,
      headers: session.headers,
    })
    const text = await extractPdfText(report.rawPayload)
    expect(text).not.toContain('12345678900')
    expect(text).not.toContain('123.456.789-00')
  })

  test('o ZIP traz a planilha e um manifesto que atesta o hash DELA', async () => {
    const { session, department } = await setupScenario()
    await createAndIssue(session, { departmentId: department.id })

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/excel`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')

    const entries = readZipEntries(response.rawPayload)
    const names = entries.map(entry => entry.name)

    expect(names).toContain('diarias.xlsx')
    const manifest = entries.find(entry => entry.name.startsWith('manifesto-'))
    expect(manifest).toBeDefined()

    // O CORAÇÃO DO ARRANJO: o hash impresso no manifesto tem de bater com o
    // SHA-256 da planilha que veio no mesmo pacote. Se divergirem, o manifesto
    // atesta um arquivo que ninguém recebeu.
    const spreadsheet = entries.find(entry => entry.name === 'diarias.xlsx')!
    const spreadsheetHash = calculateDocumentHash(spreadsheet.content)

    const manifestText = await extractPdfText(manifest!.content)
    expect(manifestText).toContain(spreadsheetHash)
    expect(manifestText).toContain('SHA-256')
  })

  test('o manifesto é validável no Portal, a planilha sai limpa', async () => {
    const { session, department } = await setupScenario()
    await createAndIssue(session, { departmentId: department.id })

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/excel`,
      headers: session.headers,
    })

    const entries = readZipEntries(response.rawPayload)
    const manifest = entries.find(entry => entry.name.startsWith('manifesto-'))!
    const publicId = manifest.name.replace('manifesto-', '').replace('.pdf', '')

    const registered = await prisma.exportedDocument.findUnique({ where: { publicId } })
    expect(registered?.documentType).toBe('DAILY_ALLOWANCE_XLS_MANIFEST')
    // O hash registrado é o do MANIFESTO, não o da planilha: é o PDF que o
    // Portal confere, e é ele que aponta para a planilha.
    expect(registered?.sha256Hash).toBe(calculateDocumentHash(manifest.content))

    // A planilha é um .xlsx de verdade (assinatura PK\x03\x04 do formato OOXML).
    const spreadsheet = entries.find(entry => entry.name === 'diarias.xlsx')!
    expect(spreadsheet.content.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  test('relatório sem permissão de leitura é recusado', async () => {
    const { session } = await setupScenario({ permissions: ['dailyAllowances:write'] })

    const response = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/pdf`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(403)
  })

  test('o relatório respeita o isolamento multi-tenant', async () => {
    const mine = await setupScenario()
    const theirs = await setupScenario()

    await createAndIssue(mine.session, {
      departmentId: mine.department.id,
      beneficiaryName: 'servidor da primeira',
    })

    const report = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/report/pdf`,
      headers: theirs.session.headers,
    })

    const text = await extractPdfText(report.rawPayload)
    expect(text).not.toContain('SERVIDOR DA PRIMEIRA')
    expect(text).toContain('Nenhuma diária encontrada')
  })
})
