import type { FastifyReply, FastifyRequest } from 'fastify'
import { db, prisma } from '@/utils/database.js'
import { authLogger } from '@/utils/logger.js'
import { createRoleSchema, paginationSchema, updateRoleSchema } from '@/schemas/auth.schemas.js'
import { z } from 'zod'

const AVAILABLE_PERMISSIONS = {
  users: {
    displayName: 'Gestão de Usuários',
    permissions: [
      { key: 'users:read', description: 'Visualizar listagem de usuários', level: 'read' },
      { key: 'users:write', description: 'Criar e editar usuários', level: 'write' },
      { key: 'users:delete', description: 'Excluir usuários', level: 'delete' },
      { key: 'users:manage', description: 'Controle total de usuários (inclui reset de senha)', level: 'admin' }
    ]
  },
  roles: {
    displayName: 'Gestão de Perfis (Roles)',
    permissions: [
      { key: 'roles:read', description: 'Visualizar perfis de acesso', level: 'read' },
      { key: 'roles:write', description: 'Criar e editar perfis', level: 'write' },
      { key: 'roles:delete', description: 'Excluir perfis', level: 'delete' },
      { key: 'roles:manage', description: 'Gerenciar permissões avançadas', level: 'admin' }
    ]
  },
  finance: {
    displayName: 'Módulo Financeiro',
    permissions: [
      { key: 'finance:read', description: 'Visualizar relatórios financeiros', level: 'read' },
      { key: 'finance:write', description: 'Lançar despesas e receitas', level: 'write' },
      { key: 'finance:approve', description: 'Aprovar transações', level: 'admin' },
      { key: 'finance:export', description: 'Exportar dados financeiros', level: 'read' }
    ]
  },
  settings: {
    displayName: 'Configurações do Sistema',
    permissions: [
      { key: 'settings:read', description: 'Ver configurações globais', level: 'read' },
      { key: 'settings:write', description: 'Alterar configurações globais', level: 'write' },
      { key: 'system:admin', description: 'Acesso de Super Administrador', level: 'admin' },
      { key: 'audit:read', description: 'Acessar logs de auditoria', level: 'read' },
      { key: 'audit:export', description: 'Baixar logs de auditoria', level: 'read' }
    ]
  },
  communication: {
    displayName: 'Comunicação e Protocolo',
    permissions: [
      { key: 'documents:read', description: 'Visualizar documentos e processos', level: 'read' },
      { key: 'documents:create', description: 'Criar novos documentos (Memorandos, Ofícios)', level: 'write' },
      { key: 'documents:manage', description: 'Gerenciar todos os documentos (Editar/Excluir)', level: 'admin' },
      { key: 'documents:sign', description: 'Assinar documentos digitalmente', level: 'write' },
      { key: 'documents:send', description: 'Enviar documentos (Protocolar)', level: 'write' }
    ]
  },
  security: {
    displayName: 'Segurança & Sessões',
    permissions: [
      { key: 'sessions:view', description: 'Ver sessões ativas', level: 'read' },
      { key: 'sessions:manage', description: 'Derrubar sessões de usuários', level: 'admin' },
      { key: 'backup:create', description: 'Gerar backup manual', level: 'admin' },
      { key: 'backup:restore', description: 'Restaurar sistema', level: 'admin' }
    ]
  },
  processes: {
    displayName: 'Processos Virtuais',
    permissions: [
      { key: 'processes:read', description: 'Visualizar processos virtuais', level: 'read' },
      { key: 'processes:write', description: 'Criar e editar processos', level: 'write' },
      { key: 'processes:download', description: 'Baixar documentos de processos', level: 'read' },
      { key: 'processes:manage', description: 'Gerenciar todos os processos', level: 'admin' }
    ]
  },
  library: {
    displayName: 'Biblioteca Digital (GED)',
    permissions: [
      { key: 'library:read',   description: 'Visualizar e baixar documentos da biblioteca', level: 'read' },
      { key: 'library:write',  description: 'Fazer upload de documentos',                   level: 'write' },
      { key: 'library:delete', description: 'Excluir documentos da biblioteca',              level: 'delete' },
      { key: 'library:logs',   description: 'Visualizar histórico de auditoria da biblioteca', level: 'read' }
    ]
  },
  covenants: {
    displayName: 'Convênios, Emendas e Transferências',
    permissions: [
      { key: 'covenants:read',   description: 'Visualizar convênios e transferências', level: 'read' },
      { key: 'covenants:write',  description: 'Criar e editar convênios',              level: 'write' },
      { key: 'covenants:delete', description: 'Excluir convênios',                     level: 'delete' },
    ]
  }
}

