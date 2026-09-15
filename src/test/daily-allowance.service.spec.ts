import { Decimal } from '@prisma/client/runtime/library'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Diárias de servidor (Épico 3, Task 3.1).
 *
 * Prisma, storage e geração de PDF são mockados: o que se testa aqui são as
 * REGRAS — isolamento multi-tenant, cálculo do valor e a imutabilidade após a
 * emissão. A geração real de PDF tem sua própria suíte.
 */

const findFirstMock = vi.fn()
const findManyMock = vi.fn()
const countMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const updateManyMock = vi.fn()
const findUniqueOrThrowMock = vi.fn()
const aggregateMock = vi.fn()
const qddFindFirstMock = vi.fn()
const qddFindUniqueMock = vi.fn()
const virtualProcessAggregateMock = vi.fn()
const virtualProcessGroupByMock = vi.fn()
const holidaysInRangeMock = vi.fn()
const deleteMock = vi.fn()
const orgFindUniqueMock = vi.fn()
const saveFileMock = vi.fn()
const createPdfMock = vi.fn()
const createFormPdfMock = vi.fn()
const auditRecordMock = vi.fn()
const registerExportMock = vi.fn()

vi.mock('@/lib/prisma.js', () => {
  // Os mesmos delegates servem ao cliente normal e ao transacional: o serviço
  // usa `tx.dailyAllowance` dentro da transação, e apontar os dois para os
  // mesmos espiões deixa as asserções valerem independentemente de a chamada
  // ter acontecido dentro ou fora dela.
  const dailyAllowance = {
    findFirst: (...a: unknown[]) => findFirstMock(...a),
    findMany: (...a: unknown[]) => findManyMock(...a),
    count: (...a: unknown[]) => countMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    updateMany: (...a: unknown[]) => updateManyMock(...a),
    findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowMock(...a),
    aggregate: (...a: unknown[]) => aggregateMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  }
  const qddItem = {
    findFirst: (...a: unknown[]) => qddFindFirstMock(...a),
    findUnique: (...a: unknown[]) => qddFindUniqueMock(...a),
  }
  // Épico 8: `budgetService.detectOverrun`/`getBalancesForItems` somam também
  // `VirtualProcess` vinculado à ficha — precisa do mesmo espião, mesmo que
  // nenhum teste desta suíte cadastre processo algum.
  const virtualProcess = {
    aggregate: (...a: unknown[]) => virtualProcessAggregateMock(...a),
    groupBy: (...a: unknown[]) => virtualProcessGroupByMock(...a),
  }

  return {
    prisma: {
      dailyAllowance,
      qddItem,
      virtualProcess,
      beneficiary: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
      // `$transaction` interativo: executa a função recebida na hora. Não
      // simula rollback — o que se testa aqui são as regras, e a atomicidade de
      // verdade é exercida contra o Postgres na suíte E2E.
      $transaction: (fn: (tx: unknown) => unknown) => fn({ dailyAllowance, qddItem, virtualProcess }),
    },
  }
})

vi.mock('@/services/storage.service.js', () => ({
  saveFile: (...a: unknown[]) => saveFileMock(...a),
  getFilePath: (key: string) => `/uploads/${key}`,
}))

vi.mock('@/services/document-pdf.service.js', () => ({
  // `createOfficialPdf` segue de pé para o Anexo II (accountFor); o Anexo I
  // (issue) passou a usar `createFormDocumentPdf`, a grade numerada — os dois
  // precisam de espiões PRÓPRIOS, senão uma asserção no formato errado passaria
  // por acidente.
  createOfficialPdf: (...a: unknown[]) => createPdfMock(...a),
  createFormDocumentPdf: (...a: unknown[]) => createFormPdfMock(...a),
}))

vi.mock('@/services/exported-document.service.js', () => ({
  exportedDocumentService: {
    newPublicId: () => 'public-id-de-teste',
    register: (...a: unknown[]) => registerExportMock(...a),
  },
}))

