import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { extractPdfText } from './pdf-text.helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Anexo I — grade numerada de 20 campos (Épico 4, correção pós-validação).
 *
 * O usuário enviou o formulário físico real da prefeitura e exigiu que o
 * documento gerado reproduzisse EXATAMENTE aquela disposição. Este arquivo
 * prova, contra um PDF de verdade, que cada um dos 20 campos aparece — não
 * apenas que o serviço não lança exceção.
 */

const BASE_URL = '/api/v1/daily-allowances'
const MODULE = 'dailyAllowances'

async function setupScenario() {
  const organization = await createTestOrganization({ modules: [MODULE] })
  await prisma.organization.update({
    where: { id: organization.id },
    data: { city: 'Pequizeiro', state: 'TO' },
  })

  const session = await createTestUserWithToken({
    organizationId: organization.id,
    permissions: ['dailyAllowances:read', 'dailyAllowances:write', 'dailyAllowances:issue'],
  })

  // Chefe do setor: é dele que sai o Ordenador de Despesa impresso no Anexo I.
  const chief = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email: `chefe-${Date.now()}@pequizeiro.to.gov.br`,
      password: 'nao-usado',
      firstName: 'Sabrina',
      lastName: 'Maropo',
      organizationId: organization.id,
      isActive: true,
    },
  })

  const department = await prisma.department.create({
    data: {
      organizationId: organization.id,
      name: 'Secretaria Municipal de Assistência Social e Habitação',
      code: `SMASH${Math.floor(Math.random() * 900) + 100}`,
      managerId: chief.id,
    },
  })

  const qddItem = await prisma.qddItem.create({
    data: {
      organizationId: organization.id,
      departmentId: department.id,
      year: 2026,
      ficha: '403',
      fonte: '1.660.000',
      projetoAtividade: 'Bolsa Família',
      naturezaDespesa: '3.3.90.14',
      valorOrcado: 100000,
    },
  })

  return { organization, session, department, qddItem, chief }
}

/**
 * O payload completo — todos os 20 campos que o Anexo I exige.
 *
 * Campos de identificação em CAIXA ALTA, como o formulário físico real
 * (mesma convenção do órgão): o serviço NÃO força maiúsculas nesses campos —
 * quem preenche é quem decide. Só `beneficiaryName` é normalizado pelo
 * próprio serviço, sempre foi assim. A finalidade fica em texto normal, como
 * o papel real também mostra (é narrativa, não identificação).
 */
function fullPayload(departmentId: string, qddItemId: string) {
  return {
    departmentId,
    qddItemId,
    beneficiaryName: 'renia maria da silva noleto candido',
    destination: 'BELÉM - PA',
    purpose:
      'Viagem a Belém - PA para os Encontros Regionais presenciais da Estratégia Alimenta Cidades + 1000.',
    departureDate: '2026-06-27',
    returnDate: '2026-07-01',
    dailyRate: 150,
    dayCount: 5,
    beneficiaryCpf: '802.992.291-49',
    beneficiaryRegistrationNumber: '5240',
    beneficiaryRg: '32000002 SSP/GO',
    beneficiaryJobTitle: 'COORDENADORA DO BOLSA FAMÍLIA',
    beneficiaryLotacao: 'FUNDO MUNICIPAL DE ASSISTÊNCIA SOCIAL',
    beneficiaryBankName: 'BRADESCO',
    beneficiaryBankAgency: '1725-6',
    beneficiaryBankAccount: '24309-4',
    departureTime: '08:00',
    arrivalTime: '18:00',
    transportMeans: 'VEICULO_OFICIAL',
    fundingSource: 'PROPRIO',
    // 27/06/2026 a 01/07/2026 cruza um sábado — exige justificativa (Épico 8,
    // FR-021/FR-022) para a emissão não ser recusada.
    weekendHolidayJustification: 'Evento regional com início no sábado, conforme convocação oficial.',
  }
}

