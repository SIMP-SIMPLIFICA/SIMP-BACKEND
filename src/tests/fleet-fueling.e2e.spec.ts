import { createHash, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'vitest'
import { budgetService } from '@/services/budget.service.js'
import { deleteFile, readFile } from '@/services/storage.service.js'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { extractPdfText } from './pdf-text.helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Simplifica Frotas — TASK 3A: contratos de combustível e emissão da
 * autorização de abastecimento. Pilha inteira, nada mockado: JWT, módulo,
 * RBAC no banco, escopo por departamento, .strict(), PDF real, hash,
 * ExportedDocument, saldo de contrato e de ficha QDD, auditoria na transação.
 */

const BASE = '/api/v1/fleet'
const MODULES = ['fleetFuelings', 'fleet']
const ALL = ['fleet:read', 'fleet:manage', 'fleet:authorize_fuel', 'fleet:all_departments']
const SUPPLIER_CNPJ = '11.222.333/0001-81'

const pdfKeys: string[] = []
afterAll(async () => {
  await Promise.all(pdfKeys.map(k => deleteFile(k)))
})

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  getApp().inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) })

function isoDaysFromNow(days: number) {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

let seq = 0

async function createVehicle(organizationId: string, createdById: string, overrides: Record<string, unknown> = {}) {
  seq++
  return prisma.fleetVehicle.create({
    data: {
      organizationId,
      createdById,
      plate: `ABC${String(1000 + seq).slice(-4)}`,
      ownership: 'PROPRIO',
      assetTag: `PAT-${seq}-${randomUUID().slice(0, 4)}`,
      vehicleType: 'AUTOMOVEL',
      fuelType: 'FLEX',
      tankCapacityL: '55',
      makeModel: 'Spin 1.8',
      odometerKm: 84210,
      ...overrides,
    },
  })
}

async function createDriver(organizationId: string, createdById: string, overrides: Record<string, unknown> = {}) {
  seq++
  return prisma.fleetDriver.create({
    data: {
      organizationId,
      createdById,
      name: `João Pereira ${seq}`,
      cpfEncrypted: 'v1.teste',
      cpfBlindIndex: `idx-${randomUUID()}`,
      cnhNumberEncrypted: 'v1.teste',
      cnhCategory: 'B',
      cnhExpiry: new Date(`${isoDaysFromNow(400)}T00:00:00Z`),
      cnhStatus: 'REGULAR',
      employmentKind: 'CONTRATADO',
      ...overrides,
    },
  })
}

async function scenario(permissions: string[] = ALL, modules: string[] = MODULES) {
  const organization = await createTestOrganization({ modules })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })
  const department = await prisma.department.create({
    data: { organizationId: organization.id, name: 'Secretaria de Saúde', code: `SS${Math.floor(Math.random() * 90000) + 10000}` },
  })
  const vehicle = await createVehicle(organization.id, session.user.id, { departmentId: department.id })
  const driver = await createDriver(organization.id, session.user.id, { departmentId: department.id })
  const qddItem = await prisma.qddItem.create({
    data: {
      organizationId: organization.id,
      departmentId: department.id,
      year: Number(isoDaysFromNow(0).slice(0, 4)),
      ficha: '1234',
      fonte: '1500',
      projetoAtividade: '2.010',
      naturezaDespesa: '3.3.90.30',
      valorOrcado: '18420.00',
    },
  })
  return { organization, session, department, vehicle, driver, qddItem }
}

type Scenario = Awaited<ReturnType<typeof scenario>>

function contractPayload(overrides: Record<string, unknown> = {}) {
  return {
    number: `012/${++seq}`,
    supplierName: 'Auto Posto Pequizeiro',
    supplierCnpj: SUPPLIER_CNPJ,
    object: 'Fornecimento de gasolina comum',
    fuelType: 'GASOLINA',
    unitPrice: '6.19',
    totalAmount: '50000',
    startDate: isoDaysFromNow(-30),
    endDate: isoDaysFromNow(300),
    ...overrides,
  }
}