vi.mock('@/services/audit-ledger.service.js', () => ({
  auditLedgerService: { record: (...a: unknown[]) => auditRecordMock(...a) },
}))

vi.mock('@/services/holiday.service.js', () => ({
  holidayService: { getHolidaysInRange: (...a: unknown[]) => holidaysInRangeMock(...a) },
}))

const {
  dailyAllowanceService,
  calculateTotalAmount,
  isAccountabilityLate,
  touchesWeekendOrHoliday,
  DailyAllowanceError,
} = await import('../services/daily-allowance.service.js')

const SCOPE = { organizationId: 'org-1', userId: 'issuer-1' }

/** Rascunho: sem sha256Hash, ainda editável. */
const DRAFT = {
  id: 'da-1',
  publicId: 'pub-1',
  organizationId: 'org-1',
  beneficiaryName: 'JOÃO DA SILVA',
  destination: 'Brasília/DF',
  purpose: 'Reunião no ministério',
  departureDate: new Date('2026-09-10T00:00:00Z'),
  returnDate: new Date('2026-09-12T00:00:00Z'),
  dailyRate: 350,
  dayCount: 2.5,
  totalAmount: 875,
  sha256Hash: null,
  pdfFileKey: null,
  status: 'PENDING',
  budgetOverrun: false,
  accountabilityDate: null,
  accountabilityPdfFileKey: null,
  accountabilityPublicId: null,
  departmentId: 'dept-1',
  department: { id: 'dept-1', name: 'Secretaria de Teste', code: 'ST01' },
  qddItemId: null,
  qddItem: null,
  createdBy: { id: 'issuer-1', firstName: 'Maria', lastName: 'Souza' },
  // O período (10 a 12/set/2026) vai de quinta a sábado — TOCA fim de semana.
  // Preenchida aqui para que os testes de emissão que não são SOBRE a regra
  // do Épico 8 não precisem conhecê-la; a regra em si ganha describe própria.
  weekendHolidayJustification: 'Reunião extraordinária de última hora, autorizada pelo secretário.',
}

/** Emitido: hash publicado, portanto congelado. */
const ISSUED = {
  ...DRAFT,
  sha256Hash: 'a'.repeat(64),
  pdfFileKey: 'org-1/da/x.pdf',
  status: 'ISSUED',
}