export class RoleController {
  async getRoles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = paginationSchema
        .extend({
          search: z.string().optional(),
          isActive: z.coerce.boolean().optional(),
          isSystem: z.coerce.boolean().optional(),
          sortBy: z.string().optional(),
          sortOrder: z.enum(['asc', 'desc']).optional()
        })
        .parse(request.query)

      const where: any = {}
      const andConditions: any[] = []

      // Isolamento: mostra roles do sistema (isSystem) + roles da própria org
      if (!request.user.isSuperAdmin) {
        andConditions.push({ OR: [{ organizationId: request.user.organizationId }, { isSystem: true }] })
      }

      if (query.search) {
        andConditions.push({ OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { displayName: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } }
        ]})
      }

      if (andConditions.length > 0) where.AND = andConditions

      if (query.isActive !== undefined) where.isActive = query.isActive
      if (query.isSystem !== undefined) where.isSystem = query.isSystem

      const orderBy: any = {}
      if (query.sortBy) {
        orderBy[query.sortBy] = query.sortOrder || 'asc'
      } else {
        orderBy.name = 'asc'
      }

      const total = await prisma.role.count({ where })

      const roles = await prisma.role.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          _count: {
            select: { users: true }
          }
        }
      })

      const paginatedResult = db.paginate(roles, query.page, query.limit, total)

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'roles_listed',
        resource: 'role',
        ipAddress: request.ip,
        success: true,
        metadata: {
          filters: query,
          resultCount: roles.length
        }
      })

      return reply.send(paginatedResult)
    } catch (error: any) {
      authLogger.error(error, 'Failed to get roles')
      return reply.code(500).send({
        error: 'Roles Fetch Failed',
        message: error.message
      })
    }
  }

  async getRoleById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const role = await prisma.role.findUnique({
        where: { id },
        include: {
          parent: { select: { id: true, name: true, displayName: true } },
          children: { select: { id: true, name: true, displayName: true } },
          _count: { select: { users: true } }
        }
      })

      if (!role) {
        return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      }

      // Verificar acesso: role deve ser do sistema ou da org do usuário
      if (!request.user.isSuperAdmin && !role.isSystem && role.organizationId !== request.user.organizationId) {
        return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      }

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'role_viewed',
        resource: 'role',
        resourceId: id,
        ipAddress: request.ip,
        success: true
      })

      return reply.send({ role })
    } catch (error: any) {
      authLogger.error(error, 'Failed to get role by ID')
      return reply.code(500).send({ error: 'Role Fetch Failed', message: error.message })
    }
  }

  async createRole(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createRoleSchema.parse(request.body)

      const existingRole = await prisma.role.findUnique({ where: { name: data.name } })
      if (existingRole) {
        return reply.code(400).send({ error: 'Role Exists', message: 'Role with this name already exists' })
      }

      if (data.parentId) {
        const parentRole = await prisma.role.findUnique({ where: { id: data.parentId } })
        if (!parentRole) {
          return reply.code(400).send({ error: 'Invalid Parent', message: 'Parent role not found' })
        }
      }

      const role = await prisma.role.create({
        data: {
          name: data.name,
          displayName: data.displayName,
          description: data.description,
          color: data.color,
          permissions: data.permissions,
          parentId: data.parentId,
          metadata: data.metadata,
          isSystem: false,
          isActive: true,
          organizationId: request.user.organizationId
        }
      })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'role_created',
        resource: 'role',
        resourceId: role.id,
        ipAddress: request.ip,
        success: true,
        newData: { name: role.name, permissions: data.permissions }
      })

      authLogger.info({ adminId: (request as any).user?.id, roleId: role.id, roleName: role.name }, 'Role created')

      return reply.code(201).send({ message: 'Role created successfully', role })
    } catch (error: any) {
      authLogger.error(error, 'Failed to create role')
      return reply.code(400).send({ error: 'Role Creation Failed', message: error.message })
    }
  }

  async updateRole(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = updateRoleSchema.parse(request.body)

      const existingRole = await prisma.role.findUnique({ where: { id } })
      if (!existingRole) {
        return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      }

      if (!request.user.isSuperAdmin && !existingRole.isSystem && existingRole.organizationId !== request.user.organizationId) {
        return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      }

      if (existingRole.isSystem && data.name && data.name !== existingRole.name) {
        return reply.code(400).send({ error: 'System Role', message: 'Cannot rename system roles' })
      }

      if (data.name && data.name !== existingRole.name) {
        const nameExists = await prisma.role.findFirst({ where: { name: data.name, id: { not: id } } })
        if (nameExists) return reply.code(400).send({ error: 'Name Taken', message: 'Role name is already in use' })
      }

      const updatedRole = await prisma.role.update({ where: { id }, data })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'role_updated',
        resource: 'role',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { name: existingRole.name },
        newData: data
      })

      return reply.send({ message: 'Role updated successfully', role: updatedRole })
    } catch (error: any) {
      authLogger.error(error, 'Failed to update role')
      return reply.code(400).send({ error: 'Role Update Failed', message: error.message })
    }
  }

  async deleteRole(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } })
      if (!role) return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      if (!request.user.isSuperAdmin && !role.isSystem && role.organizationId !== request.user.organizationId) {
        return reply.code(404).send({ error: 'Role Not Found', message: 'Role with specified ID not found' })
      }
      if (role.isSystem) return reply.code(400).send({ error: 'System Role', message: 'Cannot delete system roles' })
      if (role._count.users > 0) return reply.code(400).send({ error: 'Role In Use', message: `Role is assigned to ${role._count.users} user(s).` })

      await prisma.role.delete({ where: { id } })

      await db.createAuditLog({
        userId: (request as any).user?.id,
        action: 'role_deleted',
        resource: 'role',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { name: role.name }
      })

      authLogger.info({ adminId: (request as any).user?.id, roleId: id }, 'Role deleted')

      return reply.send({ message: 'Role deleted successfully' })
    } catch (error: any) {
      authLogger.error(error, 'Failed to delete role')
      return reply.code(500).send({ error: 'Role Deletion Failed', message: error.message })
    }
  }

  async getRoleUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const query = paginationSchema.extend({ isActive: z.boolean().optional() }).parse(request.query)

      const role = await prisma.role.findUnique({ where: { id } })
      if (!role) return reply.code(404).send({ error: 'Role Not Found', message: 'Role not found' })

      const where: any = { roles: { some: { roleId: id } } }
      if (query.isActive !== undefined) where.isActive = query.isActive
      if (!request.user.isSuperAdmin) where.organizationId = request.user.organizationId

      const total = await prisma.user.count({ where })
      const users = await prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true, email: true, firstName: true, lastName: true, username: true,
          isActive: true, isVerified: true, createdAt: true,
          roles: { where: { roleId: id }, select: { assignedAt: true, expiresAt: true, assignedBy: true } }
        },
        orderBy: { createdAt: 'desc' }
      })

      const paginatedResult = db.paginate(users, query.page, query.limit, total)
      return reply.send(paginatedResult)
    } catch (error: any) {
      authLogger.error(error, 'Failed to get role users')
      return reply.code(500).send({ error: 'Role Users Fetch Failed', message: error.message })
    }
  }

  async getAvailablePermissions(request: FastifyRequest, reply: FastifyReply) {
    try {
      const isSuperAdmin = request.user?.isSuperAdmin ?? false

      if (isSuperAdmin) {
        return reply.send({
          permissions: AVAILABLE_PERMISSIONS,
          categories: Object.keys(AVAILABLE_PERMISSIONS),
        })
      }

      // Org admins: strip super-admin-only permissions
      // - system:admin  → not a real role permission (it's a User field)
      // - audit:*        → system-level audit logs, not org-scoped
      // - backup:*       → infrastructure ops, not available to orgs
      const SUPER_ADMIN_ONLY_PERMS = new Set([
        'system:admin',
        'audit:read',
        'audit:export',
        'backup:create',
        'backup:restore',
      ])

      const filtered: Record<string, typeof AVAILABLE_PERMISSIONS[keyof typeof AVAILABLE_PERMISSIONS]> = {}

      for (const [catKey, cat] of Object.entries(AVAILABLE_PERMISSIONS)) {
        const visiblePerms = cat.permissions.filter(p => !SUPER_ADMIN_ONLY_PERMS.has(p.key))
        if (visiblePerms.length > 0) {
          filtered[catKey] = { ...cat, permissions: visiblePerms }
        }
      }

      return reply.send({
        permissions: filtered,
        categories: Object.keys(filtered),
      })
    } catch (error: any) {
      authLogger.error(error, 'Failed to get available permissions')
      return reply.code(500).send({ error: 'Permissions Fetch Failed', message: error.message })
    }
  }

  async duplicateRole(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { name, displayName, description } = request.body as any

      const sourceRole = await prisma.role.findUnique({ where: { id } })
      if (!sourceRole) return reply.code(404).send({ error: 'Source Role Not Found', message: 'Source role not found' })

      const existingRole = await prisma.role.findUnique({ where: { name } })
      if (existingRole) return reply.code(400).send({ error: 'Role Exists', message: 'Role with this name already exists' })

      const duplicatedRole = await prisma.role.create({
        data: {
          name, displayName, description: description || `Copy of ${sourceRole.displayName}`,
          color: sourceRole.color, permissions: sourceRole.permissions || [],
          parentId: sourceRole.parentId, metadata: sourceRole.metadata || {},
          isSystem: false, isActive: true,
          organizationId: request.user.organizationId
        }
      })

      await db.createAuditLog({
        userId: (request as any).user?.id, // CORREÇÃO
        action: 'role_duplicated',
        resource: 'role',
        resourceId: duplicatedRole.id,
        ipAddress: request.ip,
        success: true,
        metadata: { sourceRoleId: id }
      })

      return reply.code(201).send({ message: 'Role duplicated successfully', role: duplicatedRole })
    } catch (error: any) {
      authLogger.error(error, 'Failed to duplicate role')
      return reply.code(400).send({ error: 'Role Duplication Failed', message: error.message })
    }
  }

  async getRoleHierarchy(request: FastifyRequest, reply: FastifyReply) {
    try {
      const hierarchyWhere: any = { isActive: true }
      if (!request.user.isSuperAdmin) {
        hierarchyWhere.OR = [{ organizationId: request.user.organizationId }, { isSystem: true }]
      }
      const roles = await prisma.role.findMany({
        where: hierarchyWhere,
        select: { id: true, name: true, displayName: true, parentId: true },
        orderBy: { name: 'asc' }
      })
      const buildHierarchy = (parentId: string | null = null, level = 0): any[] => {
        return roles.filter(role => role.parentId === parentId).map(role => ({
          id: role.id, name: role.name, displayName: role.displayName, level,
          children: buildHierarchy(role.id, level + 1)
        }))
      }
      return reply.send({ hierarchy: buildHierarchy() })
    } catch (error: any) {
      authLogger.error(error, 'Failed to get role hierarchy')
      return reply.code(500).send({ error: 'Hierarchy Fetch Failed', message: error.message })
    }
  }
}

export const roleController = new RoleController()