async function createContract(s: Scenario, overrides: Record<string, unknown> = {}) {
  const response = await inject('POST', `${BASE}/contracts`, s.session.headers, contractPayload(overrides))
  expect(response.statusCode).toBe(201)
  return response.json() as { id: string; number: string }
}

function fuelingPayload(s: Scenario, contractId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    departmentId: s.department.id,
    vehicleId: s.vehicle.id,
    driverId: s.driver.id,
    fuelType: 'GASOLINA',
    contractId,
    qddItemId: s.qddItem.id,
    unitPriceCap: '6.19',
    maxVolumeL: '40',
    purpose: 'Transporte de pacientes para Araguaína',
    ...overrides,
  }
}

async function createDraft(s: Scenario, contractId: string | null, overrides: Record<string, unknown> = {}) {
  const response = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, contractId, overrides))
  expect(response.statusCode).toBe(201)
  return response.json() as { id: string; maxAmount: string; warnings: { code: string }[] }
}

async function issue(s: Scenario, id: string) {
  const response = await inject('POST', `${BASE}/fuelings/${id}/issue`, s.session.headers, {})
  if (response.statusCode === 200) {
    const row = await prisma.fleetFueling.findUnique({ where: { id }, select: { pdfFileKey: true } })
    if (row?.pdfFileKey) pdfKeys.push(row.pdfFileKey)
  }
  return response
}

describe('Frotas — contratos de combustível', () => {
  test('cria com CNPJ normalizado e Decimal como string; saldo calculado na leitura', async () => {
    const s = await scenario()
    const contract = await createContract(s)

    const got = (await inject('GET', `${BASE}/contracts/${contract.id}`, s.session.headers)).json()
    expect(got.supplierCnpj).toBe('11222333000181')
    expect(got.unitPrice).toBe('6.19')
    expect(got.availableAmount).toBe('50000')
    expect(got.inForce).toBe(true)

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FLEET_CONTRACT_CREATED', resourceId: contract.id } })
    expect(audit?.organizationId).toBe(s.organization.id)
  })

  test('CNPJ inválido, nº repetido, datas invertidas e campo extra são recusados', async () => {
    const s = await scenario()
    const first = await createContract(s)

    const badCnpj = await inject('POST', `${BASE}/contracts`, s.session.headers, contractPayload({ supplierCnpj: '11.222.333/0001-80' }))
    expect(badCnpj.json().error).toBe('INVALID_CNPJ')

    const duplicate = await inject('POST', `${BASE}/contracts`, s.session.headers, contractPayload({ number: first.number }))
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error).toBe('CONTRACT_ALREADY_REGISTERED')

    const dates = await inject('POST', `${BASE}/contracts`, s.session.headers, contractPayload({ startDate: isoDaysFromNow(10), endDate: isoDaysFromNow(1) }))
    expect(dates.json().error).toBe('INVALID_DATES')

    const extra = await inject('POST', `${BASE}/contracts`, s.session.headers, contractPayload({ organizationId: 'x' }))
    expect(extra.statusCode).toBe(400)
  })

  test('quem só emite autorização vê os contratos, mas não cadastra', async () => {
    const s = await scenario()
    const issuer = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:authorize_fuel', 'fleet:all_departments'] })
    await createContract(s)

    expect((await inject('GET', `${BASE}/contracts`, issuer.headers)).json().data).toHaveLength(1)
    expect((await inject('POST', `${BASE}/contracts`, issuer.headers, contractPayload())).statusCode).toBe(403)
  })
})

