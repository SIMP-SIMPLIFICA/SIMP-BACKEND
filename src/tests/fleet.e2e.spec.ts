import { describe, expect, test } from 'vitest'
import { Prisma } from '@prisma/client'
import { budgetService } from '@/services/budget.service.js'
import { syncAdminRoleWithCatalog } from '@/services/rbac.service.js'
import { createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
import { getApp, prisma } from './setup-e2e.js'

/**
 * Simplifica Frotas — TASK 1 + 2 (integração).
 *
 * Pilha inteira: JWT + fingerprint, módulo `fleet`, RBAC `fleet:*` no banco,
 * escopo por departamento, Zod .strict(), cifragem de CPF/CNH e auditoria na
 * mesma transação. Nada mockado.
 */

const BASE = '/api/v1/fleet'
const MODULES = ['fleetFuelings', 'fleet']
const ALL = ['fleet:read', 'fleet:manage', 'fleet:all_departments']

/** CPF válido de exemplo e um Renavam com DV correto (ver fleet-validators.spec). */
const CPF = '529.982.247-25'
const RENAVAM = '01234567897'

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
    renavam: RENAVAM,
    ownership: 'PROPRIO',
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
    cnhNumber: '02650306461',
    cnhCategory: 'B',
    cnhExpiry: '2028-03-15',
    employmentKind: 'EFETIVO',
    ...overrides,
  }
}

const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  getApp().inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) })

