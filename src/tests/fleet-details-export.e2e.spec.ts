import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { extractPdfText } from './pdf-text.helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Simplifica Frotas — matrícula, patrimônio, detalhes e PDFs autenticados.
 *
 * Pilha inteira, nada mockado: as exportações passam pelo motor universal
 * (QR + hash + ExportedDocument) e auditam na mesma transação (D3).
 */

const BASE = '/api/v1/fleet'
const MODULES = ['fleetFuelings', 'fleet']
const ALL = ['fleet:read', 'fleet:manage', 'fleet:all_departments']
const CPF = '529.982.247-25'
const CPF_DIGITS = '52998224725'
const CNH = '02650306461'
/** Segundo CPF válido (DV conferido), para dois motoristas na mesma organização. */
const CPF_2 = '111.444.777-35'

let sequence = 0

async function scenario(permissions: string[] = ALL, modules: string[] = MODULES) {
  const organization = await createTestOrganization({ modules })
  const session = await createTestUserWithToken({ organizationId: organization.id, permissions })
  const department = await prisma.department.create({
    data: { organizationId: organization.id, name: 'Secretaria de Saúde', code: `SS${Math.floor(Math.random() * 90000) + 10000}` },
  })
  return { organization, session, department }
}

function vehiclePayload(overrides: Record<string, unknown> = {}) {
  return {
    plate: 'abc-1d23',
    ownership: 'PROPRIO',
    assetTag: `PAT-${++sequence}`,
    vehicleType: 'AUTOMOVEL',
    fuelType: 'FLEX',
    tankCapacityL: '55.5',
    makeModel: 'Spin 1.8',
    ...overrides,
  }
}

function driverPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'João Pereira',
    cpf: CPF,
    cnhNumber: CNH,
    cnhCategory: 'B',
    cnhExpiry: '2030-03-15',
    employmentKind: 'EFETIVO',
    registrationNumber: `MAT-${++sequence}`,
    ...overrides,
  }
}

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  getApp().inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) })

/** Data ISO (YYYY-MM-DD) a `days` dias de hoje. */
function isoInDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('Frotas — nº de patrimônio', () => {
  test('obrigatório para PRÓPRIO, opcional para locado; único entre ativos', async () => {
    const { session } = await scenario()

    const missing = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ assetTag: null }))
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('ASSET_TAG_REQUIRED')

    const leased = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ ownership: 'LOCADO', assetTag: null }))
    expect(leased.statusCode).toBe(201)

    // Locado sem patrimônio virando próprio: a regra vale na alteração também.
    const toOwn = await inject('PATCH', `${BASE}/vehicles/${leased.json().id}`, session.headers, { ownership: 'PROPRIO' })
    expect(toOwn.statusCode).toBe(400)
    expect(toOwn.json().error).toBe('ASSET_TAG_REQUIRED')

    const first = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'DEF4G56', assetTag: '000123' }))
    expect(first.statusCode).toBe(201)
    const clash = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'GHI7J89', assetTag: '000123' }))
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error).toBe('ASSET_TAG_ALREADY_REGISTERED')

    // Soft-delete libera o número.
    await inject('DELETE', `${BASE}/vehicles/${first.json().id}`, session.headers)
    const reused = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'GHI7J89', assetTag: '000123' }))
    expect(reused.statusCode).toBe(201)
  })

  test('a busca da listagem encontra pelo patrimônio', async () => {
    const { session } = await scenario()
    await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ assetTag: 'TOMB-2024-0077' }))
    await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'XYZ9876', assetTag: 'TOMB-2019-0001' }))

    const found = await inject('GET', `${BASE}/vehicles?search=2024-0077`, session.headers)
    expect(found.statusCode).toBe(200)
    expect(found.json().data.map((v: { assetTag: string }) => v.assetTag)).toEqual(['TOMB-2024-0077'])

    const caseInsensitive = await inject('GET', `${BASE}/vehicles?search=tomb-2019`, session.headers)
    expect(caseInsensitive.json().data.map((v: { plate: string }) => v.plate)).toEqual(['XYZ9876'])
  })

  test('detalhe traz quem cadastrou e quem alterou (id + nome, sem e-mail)', async () => {
    const { session, organization } = await scenario()
    const editor = await createTestUserWithToken({ organizationId: organization.id, permissions: ALL })
    const created = (await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload())).json()
    expect(created.createdBy.id).toBe(session.user.id)
    expect(created.updatedBy).toBeNull()

    await inject('PATCH', `${BASE}/vehicles/${created.id}`, editor.headers, { status: 'RESERVA' })
    const detail = (await inject('GET', `${BASE}/vehicles/${created.id}`, session.headers)).json()
    expect(detail.updatedBy.id).toBe(editor.user.id)
    expect(typeof detail.updatedBy.name).toBe('string')
    expect(JSON.stringify(detail)).not.toContain(String(editor.user.email))
  })
})