describe('Frotas — rascunho da autorização', () => {
  test('opções e sugestões do formulário: veículo preenche combustível, contrato e preço; validade de 3 dias úteis', async () => {
    const s = await scenario()
    const contract = await createContract(s)

    const options = await inject('GET', `${BASE}/fuelings/options?departmentId=${s.department.id}`, s.session.headers)
    expect(options.statusCode).toBe(200)
    const body = options.json()
    expect(body.vehicles.map((v: { id: string }) => v.id)).toContain(s.vehicle.id)
    expect(body.vehicles[0].compatibleFuels).toEqual(['GASOLINA', 'ETANOL'])
    expect(body.drivers.map((d: { id: string }) => d.id)).toContain(s.driver.id)
    expect(body.contracts[0].id).toBe(contract.id)
    expect(body.defaultValidUntil > isoDaysFromNow(0)).toBe(true)

    const suggestions = (
      await inject('GET', `${BASE}/fuelings/suggestions?departmentId=${s.department.id}&vehicleId=${s.vehicle.id}`, s.session.headers)
    ).json()
    expect(suggestions.suggestedFuelType).toBe('GASOLINA')
    expect(suggestions.suggestedContractId).toBe(contract.id)
    expect(suggestions.suggestedUnitPrice).toBe('6.19')
    expect(suggestions.openAuthorization).toBeNull()
  })

  test('valor máximo = litros × preço, calculado no servidor; aviso de tanque', async () => {
    const s = await scenario()
    const contract = await createContract(s)

    const draft = await createDraft(s, contract.id, { maxVolumeL: '60' })
    expect(draft.maxAmount).toBe('371.4')
    expect(draft.warnings.map(w => w.code)).toContain('TANK_CAPACITY_EXCEEDED')

    const byAmount = await createDraft(s, contract.id, { maxVolumeL: null, maxAmount: '100' })
    expect((byAmount as unknown as { maxVolumeL: string }).maxVolumeL).toBe('16.155')

    const inconsistent = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, contract.id, { maxAmount: '999' }))
    expect(inconsistent.json().error).toBe('INVALID_LIMITS')
  })

  test('regras de motorista, combustível, veículo e preço com mensagens orientadoras', async () => {
    const s = await scenario()
    const contract = await createContract(s)

    const diesel = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, null, { fuelType: 'DIESEL_S10' }))
    expect(diesel.statusCode).toBe(422)
    expect(diesel.json().error).toBe('FUEL_INCOMPATIBLE')
    expect(diesel.json().message).toContain('Gasolina ou Etanol')

    const expired = await createDriver(s.organization.id, s.session.user.id, {
      departmentId: s.department.id,
      cnhExpiry: new Date(`${isoDaysFromNow(-5)}T00:00:00Z`),
    })
    const cnh = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, null, { driverId: expired.id }))
    expect(cnh.json().error).toBe('DRIVER_NOT_ELIGIBLE')
    expect(cnh.json().message).toContain('venceu')

    const truck = await createVehicle(s.organization.id, s.session.user.id, {
      departmentId: s.department.id,
      vehicleType: 'CAMINHAO',
      fuelType: 'DIESEL_S10',
    })
    const category = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, null, { vehicleId: truck.id, fuelType: 'DIESEL_S10' }))
    expect(category.json().error).toBe('DRIVER_NOT_ELIGIBLE')
    expect(category.json().message).toContain('categoria C')

    const workshop = await createVehicle(s.organization.id, s.session.user.id, { departmentId: s.department.id, status: 'MANUTENCAO' })
    const unavailable = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, null, { vehicleId: workshop.id }))
    expect(unavailable.json().error).toBe('VEHICLE_UNAVAILABLE')

    const otherDept = await prisma.department.create({ data: { organizationId: s.organization.id, name: 'Educação', code: `ED${seq}` } })
    const foreignVehicle = await createVehicle(s.organization.id, s.session.user.id, { departmentId: otherDept.id })
    const alien = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, null, { vehicleId: foreignVehicle.id }))
    expect(alien.json().error).toBe('INVALID_VEHICLE')

    const price = await inject('POST', `${BASE}/fuelings`, s.session.headers, fuelingPayload(s, contract.id, { unitPriceCap: '6.50' }))
    expect(price.json().error).toBe('UNIT_PRICE_ABOVE_CONTRACT')

    const generalFleet = await createVehicle(s.organization.id, s.session.user.id, { departmentId: null })
    await createDraft(s, contract.id, { vehicleId: generalFleet.id })
  })

  test('.strict(): status, lifecycle e hash nunca entram pelo corpo', async () => {
    const s = await scenario()
    for (const field of ['status', 'lifecycle', 'sha256Hash', 'organizationId']) {
      const response = await inject('POST', `${BASE}/fuelings`, s.session.headers, { ...fuelingPayload(s, null), [field]: 'ISSUED' })
      expect(response.statusCode).toBe(400)
    }
  })

  test('rascunho editável e excluível, com auditoria', async () => {
    const s = await scenario()
    const draft = await createDraft(s, null)

    const edited = await inject('PATCH', `${BASE}/fuelings/${draft.id}`, s.session.headers, { unitPriceCap: '6.00', maxVolumeL: '30' })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().maxAmount).toBe('180')

    const halfLimits = await inject('PATCH', `${BASE}/fuelings/${draft.id}`, s.session.headers, { maxVolumeL: '10' })
    expect(halfLimits.statusCode).toBe(400)

    expect((await inject('DELETE', `${BASE}/fuelings/${draft.id}`, s.session.headers)).statusCode).toBe(204)
    expect((await inject('GET', `${BASE}/fuelings/${draft.id}`, s.session.headers)).statusCode).toBe(404)
    const actions = (await prisma.auditLog.findMany({ where: { resourceId: draft.id }, select: { action: true } })).map(a => a.action)
    expect(actions).toEqual(expect.arrayContaining(['FLEET_AUTHORIZATION_CREATED', 'FLEET_AUTHORIZATION_UPDATED', 'FLEET_AUTHORIZATION_DELETED']))
  })
})

