/**
 * Sync script — Épico 2 (UX, Refatoração de Protocolos e Correções de Frontend)
 *
 * O papel global "admin" é criado apenas uma vez via `ensureAdminRole()`'s upsert
 * (`update: {}` — um no-op proposital para não sobrescrever customizações manuais
 * feitas na tela de Roles). Isso significa que, quando o catálogo em
 * `src/constants/permissions.ts` ganha uma chave nova (ex: `communication:read`),
 * um papel "admin" já existente no banco NÃO a recebe automaticamente.
 *
 * Este script fecha essa lacuna pontualmente: calcula a união entre as permissões
 * atuais do papel "admin" e `DEFAULT_ADMIN_PERMISSIONS` (a fonte de verdade), e
 * só grava se houver diferença. Idempotente por construção — seguro para rodar
 * de novo a qualquer momento (ex: depois de adicionar mais chaves ao catálogo).
 *
 * Uso:
 *   cd D:/PROJECTS/SIMPLIFICA/SIMP-BACKEND
 *   npx tsx prisma/scripts/sync-admin-role-permissions.ts
 */

import { PrismaClient } from '@prisma/client'
import { DEFAULT_ADMIN_PERMISSIONS } from '../../src/constants/permissions.js'

const prisma = new PrismaClient()

async function syncAdminRolePermissions() {
  console.log('🔎 Verificando permissões do papel "admin"...\n')

  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } })

  if (!adminRole) {
    console.log('✅ Papel "admin" ainda não existe — nada a sincronizar (será criado com o catálogo completo na primeira vez que for necessário).')
    return
  }

  const current = new Set((adminRole.permissions as string[]) ?? [])
  const missing = DEFAULT_ADMIN_PERMISSIONS.filter(p => !current.has(p))

  if (missing.length === 0) {
    console.log('✅ Papel "admin" já contém todas as permissões do catálogo. Nada a fazer.')
    return
  }

  const merged = [...current, ...missing]

  await prisma.role.update({
    where: { name: 'admin' },
    data: { permissions: merged },
  })

  console.log(`⚠️  Permissões adicionadas ao papel "admin" (${missing.length}): ${missing.join(', ')}`)
  console.log(`✅ Papel "admin" agora tem ${merged.length} permissões (antes: ${current.size}).`)
}

async function main() {
  console.log('🚀 Iniciando sincronização de permissões do papel "admin" (Épico 2)...\n')

  try {
    await syncAdminRolePermissions()
  } catch (err) {
    console.error('❌ Sincronização falhou:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