describe('Frotas — matrícula do motorista', () => {
  test('obrigatória para efetivo/comissionado, opcional para contratado; duplicada → 409 sem nome', async () => {
    const { session } = await scenario()

    const missing = await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ registrationNumber: null }))
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('REGISTRATION_REQUIRED')

    const hired = await inject(
      'POST',
      `${BASE}/drivers`,
      session.headers,
      driverPayload({ employmentKind: 'CONTRATADO', registrationNumber: null })
    )
    expect(hired.statusCode).toBe(201)
    expect(hired.json().registrationNumber).toBeNull()

    const other = await inject(
      'POST',
      `${BASE}/drivers`,
      session.headers,
      driverPayload({ name: 'Ana Souza', cpf: CPF_2, registrationNumber: '4455' })
    )
    expect(other.statusCode).toBe(201)

    const clash = await inject('PATCH', `${BASE}/drivers/${hired.json().id}`, session.headers, { registrationNumber: '4455' })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error).toBe('REGISTRATION_ALREADY_REGISTERED')
    expect(clash.json().message).not.toContain('Ana Souza')
  })

  test('em branco, vem do beneficiário de Diárias com o mesmo CPF — só da MESMA organização', async () => {
    const withDaily = [...MODULES, 'dailyAllowances']
    const a = await scenario([...ALL, 'dailyAllowances:read'], withDaily)
    const b = await scenario([...ALL, 'dailyAllowances:read'], withDaily)
    await prisma.beneficiary.create({
      data: { organizationId: a.organization.id, name: 'JOAO PEREIRA', cpf: CPF_DIGITS, registrationNumber: '98765' },
    })

    const filled = await inject('POST', `${BASE}/drivers`, a.session.headers, driverPayload({ registrationNumber: null }))
    expect(filled.statusCode).toBe(201)
    expect(filled.json().registrationNumber).toBe('98765')
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLEET_DRIVER_CREATED', resourceId: filled.json().id } })
    expect(audit.metadata).toMatchObject({ registrationSource: 'BENEFICIARY' })

    // Organização B não enxerga o beneficiário de A: segue exigindo a matrícula.
    const elsewhere = await inject('POST', `${BASE}/drivers`, b.session.headers, driverPayload({ registrationNumber: null }))
    expect(elsewhere.statusCode).toBe(400)
    expect(elsewhere.json().error).toBe('REGISTRATION_REQUIRED')
  })

  test('sem acesso a Diárias, a sugestão não roda (não revela que a pessoa é beneficiária)', async () => {
    // Módulo ligado, mas o usuário só tem permissões do Frotas.
    const { organization, session } = await scenario(ALL, [...MODULES, 'dailyAllowances'])
    await prisma.beneficiary.create({
      data: { organizationId: organization.id, name: 'JOAO PEREIRA', cpf: CPF_DIGITS, registrationNumber: '98765' },
    })

    const response = await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ registrationNumber: null }))
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('REGISTRATION_REQUIRED')
    expect(JSON.stringify(response.json())).not.toContain('98765')
  })

  test('busca por matrícula vai no corpo (POST) e respeita a organização', async () => {
    const a = await scenario()
    const b = await scenario()
    await inject('POST', `${BASE}/drivers`, a.session.headers, driverPayload({ registrationNumber: '2024-1001' }))
    await inject('POST', `${BASE}/drivers`, b.session.headers, driverPayload({ registrationNumber: '2024-1001' }))

    const found = await inject('POST', `${BASE}/drivers/search-by-registration`, a.session.headers, { registration: '1001' })
    expect(found.statusCode).toBe(200)
    expect(found.json().data).toHaveLength(1)
    expect(found.json().data[0].cpfMasked).toBe('***.982.***-**')

    const extra = await inject('POST', `${BASE}/drivers/search-by-registration`, a.session.headers, {
      registration: '1001',
      organizationId: b.organization.id,
    })
    expect(extra.statusCode).toBe(400)
  })
})