describe('Frotas — emissão', () => {
  test('emite: número, PDF com hash, token só como SHA-256, ExportedDocument, reserva no contrato e na ficha, auditoria', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    const balanceBefore = await budgetService.getQddItemBalance(s.qddItem.id, s.organization.id)

    const response = await issue(s, draft.id)
    expect(response.statusCode).toBe(200)
    const issued = response.json()
    const year = isoDaysFromNow(0).slice(0, 4)
    expect(issued.status).toBe('ISSUED')
    expect(issued.lifecycle).toBe('OPEN')
    expect(issued.formattedNumber).toBe(`0001/${year}`)
    expect(issued.qddFichaSnapshot).toBe('1234')
    expect(issued).not.toHaveProperty('redeemTokenHash')
    expect(issued).not.toHaveProperty('pdfFileKey')

    const row = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })
    expect(row.redeemTokenHash).toMatch(/^[0-9a-f]{64}$/)
    const bytes = await readFile(row.pdfFileKey!)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256Hash)

    const text = await extractPdfText(bytes)
    expect(text).toContain('PARA O POSTO')
    expect(text).toContain('Spin 1.8')
    // Decisão D16: a placa não vai para o papel.
    expect(text).not.toContain(s.vehicle.plate)

    const exported = await prisma.exportedDocument.findFirst({ where: { publicId: row.publicId } })
    expect(exported?.sha256Hash).toBe(row.sha256Hash)

    const balanceAfter = await budgetService.getQddItemBalance(s.qddItem.id, s.organization.id)
    expect(balanceBefore.saldoRestante.minus(balanceAfter.saldoRestante).toString()).toBe('247.6')
    expect((await inject('GET', `${BASE}/contracts/${contract.id}`, s.session.headers)).json().availableAmount).toBe('49752.4')

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FLEET_AUTHORIZATION_ISSUED', resourceId: draft.id } })
    expect(audit).not.toBeNull()
    expect(JSON.stringify(audit?.metadata)).not.toContain(row.redeemTokenHash!)

    const validation = (await inject('GET', `/api/v1/public/documents/validate/${row.publicId}`, {})).json()
    expect(validation.valid).toBe(true)
    expect(validation.document.situation).toBe('Aberta')
    expect(JSON.stringify(validation)).not.toContain(s.vehicle.plate)
  })

  test('duas emissões simultâneas: exatamente um sucesso e um único documento', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)

    const [a, b] = await Promise.all([issue(s, draft.id), issue(s, draft.id)])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(await prisma.exportedDocument.count({ where: { organizationId: s.organization.id } })).toBe(1)
  })

  test('emitida é imutável: editar, excluir e emitir de novo → 409, hash inalterado', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    await issue(s, draft.id)
    const before = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })

    const edit = await inject('PATCH', `${BASE}/fuelings/${draft.id}`, s.session.headers, { purpose: 'Outra finalidade qualquer aqui' })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error).toBe('ALREADY_ISSUED')
    expect((await inject('DELETE', `${BASE}/fuelings/${draft.id}`, s.session.headers)).statusCode).toBe(409)
    expect((await issue(s, draft.id)).statusCode).toBe(409)

    const after = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })
    expect(after.sha256Hash).toBe(before.sha256Hash)
    expect(after.purpose).toBe(before.purpose)
  })

  test('sem contrato ou sem ficha não emite; saldo do contrato bloqueia sem deixar PDF órfão', async () => {
    const s = await scenario()
    const noContract = await createDraft(s, null)
    expect((await issue(s, noContract.id)).json().error).toBe('CONTRACT_REQUIRED')

    const tight = await createContract(s, { totalAmount: '100' })
    const draft = await createDraft(s, tight.id)
    const blocked = await issue(s, draft.id)
    expect(blocked.statusCode).toBe(422)
    expect(blocked.json().error).toBe('CONTRACT_BALANCE_INSUFFICIENT')
    expect(blocked.json().message).toContain('R$ 100,00')

    const row = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })
    expect(row.status).toBe('PENDING')
    expect(row.pdfFileKey).toBeNull()
    expect(row.redeemTokenHash).toBeNull()
  })

  test('estouro da ficha QDD não bloqueia: emite com budgetOverrun e aviso', async () => {
    const s = await scenario()
    await prisma.qddItem.update({ where: { id: s.qddItem.id }, data: { valorOrcado: '50' } })
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)

    const response = await issue(s, draft.id)
    expect(response.statusCode).toBe(200)
    expect(response.json().budgetOverrun).toBe(true)
    expect(response.json().warnings.map((w: { code: string }) => w.code)).toContain('BUDGET_OVERRUN')
  })

  test('aviso de autorização aberta para o mesmo veículo', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const first = await createDraft(s, contract.id)
    await issue(s, first.id)

    const second = await createDraft(s, contract.id)
    expect(second.warnings.map(w => w.code)).toContain('OPEN_AUTHORIZATION_EXISTS')
  })

  test('aviso de autorização aberta de outro departamento não revela nº nem validade', async () => {
    const s = await scenario()
    await prisma.fleetVehicle.update({ where: { id: s.vehicle.id }, data: { departmentId: null } })
    await prisma.fleetDriver.update({ where: { id: s.driver.id }, data: { departmentId: null } })
    const contract = await createContract(s)
    const first = await createDraft(s, contract.id)
    expect((await issue(s, first.id)).statusCode).toBe(200)
    const issued = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: first.id } })

    const otherDept = await prisma.department.create({ data: { organizationId: s.organization.id, name: 'Obras', code: `OB${++seq}` } })
    const secretary = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:authorize_fuel'] })
    await prisma.department.update({ where: { id: otherDept.id }, data: { members: { connect: { id: secretary.user.id } } } })
    const qdd = await prisma.qddItem.create({
      data: {
        organizationId: s.organization.id,
        departmentId: otherDept.id,
        year: s.qddItem.year,
        ficha: '9999',
        fonte: '1500',
        projetoAtividade: '2.010',
        naturezaDespesa: '3.3.90.30',
        valorOrcado: '5000.00',
      },
    })

    const response = await inject(
      'POST',
      `${BASE}/fuelings`,
      secretary.headers,
      fuelingPayload(s, contract.id, { departmentId: otherDept.id, qddItemId: qdd.id })
    )
    expect(response.statusCode).toBe(201)
    const warning = response.json().warnings.find((w: { code: string }) => w.code === 'OPEN_AUTHORIZATION_EXISTS')
    expect(warning.message).toContain('outro departamento')
    expect(warning.message).not.toContain(issued.formattedNumber!)

    const suggestions = await inject(
      'GET',
      `${BASE}/fuelings/suggestions?departmentId=${otherDept.id}&vehicleId=${s.vehicle.id}`,
      secretary.headers
    )
    expect(JSON.stringify(suggestions.json())).not.toContain(issued.formattedNumber!)
  })

  test('download do PDF é o original e fica na trilha', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    await issue(s, draft.id)
    const row = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })

    const download = await inject('GET', `${BASE}/fuelings/${draft.id}/pdf`, s.session.headers)
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-type']).toBe('application/pdf')
    expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(row.sha256Hash)
    expect(await prisma.auditLog.count({ where: { action: 'FLEET_AUTHORIZATION_PDF_DOWNLOADED', resourceId: draft.id } })).toBe(1)

    // O arquivo existe em disco, mas o estático de /uploads responde como inexistente (nem com o caminho codificado).
    expect((await inject('GET', `/uploads/${row.pdfFileKey}`, {})).statusCode).toBe(404)
    expect((await inject('GET', `/uploads/${row.pdfFileKey!.replace('fleet-fuelings', 'fleet%2Dfuelings')}`, {})).statusCode).toBe(404)
    // Barra invertida: no Windows o `send` a trata como separador.
    expect((await inject('GET', `/uploads/${row.pdfFileKey!.replace('fleet-fuelings/', 'fleet-fuelings%5C')}`, {})).statusCode).toBe(404)
    expect((await inject('GET', `/uploads/${row.pdfFileKey!.replace('/fleet-fuelings', '%5Cfleet-fuelings')}`, {})).statusCode).toBe(404)
  })

  test('enquanto aberta, o PDF (vale ao portador) só sai para quem emite; leitor recebe 403', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    await issue(s, draft.id)
    const reader = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:read', 'fleet:all_departments'] })

    const blocked = await inject('GET', `${BASE}/fuelings/${draft.id}/pdf`, reader.headers)
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toBe('PDF_RESTRICTED')

    await inject('POST', `${BASE}/fuelings/${draft.id}/cancel`, s.session.headers, { reason: 'Cancelada para liberar a leitura do PDF' })
    expect((await inject('GET', `${BASE}/fuelings/${draft.id}/pdf`, reader.headers)).statusCode).toBe(200)
  })

  test('edição concorrente com a emissão: o PDF nunca diverge do registro', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)

    const [issued, edited] = await Promise.all([
      issue(s, draft.id),
      inject('PATCH', `${BASE}/fuelings/${draft.id}`, s.session.headers, { unitPriceCap: '6.19', maxVolumeL: '41' }),
    ])
    const row = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: draft.id } })
    if (issued.statusCode === 200) {
      // Emitida: o PDF descreve exatamente os litros gravados — seja porque a
      // edição foi recusada (409), seja porque terminou antes de a emissão ler o rascunho.
      expect([200, 409]).toContain(edited.statusCode)
      const litresInRecord = row.maxVolumeL.toString()
      expect(edited.statusCode === 200 ? '41' : '40').toBe(litresInRecord)
      const text = await extractPdfText(await readFile(row.pdfFileKey!))
      expect(text).toContain(`${litresInRecord} L`)
    } else {
      // A edição venceu no meio da emissão: a emissão foi recusada sem deixar documento.
      expect(issued.statusCode).toBe(409)
      expect(['DRAFT_CHANGED', 'ALREADY_ISSUED']).toContain(issued.json().error)
      expect(row.status).toBe('PENDING')
      expect(row.pdfFileKey).toBeNull()
    }
  })

  test('lista não escapa do escopo pelo filtro de departamento', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    await createDraft(s, contract.id)
    const otherDept = await prisma.department.create({ data: { organizationId: s.organization.id, name: 'Obras', code: `OB${++seq}` } })
    const secretary = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:authorize_fuel'] })
    await prisma.department.update({ where: { id: otherDept.id }, data: { members: { connect: { id: secretary.user.id } } } })

    const forced = await inject('GET', `${BASE}/fuelings?departmentId=${s.department.id}`, secretary.headers)
    expect(forced.statusCode).toBe(200)
    expect(forced.json().data).toHaveLength(0)
  })

  test('com autorização aberta, o contrato não troca de posto nem de combustível; a trilha guarda antes e depois', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    await issue(s, draft.id)

    const cnpj = await inject('PATCH', `${BASE}/contracts/${contract.id}`, s.session.headers, { supplierCnpj: '45.997.418/0001-53' })
    expect(cnpj.statusCode).toBe(409)
    expect(cnpj.json().error).toBe('CONTRACT_IN_USE')
    expect((await inject('DELETE', `${BASE}/contracts/${contract.id}`, s.session.headers)).statusCode).toBe(409)

    const price = await inject('PATCH', `${BASE}/contracts/${contract.id}`, s.session.headers, { unitPrice: '6.29' })
    expect(price.statusCode).toBe(200)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'FLEET_CONTRACT_UPDATED', resourceId: contract.id } })
    expect(JSON.stringify(audit?.metadata)).toContain('"before":"6.19"')
  })
})