describe('Diárias de servidor (Task 3.1)', () => {
  beforeEach(() => {
    for (const m of [
      findFirstMock, findManyMock, countMock, createMock, updateMock, updateManyMock,
      findUniqueOrThrowMock, aggregateMock, qddFindFirstMock, qddFindUniqueMock,
      virtualProcessAggregateMock, virtualProcessGroupByMock, holidaysInRangeMock,
      deleteMock, orgFindUniqueMock, saveFileMock, createPdfMock, createFormPdfMock,
      auditRecordMock, registerExportMock,
    ]) m.mockReset()

    findManyMock.mockResolvedValue([])
    countMock.mockResolvedValue(0)
    createMock.mockResolvedValue(DRAFT)
    updateMock.mockResolvedValue(ISSUED)
    // A trava de corrida acerta o registro: `count: 1` é o caminho feliz.
    updateManyMock.mockResolvedValue({ count: 1 })
    findUniqueOrThrowMock.mockResolvedValue(ISSUED)
    // `_max` sustenta a numeração da diária (Épico 8, `create`); `_sum`
    // sustenta a detecção de estouro (`issue`) — o mesmo espião serve aos
    // dois usos de `dailyAllowance.aggregate`.
    aggregateMock.mockResolvedValue({ _sum: { totalAmount: null }, _max: { sequenceNumber: null } })
    virtualProcessAggregateMock.mockResolvedValue({ _sum: { totalValue: null } })
    virtualProcessGroupByMock.mockResolvedValue([])
    // Sem feriado cadastrado por padrão — só o fim de semana entra na conta,
    // a menos que um teste específico sobrescreva.
    holidaysInRangeMock.mockResolvedValue([])
    qddFindFirstMock.mockResolvedValue({ id: 'qdd-1' })
    orgFindUniqueMock.mockResolvedValue({ name: 'Prefeitura de Exemplo', city: 'Exemplo', state: 'TO' })
    saveFileMock.mockResolvedValue('org-1/daily-allowances/x.pdf')
    const pdfResult = {
      bytes: new Uint8Array([1, 2, 3]),
      sha256Hash: 'b'.repeat(64),
      validationUrl: 'https://exemplo/validar-documento/pub-1',
    }
    createPdfMock.mockResolvedValue(pdfResult)
    createFormPdfMock.mockResolvedValue(pdfResult)
    auditRecordMock.mockResolvedValue(undefined)
  })

  describe('cálculo do valor', () => {
    test('multiplica valor unitário pela quantidade de diárias', () => {
      expect(calculateTotalAmount(350, 2)).toBe(700)
    })

    test('meia diária é suportada (praxe quando não há pernoite)', () => {
      expect(calculateTotalAmount(350, 2.5)).toBe(875)
    })

    test('arredonda a 2 casas, sem sujeira de ponto flutuante', () => {
      // 0.1 * 3 = 0.30000000000000004 em ponto flutuante.
      expect(calculateTotalAmount(0.1, 3)).toBe(0.3)
      expect(calculateTotalAmount(33.333, 3)).toBe(100)
    })
  })

  describe('criação', () => {
    test('o total é calculado no servidor, não aceito do cliente', async () => {
      await dailyAllowanceService.create(
        {
          departmentId: 'dept-1',
          beneficiaryName: 'joão da silva',
          destination: 'Brasília/DF',
          purpose: 'Reunião',
          departureDate: new Date('2026-09-10'),
          returnDate: new Date('2026-09-12'),
          dailyRate: 350,
          dayCount: 2,
        },
        SCOPE
      )

      const { data } = createMock.mock.calls[0][0]
      expect(Number(data.totalAmount)).toBe(700)
      // O nome é gravado SEMPRE em caixa alta, qualquer que seja a digitação.
      expect(data.beneficiaryName).toBe('JOÃO DA SILVA')
      // organizationId e emissor vêm do escopo do token.
      expect(data.organizationId).toBe('org-1')
      expect(data.createdById).toBe('issuer-1')
    })

    test('recusa retorno anterior à saída', async () => {
      await expect(
        dailyAllowanceService.create(
          {
            departmentId: 'dept-1',
            beneficiaryName: 'Fulano',
            destination: 'X',
            purpose: 'Y',
            departureDate: new Date('2026-09-12'),
            returnDate: new Date('2026-09-10'),
            dailyRate: 100,
            dayCount: 1,
          },
          SCOPE
        )
      ).rejects.toThrow(DailyAllowanceError)

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('isolamento multi-tenant', () => {
    test('a listagem sempre filtra pela organização do token', async () => {
      await dailyAllowanceService.list({ page: 1, limit: 20 }, SCOPE)
      expect(findManyMock.mock.calls[0][0].where.organizationId).toBe('org-1')
    })

    test('buscar por id não alcança outra organização', async () => {
      findFirstMock.mockResolvedValue(null)

      await expect(dailyAllowanceService.getById('da-9', SCOPE)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      expect(findFirstMock.mock.calls[0][0].where).toMatchObject({
        id: 'da-9',
        organizationId: 'org-1',
      })
    })
  })

  describe('imutabilidade após a emissão', () => {
    test('rascunho pode ser editado', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      updateMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.update('da-1', { destination: 'Goiânia/GO' }, SCOPE)
      expect(updateMock).toHaveBeenCalledTimes(1)
    })

    test('emitido NÃO pode ser editado', async () => {
      // Editar depois de emitir faria o hash publicado divergir do documento,
      // e o Portal de Validação acusaria adulteração num papel legítimo.
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(
        dailyAllowanceService.update('da-1', { destination: 'Outro' }, SCOPE)
      ).rejects.toMatchObject({ code: 'ALREADY_ISSUED' })

      expect(updateMock).not.toHaveBeenCalled()
    })

    test('emitido NÃO pode ser excluído', async () => {
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(dailyAllowanceService.remove('da-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(deleteMock).not.toHaveBeenCalled()
    })

    test('rascunho pode ser excluído', async () => {
      findFirstMock.mockResolvedValue(DRAFT)
      deleteMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.remove('da-1', SCOPE)
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('emissão', () => {
    test('gera o PDF, persiste o arquivo e grava o hash', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      // Anexo I passou a sair pelo motor de grade — o Recibo de Diária virou
      // o formulário numerado, não mais a lista de seções.
      expect(createFormPdfMock).toHaveBeenCalledTimes(1)
      expect(createFormPdfMock.mock.calls[0][0]).toMatchObject({
        title: 'FORMULÁRIO DE AFASTAMENTO E CONCESSÃO DE DIÁRIAS',
        publicId: 'pub-1',
      })

      expect(saveFileMock).toHaveBeenCalledTimes(1)

      // A gravação passa por `updateMany` para carregar a trava de corrida no
      // próprio filtro — ver o comentário em `issue`.
      const { where, data } = updateManyMock.mock.calls[0][0]
      expect(where).toMatchObject({ id: 'da-1', organizationId: 'org-1', sha256Hash: null })
      expect(data.sha256Hash).toBe('b'.repeat(64))
      expect(data.pdfFileKey).toBe('org-1/daily-allowances/x.pdf')
      expect(data.issuedAt).toBeInstanceOf(Date)
      expect(data.status).toBe('ISSUED')
    })

    test('a emissão perdida na corrida é recusada, não sobrescreve', async () => {
      // Dois cliques simultâneos em "Emitir": o segundo encontra o registro já
      // com hash, `updateMany` não acerta ninguém e a emissão precisa falhar —
      // sobrescrever invalidaria o PDF que o primeiro já baixou.
      findFirstMock.mockResolvedValue(DRAFT)
      updateManyMock.mockResolvedValue({ count: 0 })

      await expect(dailyAllowanceService.issue('da-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
    })

    test('registra a emissão na trilha de auditoria', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(auditRecordMock.mock.calls[0][0]).toMatchObject({
        action: 'DAILY_ALLOWANCE_ISSUED',
        resource: 'DAILY_ALLOWANCE',
        organizationId: 'org-1',
      })
    })

    test('não emite duas vezes', async () => {
      // Reemitir criaria um segundo documento com hash diferente para a mesma
      // diária, e o primeiro, já entregue, passaria a ser inválido.
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(dailyAllowanceService.issue('da-1', SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ISSUED',
      })
      expect(createFormPdfMock).not.toHaveBeenCalled()
    })
  })

  describe('download', () => {
    test('recusa download de diária ainda não emitida', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await expect(dailyAllowanceService.getPdf('da-1', SCOPE)).rejects.toMatchObject({
        code: 'NOT_ISSUED',
      })
    })
  })

  // ── Épico 4 ──

  describe('snapshot da dotação', () => {
    const DRAFT_WITH_QDD = {
      ...DRAFT,
      qddItemId: 'qdd-1',
      qddItem: {
        id: 'qdd-1',
        ficha: '0042',
        fonte: '1500',
        naturezaDespesa: '3.3.90.14',
        year: 2026,
      },
    }

    test('copia ficha, fonte e natureza no instante da emissão', async () => {
      // Cópia textual: se a ficha for remanejada amanhã, o documento já
      // entregue precisa continuar descrevendo a dotação que o lastreou.
      findFirstMock.mockResolvedValue(DRAFT_WITH_QDD)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(updateManyMock.mock.calls[0][0].data).toMatchObject({
        qddFichaSnapshot: '0042',
        qddFonteSnapshot: '1500',
        qddNaturezaSnapshot: '3.3.90.14',
      })
    })

    test('diária sem dotação emite normalmente, sem snapshot', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      const { data } = updateManyMock.mock.calls[0][0]
      expect(data.qddFichaSnapshot).toBeUndefined()
    })

    test('a dotação precisa ser da MESMA organização', async () => {
      // A chave estrangeira aceitaria o id de outro tenant: ela não sabe nada
      // sobre organizações.
      qddFindFirstMock.mockResolvedValue(null)

      await expect(
        dailyAllowanceService.create(
          {
            departmentId: 'dept-1',
            qddItemId: 'qdd-de-outra-prefeitura',
            beneficiaryName: 'Fulano',
            destination: 'Brasília/DF',
            purpose: 'Reunião',
            departureDate: new Date('2026-09-10T00:00:00Z'),
            returnDate: new Date('2026-09-12T00:00:00Z'),
            dailyRate: 350,
            dayCount: 2,
          },
          SCOPE
        )
      ).rejects.toMatchObject({ code: 'INVALID_QDD_ITEM' })

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('estouro de dotação', () => {
    const DRAFT_WITH_QDD = {
      ...DRAFT,
      qddItemId: 'qdd-1',
      qddItem: { id: 'qdd-1', ficha: '0042', fonte: '1500', naturezaDespesa: '3.3.90.14', year: 2026 },
    }

    test('ALERTA e emite quando o empenhado passa do orçado', async () => {
      // Regra do Épico 4: suplementação e remanejamento são rotina na
      // administração pública. Bloquear engessaria o município; o que o sistema
      // deve é deixar rastro.
      findFirstMock.mockResolvedValue(DRAFT_WITH_QDD)
      qddFindUniqueMock.mockResolvedValue({ valorOrcado: new Decimal(1000) })
      aggregateMock.mockResolvedValue({ _sum: { totalAmount: new Decimal(1875) } })

      await dailyAllowanceService.issue('da-1', SCOPE)

      // Emitiu: o PDF foi gerado e o hash, gravado.
      expect(createFormPdfMock).toHaveBeenCalledTimes(1)
      expect(updateMock.mock.calls[0][0]).toMatchObject({
        where: { id: 'da-1' },
        data: { budgetOverrun: true },
      })
    })

    test('não marca estouro quando ainda cabe na dotação', async () => {
      findFirstMock.mockResolvedValue(DRAFT_WITH_QDD)
      qddFindUniqueMock.mockResolvedValue({ valorOrcado: new Decimal(10000) })
      aggregateMock.mockResolvedValue({ _sum: { totalAmount: new Decimal(1875) } })

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(updateMock).not.toHaveBeenCalled()
    })

    test('gastar exatamente o orçado NÃO é estouro', async () => {
      // A dotação é um teto: consumi-la por inteiro é execução orçamentária
      // normal. Marcar alerta aqui encheria a auditoria de ruído.
      findFirstMock.mockResolvedValue(DRAFT_WITH_QDD)
      qddFindUniqueMock.mockResolvedValue({ valorOrcado: new Decimal(1875) })
      aggregateMock.mockResolvedValue({ _sum: { totalAmount: new Decimal(1875) } })

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('atraso na prestação de contas', () => {
    const RETURN_DATE = new Date('2026-09-12T00:00:00Z')

    test('no quinto dia ainda está no prazo', async () => {
      const late = isAccountabilityLate(
        { status: 'ISSUED', accountabilityDate: null, returnDate: RETURN_DATE },
        new Date('2026-09-17T00:00:00Z')
      )
      expect(late).toBe(false)
    })

    test('passado o quinto dia, está em atraso', async () => {
      const late = isAccountabilityLate(
        { status: 'ISSUED', accountabilityDate: null, returnDate: RETURN_DATE },
        new Date('2026-09-17T00:00:01Z')
      )
      expect(late).toBe(true)
    })

    test('rascunho nunca atrasa — não houve despesa', async () => {
      const late = isAccountabilityLate(
        { status: 'PENDING', accountabilityDate: null, returnDate: RETURN_DATE },
        new Date('2027-01-01T00:00:00Z')
      )
      expect(late).toBe(false)
    })

    test('contas já prestadas não atrasam retroativamente', async () => {
      const late = isAccountabilityLate(
        {
          status: 'ACCOUNTED',
          accountabilityDate: new Date('2026-09-30T00:00:00Z'),
          returnDate: RETURN_DATE,
        },
        new Date('2027-01-01T00:00:00Z')
      )
      expect(late).toBe(false)
    })
  })

  describe('prestação de contas (Anexo II)', () => {
    const INPUT = {
      accountabilityDate: new Date('2026-09-15T00:00:00Z'),
      activityReport: 'Participação na reunião técnica do ministério.',
    }

    test('emite documento com identificador PRÓPRIO, distinto do Anexo I', async () => {
      // São dois papéis circulando. Reaproveitar o publicId faria o Portal
      // devolver o documento errado para metade dos QR Codes. O Anexo II
      // passou a sair pelo motor de grade também (Épico 8) — mesma cartilha
      // oficial, mesmo motor do Anexo I.
      findFirstMock.mockResolvedValue(ISSUED)
      findUniqueOrThrowMock.mockResolvedValue({ ...ISSUED, status: 'ACCOUNTED' })

      await dailyAllowanceService.accountFor('da-1', INPUT, SCOPE)

      expect(createFormPdfMock.mock.calls[0][0]).toMatchObject({
        title: 'PRESTAÇÃO DE CONTAS DE DIÁRIA (ANEXO II)',
        publicId: 'public-id-de-teste',
      })
      expect(createFormPdfMock.mock.calls[0][0].publicId).not.toBe(ISSUED.publicId)

      expect(updateManyMock.mock.calls[0][0].data).toMatchObject({
        status: 'ACCOUNTED',
        accountabilityPublicId: 'public-id-de-teste',
        accountabilitySha256Hash: 'b'.repeat(64),
      })
    })

    test('o rodapé instrui sobre comprovantes e notas fiscais', async () => {
      findFirstMock.mockResolvedValue(ISSUED)
      findUniqueOrThrowMock.mockResolvedValue({ ...ISSUED, status: 'ACCOUNTED' })

      await dailyAllowanceService.accountFor('da-1', INPUT, SCOPE)

      expect(createFormPdfMock.mock.calls[0][0].footNote).toMatch(/notas fiscais/i)
    })

    test('não se presta contas de diária ainda não emitida', async () => {
      findFirstMock.mockResolvedValue(DRAFT)

      await expect(dailyAllowanceService.accountFor('da-1', INPUT, SCOPE)).rejects.toMatchObject({
        code: 'NOT_ISSUED',
      })
      expect(createFormPdfMock).not.toHaveBeenCalled()
    })

    test('não se presta contas duas vezes', async () => {
      findFirstMock.mockResolvedValue({ ...ISSUED, status: 'ACCOUNTED' })

      await expect(dailyAllowanceService.accountFor('da-1', INPUT, SCOPE)).rejects.toMatchObject({
        code: 'ALREADY_ACCOUNTED',
      })
    })

    test('a prestação não pode anteceder a saída', async () => {
      findFirstMock.mockResolvedValue(ISSUED)

      await expect(
        dailyAllowanceService.accountFor(
          'da-1',
          { ...INPUT, accountabilityDate: new Date('2026-01-01T00:00:00Z') },
          SCOPE
        )
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' })
    })
  })

  // ── Épico 8 ──

  describe('fim de semana e feriado (função pura)', () => {
    test('período todo em dias úteis não toca fim de semana nem feriado', () => {
      // Segunda a quarta.
      const touches = touchesWeekendOrHoliday(
        new Date('2026-09-14T00:00:00Z'),
        new Date('2026-09-16T00:00:00Z'),
        []
      )
      expect(touches).toBe(false)
    })

    test('período que inclui sábado toca fim de semana', () => {
      const touches = touchesWeekendOrHoliday(
        new Date('2026-09-10T00:00:00Z'), // quinta
        new Date('2026-09-12T00:00:00Z'), // sábado
        []
      )
      expect(touches).toBe(true)
    })

    test('um único dia de retorno em domingo já conta', () => {
      const touches = touchesWeekendOrHoliday(
        new Date('2026-09-13T00:00:00Z'), // domingo
        new Date('2026-09-13T00:00:00Z'),
        []
      )
      expect(touches).toBe(true)
    })

    test('dias úteis com feriado cadastrado no meio toca feriado', () => {
      // Segunda a quarta, com feriado municipal na terça.
      const touches = touchesWeekendOrHoliday(
        new Date('2026-09-14T00:00:00Z'),
        new Date('2026-09-16T00:00:00Z'),
        [{ date: new Date('2026-09-15T00:00:00Z') }]
      )
      expect(touches).toBe(true)
    })

    test('feriado fora do período não conta', () => {
      const touches = touchesWeekendOrHoliday(
        new Date('2026-09-14T00:00:00Z'),
        new Date('2026-09-16T00:00:00Z'),
        [{ date: new Date('2026-12-25T00:00:00Z') }]
      )
      expect(touches).toBe(false)
    })
  })

  describe('justificativa de fim de semana/feriado na emissão (Épico 8, FR-021/FR-022)', () => {
    // Segunda (14/set) a quarta (16/set) — dias úteis, sem feriado.
    const DRAFT_WEEKDAYS_ONLY = {
      ...DRAFT,
      departureDate: new Date('2026-09-14T00:00:00Z'),
      returnDate: new Date('2026-09-16T00:00:00Z'),
      weekendHolidayJustification: null,
    }

    test('período em dias úteis emite normalmente, sem justificativa', async () => {
      findFirstMock.mockResolvedValue(DRAFT_WEEKDAYS_ONLY)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(updateManyMock).toHaveBeenCalledTimes(1)
    })

    test('período que toca sábado/domingo SEM justificativa é recusado', async () => {
      // DRAFT vai de quinta a sábado; aqui a justificativa é removida de
      // propósito para exercitar a trava.
      findFirstMock.mockResolvedValue({ ...DRAFT, weekendHolidayJustification: null })

      await expect(dailyAllowanceService.issue('da-1', SCOPE)).rejects.toMatchObject({
        code: 'WEEKEND_JUSTIFICATION_REQUIRED',
      })
      expect(updateManyMock).not.toHaveBeenCalled()
      expect(createFormPdfMock).not.toHaveBeenCalled()
    })

    test('período que toca fim de semana COM justificativa é aceito', async () => {
      // O DRAFT padrão já vem com justificativa preenchida — cobre o caminho
      // feliz sem precisar duplicar a asserção do describe de emissão.
      findFirstMock.mockResolvedValue(DRAFT)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(updateManyMock).toHaveBeenCalledTimes(1)
    })

    test('feriado cadastrado em dias úteis também exige justificativa', async () => {
      findFirstMock.mockResolvedValue(DRAFT_WEEKDAYS_ONLY)
      // Terça (15/set), dentro do período segunda-quarta, cadastrada como feriado.
      holidaysInRangeMock.mockResolvedValue([{ date: new Date('2026-09-15T00:00:00Z') }])

      await expect(dailyAllowanceService.issue('da-1', SCOPE)).rejects.toMatchObject({
        code: 'WEEKEND_JUSTIFICATION_REQUIRED',
      })
    })

    test('a checagem de feriado é escopada pela organização do token', async () => {
      findFirstMock.mockResolvedValue(DRAFT_WEEKDAYS_ONLY)

      await dailyAllowanceService.issue('da-1', SCOPE)

      expect(holidaysInRangeMock).toHaveBeenCalledWith(
        'org-1',
        DRAFT_WEEKDAYS_ONLY.departureDate,
        DRAFT_WEEKDAYS_ONLY.returnDate
      )
    })
  })
})