describe('Frotas — PDFs autenticados', () => {
  test('relação da frota: PDF validável, respeita filtros, organização e escopo; audita na transação', async () => {
    const { organization, session, department } = await scenario()
    const other = await scenario()
    await prisma.user.update({ where: { id: session.user.id }, data: { jobTitle: 'Gestor de Frota' } })

    await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ assetTag: 'TOMB-1', departmentId: department.id }))
    await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'XYZ9876', assetTag: 'TOMB-2', vehicleType: 'CAMINHAO' }))
    await inject('POST', `${BASE}/vehicles`, other.session.headers, vehiclePayload({ plate: 'OUT1A23', assetTag: 'TOMB-X' }))

    const response = await inject('POST', `${BASE}/vehicles/export`, session.headers, {})
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['cache-control']).toBe('no-store')

    const bytes = response.rawPayload
    const text = await extractPdfText(bytes)
    expect(text).toContain('RELAÇÃO DA FROTA')
    expect(text).toContain('ABC1D23')
    expect(text).toContain('XYZ-9876')
    expect(text).not.toContain('OUT1A23')
    expect(text).toContain('Total de veículos')
    expect(text).toContain('Caminhão: 1')
    expect(text).toContain('Gestor de Frota')

    const publicId = String(response.headers['x-document-public-id'])
    const document = await prisma.exportedDocument.findUniqueOrThrow({ where: { publicId } })
    expect(document.organizationId).toBe(organization.id)
    expect(document.documentType).toBe('FLEET_VEHICLE_LIST')
    expect(document.sha256Hash).toBe(createHash('sha256').update(bytes).digest('hex'))

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLEET_VEHICLE_LIST_EXPORTED', organizationId: organization.id } })
    expect(audit.metadata).toMatchObject({ count: 2, publicId })

    // Filtro da tela (busca) chega no corpo e vale no PDF.
    const filtered = await extractPdfText(
      (await inject('POST', `${BASE}/vehicles/export`, session.headers, { search: 'TOMB-2' })).rawPayload
    )
    expect(filtered).toContain('XYZ-9876')
    expect(filtered).not.toContain('ABC1D23')

    // Usuário restrito a outro departamento: só a frota geral.
    const scoped = await createTestUserWithToken({ organizationId: organization.id, permissions: ['fleet:read'] })
    const scopedText = await extractPdfText((await inject('POST', `${BASE}/vehicles/export`, scoped.headers, {})).rawPayload)
    expect(scopedText).toContain('XYZ-9876')
    expect(scopedText).not.toContain('ABC1D23')
  })

  test('relação de motoristas: CPF e CNH mascarados, CNH vencida/vencendo destacada', async () => {
    const { organization, session } = await scenario()
    await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ name: 'Carlos Vencido', cnhExpiry: isoInDays(-3) }))
    await inject(
      'POST',
      `${BASE}/drivers`,
      session.headers,
      driverPayload({ name: 'Beatriz Atenta', cpf: CPF_2, cnhNumber: '12345678900', cnhExpiry: isoInDays(10) })
    )

    const response = await inject('POST', `${BASE}/drivers/export`, session.headers, {})
    expect(response.statusCode).toBe(200)
    const text = await extractPdfText(response.rawPayload)

    expect(text).toContain('RELAÇÃO DE MOTORISTAS')
    expect(text).toContain('***.982.***-**')
    expect(text).not.toContain(CPF)
    expect(text).not.toContain(CPF_DIGITS)
    expect(text).not.toContain(CNH)
    expect(text).toContain('VENCIDA')
    expect(text).toMatch(/VENCE EM (9|10|11) DIAS/)

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLEET_DRIVER_LIST_EXPORTED', organizationId: organization.id } })
    expect(JSON.stringify(audit.metadata)).not.toContain(CPF_DIGITS)

    // Busca por nome no corpo: o termo não é impresso nem auditado.
    const byName = await inject('POST', `${BASE}/drivers/export`, session.headers, { search: 'Beatriz' })
    const byNameText = await extractPdfText(byName.rawPayload)
    expect(byNameText).toContain('Beatriz Atenta')
    expect(byNameText).not.toContain('Carlos Vencido')
    expect(byNameText).toContain('busca por nome')

    // Busca por matrícula: dígitos soltos podem ser início de CPF — o termo
    // não vai para o documento.
    const byRegistration = await inject('POST', `${BASE}/drivers/export`, session.headers, { registration: '529982247' })
    expect(byRegistration.statusCode).toBe(200)
    const byRegistrationText = await extractPdfText(byRegistration.rawPayload)
    expect(byRegistrationText).toContain('busca por matrícula')
    expect(byRegistrationText).not.toContain('529982247')
  })

  test('fichas: 200 na própria organização; 404 em outra, sem registrar documento', async () => {
    const a = await scenario()
    const b = await scenario()
    const vehicle = (await inject('POST', `${BASE}/vehicles`, a.session.headers, vehiclePayload({ assetTag: 'TOMB-77' }))).json()
    const driver = (await inject('POST', `${BASE}/drivers`, a.session.headers, driverPayload())).json()

    const vehicleSheet = await inject('POST', `${BASE}/vehicles/${vehicle.id}/export`, a.session.headers)
    expect(vehicleSheet.statusCode).toBe(200)
    const vehicleText = await extractPdfText(vehicleSheet.rawPayload)
    expect(vehicleText).toContain('FICHA DO VEÍCULO')
    expect(vehicleText).toContain('TOMB-77')
    expect(vehicleText).toContain('HISTÓRICO')

    const driverSheet = await inject('POST', `${BASE}/drivers/${driver.id}/export`, a.session.headers)
    expect(driverSheet.statusCode).toBe(200)
    const driverText = await extractPdfText(driverSheet.rawPayload)
    expect(driverText).toContain('FICHA DO MOTORISTA')
    expect(driverText).toContain('***.982.***-**')
    expect(driverText).not.toContain(CPF_DIGITS)
    expect(driverText).not.toContain(CNH)

    const audits = await prisma.auditLog.count({
      where: { organizationId: a.organization.id, action: { in: ['FLEET_VEHICLE_SHEET_EXPORTED', 'FLEET_DRIVER_SHEET_EXPORTED'] } },
    })
    expect(audits).toBe(2)

    const before = await prisma.exportedDocument.count({ where: { organizationId: b.organization.id } })
    expect((await inject('POST', `${BASE}/vehicles/${vehicle.id}/export`, b.session.headers)).statusCode).toBe(404)
    expect((await inject('POST', `${BASE}/drivers/${driver.id}/export`, b.session.headers)).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/drivers/${driver.id}`, b.session.headers)).statusCode).toBe(404)
    expect(await prisma.exportedDocument.count({ where: { organizationId: b.organization.id } })).toBe(before)
    expect(await prisma.exportedDocument.count({ where: { organizationId: a.organization.id } })).toBe(2)
  })

  test('validação pública confirma o documento sem expor dado pessoal', async () => {
    const { session } = await scenario()
    const driver = (await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ name: 'Joana Reservada' }))).json()
    const sheet = await inject('POST', `${BASE}/drivers/${driver.id}/export`, session.headers)
    const publicId = String(sheet.headers['x-document-public-id'])

    const validation = await getApp().inject({ method: 'GET', url: `/api/v1/public/documents/validate/${publicId}` })
    expect(validation.statusCode).toBe(200)
    const body = JSON.stringify(validation.json())
    expect(body).toContain('Ficha do Motorista')
    expect(body).not.toContain('Joana Reservada')
    expect(body).not.toContain(CPF_DIGITS)
    expect(body).not.toContain('***.982.***-**')
  })

  test('guardas: módulo desligado → 403; sem permissão → 403; corpo com campo extra → 400', async () => {
    const off = await scenario(ALL, ['fleetFuelings'])
    for (const url of ['/vehicles/export', '/drivers/export', '/vehicles/x/export', '/drivers/x/export']) {
      expect((await inject('POST', `${BASE}${url}`, off.session.headers, {})).statusCode).toBe(403)
    }

    const none = await scenario([])
    expect((await inject('POST', `${BASE}/vehicles/export`, none.session.headers, {})).statusCode).toBe(403)

    const { session } = await scenario()
    const extra = await inject('POST', `${BASE}/vehicles/export`, session.headers, { organizationId: 'outra' })
    expect(extra.statusCode).toBe(400)
  })
})