describe('Frotas — cancelamento', () => {
  test('cancela com motivo, libera a reserva e audita; não cancela duas vezes', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const draft = await createDraft(s, contract.id)
    await issue(s, draft.id)

    const short = await inject('POST', `${BASE}/fuelings/${draft.id}/cancel`, s.session.headers, { reason: 'curto' })
    expect(short.statusCode).toBe(400)

    const cancelled = await inject('POST', `${BASE}/fuelings/${draft.id}/cancel`, s.session.headers, {
      reason: 'Motorista perdeu o papel no deslocamento',
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().lifecycle).toBe('CANCELLED')

    expect((await inject('GET', `${BASE}/contracts/${contract.id}`, s.session.headers)).json().availableAmount).toBe('50000')
    const balance = await budgetService.getQddItemBalance(s.qddItem.id, s.organization.id)
    expect(balance.saldoRestante.toString()).toBe('18420')

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FLEET_AUTHORIZATION_CANCELLED', resourceId: draft.id } })
    expect(JSON.stringify(audit?.metadata)).toContain('perdeu o papel')

    const again = await inject('POST', `${BASE}/fuelings/${draft.id}/cancel`, s.session.headers, { reason: 'De novo, por engano aqui' })
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('NOT_CANCELLABLE')
  })

  test('rascunho não se cancela (exclui-se)', async () => {
    const s = await scenario()
    const draft = await createDraft(s, null)
    const response = await inject('POST', `${BASE}/fuelings/${draft.id}/cancel`, s.session.headers, { reason: 'Motivo qualquer bem longo' })
    expect(response.json().error).toBe('NOT_ISSUED')
  })
})

