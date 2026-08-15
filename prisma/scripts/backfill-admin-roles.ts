/**
 * Backfill script — Épico 1, User Story 2 (RBAC)
 *
 * Corrige contas de admin de organização criadas antes da correção de
 * auto-vinculação de role (fix de onboarding): todo usuário ativo,
 * não-super-admin, com organizationId definido e ZERO roles vinculadas
 * recebe a role global "admin" (self-healing via ensureAdminRole).
 *
 * Idempotente por construção: o filtro `roles: { none: {} }` garante que,
 * numa segunda execução, nenhum usuário já corrigido seja processado de novo.
 *
 * Uso:
 *   cd D:/PROJECTS/SIMPLIFICA/SIMP-BACKEND
 *   npx tsx prisma/scripts/backfill-admin-roles.ts
 */

import { PrismaClient } from '@prisma/client'
import { ensureAdminRole } from '../../src/services/rbac.service.js'

const prisma = new PrismaClient()

async function backfillAdminRoles() {
  console.log('🔎 Procurando usuários admin sem role vinculada...\n')

  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      isSuperAdmin: false,
      organizationId: { not: null },
      roles: { none: {} },
    },
    select: { id: true, email: true, organizationId: true },
  })

  if (candidates.length === 0) {
    console.log('✅ Nenhum usuário pendente. Nada a corrigir.')
    return
  }

  console.log(`⚠️  Encontrados ${candidates.length} usuário(s) sem role:`)
  candidates.forEach(u => console.log(`   - ${u.email} (org: ${u.organizationId})`))
  console.log('')

  const fixed: string[] = []

  for (const user of candidates) {
    await prisma.$transaction(async (tx) => {
      const adminRole = await ensureAdminRole(tx)
      await tx.userRole.create({
        data: { userId: user.id, roleId: adminRole.id, assignedBy: 'backfill-epic1' },
      })
    })
    fixed.push(user.email)
    console.log(`✅ Corrigido: ${user.email}`)
  }

  console.log(`\n✅ Backfill concluído. ${fixed.length} usuário(s) corrigido(s): ${fixed.join(', ')}`)
}

async function main() {
  console.log('🚀 Iniciando backfill de admin roles (Épico 1 / US2)...\n')

  try {
    await backfillAdminRoles()
  } catch (err) {
    console.error('❌ Backfill falhou:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