describe('Frotas — veículos', () => {
  test('cria com placa normalizada, Decimal como string e auditoria na trilha', async () => {
    const { session, organization } = await scenario()

    const response = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload())

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.plate).toBe('ABC1D23')
    expect(body.tankCapacityL).toBe('55.5')
    expect(body.odometerKm).toBe(0)

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FLEET_VEHICLE_CREATED', resourceId: body.id } })
    expect(audit?.organizationId).toBe(organization.id)
  })

  test('valida placa, Renavam e recusa campo extra (.strict)', async () => {
    const { session } = await scenario()

    const badPlate = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'AB12' }))
    expect(badPlate.statusCode).toBe(400)
    expect(badPlate.json().error).toBe('INVALID_PLATE')

    const badRenavam = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ renavam: '01234567898' }))
    expect(badRenavam.statusCode).toBe(400)
    expect(badRenavam.json().error).toBe('INVALID_RENAVAM')

    const extra = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ organizationId: 'outra-org' }))
    expect(extra.statusCode).toBe(400)
    expect(extra.json().error).toBe('VALIDATION_ERROR')

    const odometer = await inject('PATCH', `${BASE}/vehicles/qualquer`, session.headers, { odometerKm: 1 })
    expect(odometer.statusCode).toBe(400)
  })

  test('placa duplicada → 409; depois da exclusão (soft-delete) a placa volta a ser aceita', async () => {
    const { session } = await scenario()

    const first = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload())
    const duplicate = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ renavam: null }))
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error).toBe('PLATE_ALREADY_REGISTERED')

    const removed = await inject('DELETE', `${BASE}/vehicles/${first.json().id}`, session.headers)
    expect(removed.statusCode).toBe(204)

    const again = await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload())
    expect(again.statusCode).toBe(201)
    expect(await prisma.fleetVehicle.count({ where: { plate: 'ABC1D23' } })).toBe(2)
  })

  test('isolamento: outra organização não lê, não altera e não exclui (404), e a listagem vem vazia', async () => {
    const a = await scenario()
    const b = await scenario()
    const created = (await inject('POST', `${BASE}/vehicles`, a.session.headers, vehiclePayload())).json()

    for (const [method, payload] of [['GET'], ['PATCH', { makeModel: 'Invadido' }], ['DELETE']] as const) {
      const response = await inject(method, `${BASE}/vehicles/${created.id}`, b.session.headers, payload)
      expect(response.statusCode).toBe(404)
    }

    const list = await inject('GET', `${BASE}/vehicles`, b.session.headers)
    expect(list.json().data).toEqual([])

    const intact = await prisma.fleetVehicle.findUniqueOrThrow({ where: { id: created.id } })
    expect(intact.makeModel).toBe('Spin 1.8')
    expect(intact.deletedAt).toBeNull()
  })

  test('escopo por departamento: sem fleet:all_departments só vê os próprios departamentos', async () => {
    const { organization, session, department } = await scenario()
    const scoped = await createTestUserWithToken({ organizationId: organization.id, permissions: ['fleet:read', 'fleet:manage'] })

    const outOfScope = (
      await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ departmentId: department.id }))
    ).json()
    const general = (
      await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload({ plate: 'XYZ9876', renavam: null }))
    ).json()

    expect((await inject('GET', `${BASE}/vehicles/${outOfScope.id}`, scoped.headers)).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/vehicles/${general.id}`, scoped.headers)).statusCode).toBe(200)

    const create = await inject(
      'POST',
      `${BASE}/vehicles`,
      scoped.headers,
      vehiclePayload({ plate: 'QWE1234', renavam: null, departmentId: department.id })
    )
    expect(create.statusCode).toBe(403)
    expect(create.json().error).toBe('DEPARTMENT_OUT_OF_SCOPE')

    // Membro do departamento passa a enxergar.
    await prisma.department.update({ where: { id: department.id }, data: { members: { connect: { id: scoped.user.id } } } })
    expect((await inject('GET', `${BASE}/vehicles/${outOfScope.id}`, scoped.headers)).statusCode).toBe(200)
  })
})

describe('Frotas — motoristas', () => {
  test('cria com CPF e CNH cifrados; a API só devolve máscara', async () => {
    const { session, organization } = await scenario()

    const response = await inject('POST', `${BASE}/drivers`, session.headers, driverPayload())

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.cpfMasked).toBe('***.982.247-**')
    expect(body.cnhMasked).toBe('*******6461')
    expect(body).not.toHaveProperty('cpfEncrypted')
    expect(body).not.toHaveProperty('cpfBlindIndex')
    expect(JSON.stringify(body)).not.toContain('52998224725')

    const row = await prisma.fleetDriver.findUniqueOrThrow({ where: { id: body.id } })
    expect(row.cpfEncrypted).not.toContain('52998224725')
    expect(row.cnhNumberEncrypted).not.toContain('02650306461')

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FLEET_DRIVER_CREATED', resourceId: body.id } })
    expect(audit.organizationId).toBe(organization.id)
    expect(JSON.stringify(audit.metadata)).not.toContain('52998224725')
  })

  test('CPF inválido → 400; CPF repetido → 409; busca pelo CPF completo encontra', async () => {
    const { session } = await scenario()

    const invalid = await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ cpf: '529.982.247-24' }))
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toBe('INVALID_CPF')

    await inject('POST', `${BASE}/drivers`, session.headers, driverPayload())
    const duplicate = await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ name: 'Outro Nome' }))
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error).toBe('CPF_ALREADY_REGISTERED')

    const found = await inject('GET', `${BASE}/drivers?search=52998224725`, session.headers)
    expect(found.json().data).toHaveLength(1)
    expect(found.json().data[0].name).toBe('João Pereira')
  })

  test('CPF repetido fora do escopo do usuário: 409 sem revelar o nome do motorista', async () => {
    const { organization, session, department } = await scenario()
    const scoped = await createTestUserWithToken({ organizationId: organization.id, permissions: ['fleet:read', 'fleet:manage'] })

    await inject('POST', `${BASE}/drivers`, session.headers, driverPayload({ name: 'Maria Sigilosa', departmentId: department.id }))

    const probe = await inject('POST', `${BASE}/drivers`, scoped.headers, driverPayload({ name: 'Tentativa' }))
    expect(probe.statusCode).toBe(409)
    expect(probe.json().error).toBe('CPF_ALREADY_REGISTERED')
    expect(probe.json().message).not.toContain('Maria Sigilosa')
  })

  test('o mesmo CPF pode existir em duas organizações (blind index por organização)', async () => {
    const a = await scenario()
    const b = await scenario()

    expect((await inject('POST', `${BASE}/drivers`, a.session.headers, driverPayload())).statusCode).toBe(201)
    expect((await inject('POST', `${BASE}/drivers`, b.session.headers, driverPayload())).statusCode).toBe(201)
  })

  test('isolamento: motorista de outra organização → 404', async () => {
    const a = await scenario()
    const b = await scenario()
    const created = (await inject('POST', `${BASE}/drivers`, a.session.headers, driverPayload())).json()

    expect((await inject('GET', `${BASE}/drivers/${created.id}`, b.session.headers)).statusCode).toBe(404)
    expect((await inject('PATCH', `${BASE}/drivers/${created.id}`, b.session.headers, { name: 'Invadido' })).statusCode).toBe(404)
    expect((await inject('DELETE', `${BASE}/drivers/${created.id}`, b.session.headers)).statusCode).toBe(404)
    expect((await inject('GET', `${BASE}/drivers`, b.session.headers)).json().data).toEqual([])
  })
})

describe('Frotas — guardas', () => {
  test('módulo fleet desligado → 403 MODULE_DISABLED em todas as rotas', async () => {
    const { session } = await scenario(ALL, ['fleetFuelings'])

    for (const [method, url, payload] of [
      ['GET', `${BASE}/vehicles`],
      ['POST', `${BASE}/vehicles`, vehiclePayload()],
      ['GET', `${BASE}/drivers`],
      ['POST', `${BASE}/drivers`, driverPayload()],
    ] as const) {
      const response = await inject(method, url, session.headers, payload)
      expect(response.statusCode).toBe(403)
      expect(response.json().error).toBe('MODULE_DISABLED')
    }
  })

  test('só fleet:read não cadastra (403); sem permissão nenhuma não lê (403)', async () => {
    const reader = await scenario(['fleet:read'])
    expect((await inject('POST', `${BASE}/vehicles`, reader.session.headers, vehiclePayload())).statusCode).toBe(403)
    expect((await inject('GET', `${BASE}/vehicles`, reader.session.headers)).statusCode).toBe(200)

    const nobody = await scenario([])
    expect((await inject('GET', `${BASE}/vehicles`, nobody.session.headers)).statusCode).toBe(403)
  })

  test('módulo fleet não liga sem fleetFuelings (409 MODULE_DEPENDENCY)', async () => {
    const organization = await createTestOrganization({ modules: [] })
    const superAdmin = await createTestUserWithToken({ organizationId: null, isSuperAdmin: true })

    const blocked = await inject('PATCH', `/api/v1/admin/organizations/${organization.id}/modules/fleet`, superAdmin.headers, { isEnabled: true })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('MODULE_DEPENDENCY')

    await inject('PATCH', `/api/v1/admin/organizations/${organization.id}/modules/fleetFuelings`, superAdmin.headers, { isEnabled: true })
    const allowed = await inject('PATCH', `/api/v1/admin/organizations/${organization.id}/modules/fleet`, superAdmin.headers, { isEnabled: true })
    expect(allowed.statusCode).toBe(200)
  })

  test('a role global admin recebe as permissões fleet:* na sincronização', async () => {
    await prisma.role.upsert({
      where: { name: 'admin' },
      update: { permissions: ['users:read'] },
      create: { name: 'admin', displayName: 'Administrador', isSystem: true, permissions: ['users:read'] },
    })

    await syncAdminRoleWithCatalog()

    const admin = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } })
    expect(admin.permissions).toEqual(expect.arrayContaining(['fleet:read', 'fleet:manage', 'fleet:all_departments']))
    expect(admin.permissions).not.toContain('system:admin')
  })
})

describe('Frotas — saldo da ficha QDD (TASK 1)', () => {
  test('autorização aberta reserva o máximo, usada consome o cupom, cancelada libera; OS aprovada consome', async () => {
    const { organization, session, department } = await scenario()
    const qdd = await prisma.qddItem.create({
      data: {
        organizationId: organization.id,
        departmentId: department.id,
        year: 2026,
        ficha: '1234',
        fonte: '1500',
        projetoAtividade: '2.015',
        naturezaDespesa: '3.3.90.30',
        valorOrcado: new Prisma.Decimal('1000.00'),
      },
    })
    const vehicle = (await inject('POST', `${BASE}/vehicles`, session.headers, vehiclePayload())).json()
    const driver = (await inject('POST', `${BASE}/drivers`, session.headers, driverPayload())).json()

    let sequence = 0
    const authorization = (lifecycle: 'OPEN' | 'USED' | 'CANCELLED', maxAmount: string) =>
      prisma.fleetFueling.create({
        data: {
          organizationId: organization.id,
          sequenceNumber: ++sequence,
          year: 2026,
          formattedNumber: `000${sequence}/2026`,
          status: 'ISSUED',
          lifecycle,
          departmentId: department.id,
          vehicleId: vehicle.id,
          driverId: driver.id,
          qddItemId: qdd.id,
          fuelType: 'GASOLINA',
          maxVolumeL: new Prisma.Decimal('40.000'),
          maxAmount: new Prisma.Decimal(maxAmount),
          unitPriceCap: new Prisma.Decimal('6.1900'),
          validUntil: new Date('2026-12-31T00:00:00Z'),
          purpose: 'Transporte de pacientes',
          createdById: session.user.id,
        },
      })

    await authorization('OPEN', '100.00')
    await authorization('CANCELLED', '300.00')
    const used = await authorization('USED', '247.60')
    await prisma.fleetFuelingRedemption.create({
      data: {
        organizationId: organization.id,
        fuelingId: used.id,
        mode: 'MANUAL',
        totalAmount: new Prisma.Decimal('80.00'),
        submittedIp: '203.0.113.1',
        userAgent: 'e2e',
      },
    })
    await prisma.fleetServiceOrder.create({
      data: {
        organizationId: organization.id,
        sequenceNumber: 1,
        year: 2026,
        formattedNumber: '0001/2026',
        vehicleId: vehicle.id,
        kind: 'CORRETIVA',
        qddItemId: qdd.id,
        openedAt: new Date('2026-10-01T00:00:00Z'),
        diagnosis: 'Troca de pastilhas de freio',
        totalAmount: new Prisma.Decimal('50.00'),
        status: 'APROVADA',
        createdById: session.user.id,
      },
    })

    const balance = await budgetService.getQddItemBalance(qdd.id, organization.id)
    // 100 (aberta) + 80 (usada, valor do cupom) + 50 (OS) = 230; a cancelada não conta.
    expect(balance.valorUtilizado.toFixed(2)).toBe('230.00')
    expect(balance.saldoRestante.toFixed(2)).toBe('770.00')

    const overrun = await prisma.$transaction(tx => budgetService.detectOverrun(tx, qdd.id))
    expect(overrun).toBe(false)
  })
})