describe('Frotas — autorização: isolamento, escopo e módulo', () => {
  test('outra organização não lê, não altera, não emite, não cancela e não baixa (404); listas vazias', async () => {
    const a = await scenario()
    const b = await scenario()
    const contract = await createContract(a)
    const draft = await createDraft(a, contract.id)
    const issuedDraft = await createDraft(a, contract.id)
    await issue(a, issuedDraft.id)

    const h = b.session.headers
    expect((await inject('GET', `${BASE}/fuelings/${draft.id}`, h)).statusCode).toBe(404)
    expect((await inject('PATCH', `${BASE}/fuelings/${draft.id}`, h, { purpose: 'Tentativa de alteração alheia' })).statusCode).toBe(404)
    expect((await inject('DELETE', `${BASE}/fuelings/${draft.id}`, h)).statusCode).toBe(404)
    expect((await inject('POST', `${BASE}/fuelings/${draft.id}/issue`, h, {})).statusCode).toBe(404)
    expect((await inject('POST', `${BASE}/fuelings/${issuedDraft.id}/cancel`, h, { reason: 'Cancelamento alheio indevido' })).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/fuelings/${issuedDraft.id}/pdf`, h)).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/contracts/${contract.id}`, h)).statusCode).toBe(404)
    expect((await inject('PATCH', `${BASE}/contracts/${contract.id}`, h, { supplierName: 'Outro posto' })).statusCode).toBe(404)
    expect((await inject('DELETE', `${BASE}/contracts/${contract.id}`, h)).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/fuelings`, h)).json().data).toHaveLength(0)
    expect((await inject('GET', `${BASE}/contracts`, h)).json().data).toHaveLength(0)

    // Referências de A no corpo de B: "não existe".
    const crossRef = await inject('POST', `${BASE}/fuelings`, h, fuelingPayload(b, contract.id, { vehicleId: a.vehicle.id }))
    expect(crossRef.json().error).toBe('INVALID_VEHICLE')
    const crossContract = await inject('POST', `${BASE}/fuelings`, h, fuelingPayload(b, contract.id))
    expect(crossContract.json().error).toBe('INVALID_CONTRACT')

    const untouched = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: issuedDraft.id } })
    expect(untouched.lifecycle).toBe('OPEN')
  })

  test('secretário só emite para o departamento de que faz parte', async () => {
    const s = await scenario()
    const contract = await createContract(s)
    const secretary = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:authorize_fuel'] })

    const outside = await inject('POST', `${BASE}/fuelings`, secretary.headers, fuelingPayload(s, contract.id))
    expect(outside.statusCode).toBe(403)
    expect(outside.json().error).toBe('DEPARTMENT_OUT_OF_SCOPE')
    expect((await inject('GET', `${BASE}/fuelings/options?departmentId=${s.department.id}`, secretary.headers)).statusCode).toBe(403)

    const foreign = await createDraft(s, contract.id)
    expect((await inject('GET', `${BASE}/fuelings/${foreign.id}`, secretary.headers)).statusCode).toBe(404)

    expect((await inject('GET', `${BASE}/fuelings/departments`, secretary.headers)).json().data).toHaveLength(0)
    await prisma.department.update({ where: { id: s.department.id }, data: { members: { connect: { id: secretary.user.id } } } })
    const departments = (await inject('GET', `${BASE}/fuelings/departments`, secretary.headers)).json().data
    expect(departments.map((d: { id: string }) => d.id)).toEqual([s.department.id])
    const inside = await inject('POST', `${BASE}/fuelings`, secretary.headers, fuelingPayload(s, contract.id))
    expect(inside.statusCode).toBe(201)
    expect((await inject('POST', `${BASE}/fuelings/${inside.json().id}/issue`, secretary.headers, {})).statusCode).toBe(200)
    const row = await prisma.fleetFueling.findUniqueOrThrow({ where: { id: inside.json().id } })
    if (row.pdfFileKey) pdfKeys.push(row.pdfFileKey)
  })

  test('sem fleet:authorize_fuel não cria; fleet:read só lê', async () => {
    const s = await scenario()
    const reader = await createTestUserWithToken({ organizationId: s.organization.id, permissions: ['fleet:read', 'fleet:all_departments'] })
    expect((await inject('POST', `${BASE}/fuelings`, reader.headers, fuelingPayload(s, null))).statusCode).toBe(403)
    expect((await inject('GET', `${BASE}/fuelings`, reader.headers)).statusCode).toBe(200)
  })

  test('módulo desligado → 403 MODULE_DISABLED', async () => {
    const s = await scenario(ALL, ['fleetFuelings'])
    for (const [method, url] of [
      ['GET', `${BASE}/fuelings`],
      ['GET', `${BASE}/contracts`],
      ['POST', `${BASE}/fuelings`],
    ] as const) {
      const response = await inject(method, url, s.session.headers, method === 'POST' ? fuelingPayload(s, null) : undefined)
      expect(response.statusCode).toBe(403)
      expect(response.json().error).toBe('MODULE_DISABLED')
    }
  })
})
