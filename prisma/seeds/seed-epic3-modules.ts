/**
 * Patch script — Gestão Municipal (Épico 3)
 *
 * Habilita os módulos `dailyAllowances` e `fleetFuelings` nas organizações
 * existentes e garante as permissões correspondentes no role `admin`.
 *
 * POR QUE ESTE SCRIPT EXISTE: as linhas de `OrganizationModule` são criadas no
 * momento em que a organização nasce. Organizações criadas ANTES de um módulo
 * novo existir ficam sem a linha dele — e o `requireModule` responde
 * 403 MODULE_DISABLED, com o item desaparecendo da sidebar. Acrescentar a chave
 * em `constants/modules.ts` resolve para as organizações FUTURAS; as que já
 * existem precisam deste backfill.
 *
 * Mesmo padrão de seed-library-permissions.ts, que resolveu o mesmo problema
 * quando a Biblioteca foi adicionada.
 *
 * IDEMPOTENTE: pode rodar quantas vezes for necessário.
 *
 * Uso:
 *   npm run db:seed:epic3
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EPIC3_MODULES = ['dailyAllowances', 'fleetFuelings'] as const

const EPIC3_PERMISSIONS = [
  'dailyAllowances:read',
  'dailyAllowances:write',
  'dailyAllowances:issue',
  'dailyAllowances:delete',
  'fleetFuelings:read',
  'fleetFuelings:write',
  'fleetFuelings:issue',
  'fleetFuelings:delete',
]

async function patchAdminRole() {
  console.log('🔐 Garantindo permissões do Épico 3 no role "admin"...')

  const adminRoles = await prisma.role.findMany({ where: { name: 'admin' } })

  if (adminRoles.length === 0) {
    console.warn('⚠️  Nenhum role "admin" encontrado — nada a fazer.')
    return
  }

  for (const role of adminRoles) {
    const current = Array.isArray(role.permissions) ? (role.permissions as string[]) : []
    const missing = EPIC3_PERMISSIONS.filter(p => !current.includes(p))

    if (missing.length === 0) {
      console.log(`✅ Role "${role.name}" já possui todas as permissões.`)
      continue
    }

    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: [...current, ...missing] },
    })
    console.log(`✅ Role "${role.name}": ${missing.length} permissão(ões) adicionada(s).`)
  }
}

async function patchOrganizationModules() {
  console.log('\n🧩 Habilitando os módulos do Épico 3 nas organizações ativas...')

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })

  if (orgs.length === 0) {
    console.warn('⚠️  Nenhuma organização ativa encontrada.')
    return
  }

  for (const org of orgs) {
    for (const module of EPIC3_MODULES) {
      await prisma.organizationModule.upsert({
        where: { organizationId_module: { organizationId: org.id, module } },
        update: { isEnabled: true },
        create: { organizationId: org.id, module, isEnabled: true },
      })
    }
    console.log(`✅ "${org.name}": dailyAllowances e fleetFuelings habilitados.`)
  }
}

async function main() {
  console.log('🚀 Patch dos módulos do Épico 3\n')

  try {
    await patchAdminRole()
    await patchOrganizationModules()
    console.log('\n✅ Concluído. Faça logout/login para o token e o /me refletirem a mudança.')
  } catch (err) {
    console.error('❌ Falhou:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
