import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { DEFAULT_ADMIN_PERMISSIONS } from '@/constants/permissions.js'

/**
 * Garante que a role global "admin" exista e retorna seu id — chamado dentro
 * da mesma transaction que cria a Organization + User, para que a vinculação
 * do UserRole nunca dependa de um seed prévio ter rodado (self-healing).
 */
export async function ensureAdminRole(tx: Prisma.TransactionClient): Promise<{ id: string }> {
  return tx.role.upsert({
    where: { name: 'admin' },
    // Ressincroniza SEMPRE com o catálogo atual — não `{}`. A role já existir
    // não pode significar "não mexe mais": ela é global (uma só para TODAS as
    // organizações) e "self-healing" (docstring acima) só é verdade se toda
    // chamada também curar uma role antiga. Sem isto, qualquer permissão nova
    // adicionada a AVAILABLE_PERMISSIONS depois do primeiro seed nunca chega
    // a nenhum admin de organização já existente — foi o que bloqueou
    // "Admin Local" em audit:read/audit:export mesmo com as duas já no
    // catálogo (achado do Painel de Auditoria, 2026-09-22).
    update: { permissions: DEFAULT_ADMIN_PERMISSIONS },
    create: {
      name: 'admin',
      displayName: 'Administrador',
      isSystem: true,
      permissions: DEFAULT_ADMIN_PERMISSIONS,
    },
    select: { id: true },
  })
}

/**
 * Ressincroniza a role global `admin` com o catálogo atual, para TODAS as
 * organizações de uma vez (a role é uma linha só).
 *
 * Sem isto, `ensureAdminRole` só rodava ao criar uma organização: uma permissão
 * nova no catálogo (ex.: `fleet:*`) nunca chegava aos admins das prefeituras já
 * existentes. Chamada no boot do servidor; idempotente.
 */
export async function syncAdminRoleWithCatalog(): Promise<{ id: string }> {
  return prisma.$transaction(tx => ensureAdminRole(tx))
}

export const PERMISSION_MISSING_MESSAGE =
  'Esse usuário não tem permissão para essa ferramenta. Se for admin, acesse a parte de permissões (Roles), edite o cargo que foi atribuído a ele clicando no ícone do lápis, e marque as permissões necessárias.'

/**
 * Resolve o Set de permissões efetivas de um usuário a partir das suas Roles ativas.
 * Retorna null se o usuário não existir ou estiver inativo.
 */
async function resolvePermissions(userId: string): Promise<Set<string> | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      roles: {
        include: { role: { select: { isActive: true, permissions: true } } }
      }
    }
  })

  if (!user?.isActive) return null

  const perms = new Set<string>()
  for (const ur of user.roles) {
    if (ur.role.isActive) {
      const list = ur.role.permissions as string[]
      if (Array.isArray(list)) list.forEach(p => perms.add(p))
    }
  }
  return perms
}

/**
 * Retorna true se o usuário tiver a permissão dada (ou system:admin).
 */
export async function userHasPermission(userId: string, permission: string): Promise<boolean> {
  const perms = await resolvePermissions(userId)
  if (!perms) return false
  return perms.has('system:admin') || perms.has(permission)
}

/**
 * Para uma lista de userIds, retorna um Set dos IDs que possuem a permissão.
 * Ideal para anotar listas com `hasPermission` em uma única query.
 */
export async function getUsersWithPermission(
  userIds: string[],
  permission: string
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: {
      id: true,
      roles: {
        include: { role: { select: { isActive: true, permissions: true } } }
      }
    }
  })

  const result = new Set<string>()
  for (const user of users) {
    const perms = new Set<string>()
    for (const ur of user.roles) {
      if (ur.role.isActive) {
        const list = ur.role.permissions as string[]
        if (Array.isArray(list)) list.forEach(p => perms.add(p))
      }
    }
    if (perms.has('system:admin') || perms.has(permission)) {
      result.add(user.id)
    }
  }
  return result
}
