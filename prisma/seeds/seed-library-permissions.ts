/**
 * Patch script — Biblioteca Digital (GED)
 *
 * Adiciona as permissões library:* ao role `admin` existente e habilita
 * o módulo `library` em todas as organizações ativas.
 *
 * Uso:
 *   cd D:/PROJECTS/SIMP-BACKEND
 *   npx tsx prisma/seeds/seed-library-permissions.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LIBRARY_PERMISSIONS = [
  'library:read',
  'library:write',
  'library:delete',
  'library:logs',
]

async function patchAdminRole() {
  console.log('🔐 Patching admin role with library permissions...')

  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } })

  if (!adminRole) {
    console.warn('⚠️  Role "admin" not found — skipping.')
    return
  }

  const existing = (adminRole.permissions as string[]) ?? []
  const toAdd = LIBRARY_PERMISSIONS.filter(p => !existing.includes(p))

  if (toAdd.length === 0) {
    console.log('✅ Admin role already has all library permissions.')
    return
  }

  await prisma.role.update({
    where: { name: 'admin' },
    data: { permissions: [...existing, ...toAdd] },
  })

  console.log(`✅ Added to admin: ${toAdd.join(', ')}`)
}

async function patchOrganizationModules() {
  console.log('🧩 Enabling library module for all active organizations...')

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })

  for (const org of orgs) {
    await prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId: org.id, module: 'library' } },
      update: { isEnabled: true },
      create: { organizationId: org.id, module: 'library', isEnabled: true },
    })
    console.log(`✅ Module library enabled for org "${org.name}"`)
  }
}

async function main() {
  console.log('🚀 Starting library permissions patch...\n')

  try {
    await patchAdminRole()
    await patchOrganizationModules()
    console.log('\n✅ Patch completed successfully!')
  } catch (err) {
    console.error('❌ Patch failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