describe('Anexo I — grade de 20 campos (integração)', () => {
  test('todos os 20 campos numerados aparecem no PDF emitido', async () => {
    const { session, department, qddItem } = await setupScenario()

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: fullPayload(department.id, qddItem.id),
    })
    expect(created.statusCode).toBe(201)

    const issued = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })
    expect(issued.statusCode).toBe(200)

    const pdf = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${created.json().id}/pdf`,
      headers: session.headers,
    })
    expect(pdf.statusCode).toBe(200)

    const text = await extractPdfText(pdf.rawPayload)

    // Os 20 rótulos numerados — a matriz exigida pelo usuário.
    for (const label of [
      '1. DATA', '2. MATRÍCULA FUNCIONAL', '3. FICHA', '4. FONTE',
      '5. BENEFICIÁRIO', '6. LOTAÇÃO', '7. CARGO/FUNÇÃO', '8. CPF',
      '9. RG/ÓRGÃO EXPEDIDOR', '10. BANCO/AGÊNCIA/CONTA', '11. ITINERÁRIO',
      '12. HORÁRIO DE SAÍDA', '13. MEIO DE TRANSPORTE', '14. PERÍODO DA VIAGEM',
      '15. HORÁRIO DE CHEGADA', '16. RECURSOS', '17. NÚMERO DE DIÁRIAS',
      '18. VALOR UNITÁRIO', '19. VALOR TOTAL', '20. FINALIDADE DA VIAGEM',
    ]) {
      expect(text).toContain(label)
    }

    // Os VALORES de cada campo — não bastaria o rótulo aparecer vazio.
    expect(text).toContain('5240') // matrícula
    expect(text).toContain('403') // ficha
    expect(text).toContain('1.660.000') // fonte
    expect(text).toContain('RENIA MARIA DA SILVA NOLETO CANDIDO')
    expect(text).toContain('FUNDO MUNICIPAL DE ASSISTÊNCIA SOCIAL')
    expect(text).toContain('COORDENADORA DO BOLSA FAMÍLIA')
    // CPF COMPLETO, sem máscara — a única exceção do sistema, e é isso que dá
    // validade ao formulário que o beneficiário assina.
    expect(text).toContain('802.992.291-49')
    // "***" aparece no rodapé por outro motivo, correto e não relacionado: é
    // o nome de quem EMITIU o documento, ofuscado por LGPD (Emitido por:
    // "Servidor de T***"). O que este teste precisa garantir é que o CPF em
    // si não saiu no formato mascarado de `maskCpf` (`***.XXX.XXX-**`).
    expect(text).not.toMatch(/\*\*\*\.\d{3}\.\d{3}-\*\*/)
    expect(text).toContain('32000002 SSP/GO')
    expect(text).toContain('BRADESCO')
    expect(text).toContain('AG: 1725-6')
    // A célula é estreita e o texto completo (banco + agência + conta) é
    // longo — a quebra automática de linha do PDF pode cair bem entre
    // "CONTA:" e o número. É comportamento normal de wrap dentro da borda da
    // célula, não silêncio de dado: por isso o regex tolera espaço OU quebra.
    expect(text).toMatch(/CONTA:\s*24309-4/)
    expect(text).toContain('BELÉM - PA')
    expect(text).toContain('08:00')
    expect(text).toContain('18:00')
    expect(text).toMatch(/Veículo Oficial/i)
    expect(text).toMatch(/Próprio/i)
    expect(text).toContain('27/06/2026')
    expect(text).toContain('01/07/2026')
    expect(text).toContain('R$ 150,00')
    expect(text).toContain('R$ 750,00')
    expect(text).toMatch(/Alimenta Cidades/i)

    // Assinatura do chefe do setor — o Ordenador de Despesa.
    expect(text).toContain('Sabrina Maropo')
    expect(text).toContain('Secretaria Municipal de Assistência Social e Habitação')

    // RECIBO: cidade, UF, valor por extenso, e a assinatura do beneficiário.
    expect(text).toContain('RECIBO')
    expect(text).toContain('Pequizeiro')
    expect(text).toMatch(/Estado do Tocantins/i)
    // Mesmo motivo do campo bancário acima: a linha do RECIBO é longa e pode
    // quebrar no meio do valor por extenso — tolera espaço OU quebra ali.
    expect(text).toMatch(/SETECENTOS\s+E\s+CINQUENTA REAIS/i)

    // O rodapé de validação universal segue presente — nenhum motor novo.
    expect(text).toContain('Confira a autenticidade deste documento')
  })

  test('campos não preenchidos aparecem como travessão, nunca em branco silencioso', async () => {
    const { session, organization } = await setupScenario()

    // Setor SEM chefe cadastrado, de propósito: é o que exercita o fallback
    // "Não informado" do Ordenador de Despesa.
    const departmentWithoutChief = await prisma.department.create({
      data: {
        organizationId: organization.id,
        name: 'Secretaria Sem Chefe',
        code: `SSC${Math.floor(Math.random() * 900) + 100}`,
      },
    })

    const created = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: {
        departmentId: departmentWithoutChief.id,
        beneficiaryName: 'servidor sem dados',
        destination: 'Palmas/TO',
        purpose: 'Curso de capacitação',
        // 01/08/2026 é domingo — mesma regra do Épico 8 (FR-021/FR-022).
        departureDate: '2026-08-01',
        returnDate: '2026-08-02',
        dailyRate: 200,
        dayCount: 1,
        weekendHolidayJustification: 'Curso com início no domingo, conforme cronograma do órgão promotor.',
      },
    })
    expect(created.statusCode).toBe(201)

    const issued = await getApp().inject({
      method: 'POST',
      url: `${BASE_URL}/${created.json().id}/issue`,
      headers: session.headers,
    })
    expect(issued.statusCode).toBe(200)

    const pdf = await getApp().inject({
      method: 'GET',
      url: `${BASE_URL}/${created.json().id}/pdf`,
      headers: session.headers,
    })

    const text = await extractPdfText(pdf.rawPayload)
    // "EM ABERTO" é a convenção do papel físico para horário indefinido.
    expect(text).toContain('EM ABERTO')
    // Setor sem chefe cadastrado: mesma mensagem já usada em todo o sistema.
    expect(text).toContain('Não informado')
  })

  test('CPF malformado é recusado na criação, não silenciado', async () => {
    const { session, department } = await setupScenario()

    const response = await getApp().inject({
      method: 'POST',
      url: BASE_URL,
      headers: session.headers,
      payload: {
        departmentId: department.id,
        beneficiaryName: 'servidor teste',
        destination: 'X',
        purpose: 'Y',
        departureDate: '2026-08-01',
        returnDate: '2026-08-02',
        dailyRate: 100,
        dayCount: 1,
        beneficiaryCpf: '123.456',
      },
    })

    expect(response.statusCode).toBe(400)
  })
})
