import type { FastifyReply, FastifyRequest } from 'fastify'
import { authService } from '@/services/auth.service.js'
import { db, prisma } from '@/utils/database.js'
import { authLogger } from '@/utils/logger.js'
import { assignRoleSchema, createUserSchema, updateUserSchema, userQuerySchema } from '@/schemas/auth.schemas.js'

export class UserController {
  async getUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = userQuerySchema.parse(request.query)
      const where: any = {}

      if (query.search) {
        where.OR = [
          { email: { contains: query.search, mode: 'insensitive' } },
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { username: { contains: query.search, mode: 'insensitive' } }
        ]
      }

      if (query.isActive !== undefined) where.isActive = query.isActive
      if (query.isVerified !== undefined) where.isVerified = query.isVerified
      if (query.createdAfter) where.createdAt = { gte: query.createdAfter }
      if (query.createdBefore) where.createdAt = { ...where.createdAt, lte: query.createdBefore }

      if (query.role) where.roles = { some: { role: { name: query.role } } }

      const orderBy: any = {}
      if (query.sortBy) orderBy[query.sortBy] = query.sortOrder
      else orderBy.createdAt = 'desc'

      const total = await prisma.user.count({ where })
      const users = await prisma.user.findMany({
        where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit,
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          avatar: true, isActive: true, isVerified: true, twoFactorEnabled: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
          roles: { select: { role: { select: { id: true, name: true, displayName: true, color: true } } } }
        }
      })

      const paginatedResult = db.paginate(users, query.page, query.limit, total)

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'users_listed',
        resource: 'user',
        ipAddress: request.ip,
        success: true,
        metadata: { filters: query, resultCount: users.length }
      })

      return reply.send(paginatedResult)
    } catch (error: any) {
      authLogger.error(error, 'Failed to get users')
      return reply.code(500).send({ error: 'User Fetch Failed', message: error.message })
    }
  }

  async getUserById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          avatar: true, isActive: true, isVerified: true, twoFactorEnabled: true,
          lastLoginAt: true, createdAt: true, updatedAt: true, preferences: true, metadata: true,
          roles: { select: { id: true, assignedAt: true, expiresAt: true, role: { select: { id: true, name: true, displayName: true, description: true, color: true, permissions: true } } } }
        }
      })

      if (!user) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'user_viewed',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true
      })

      return reply.send({ user })
    } catch (error: any) {
      authLogger.error(error, 'Failed to get user by ID')
      return reply.code(500).send({ error: 'User Fetch Failed', message: error.message })
    }
  }

  async createUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createUserSchema.parse(request.body)
      const existingUser = await db.findUserByEmail(data.email)
      if (existingUser) return reply.code(400).send({ error: 'User Exists', message: 'User with this email already exists' })

      if (data.username) {
        const existingUsername = await prisma.user.findUnique({ where: { username: data.username } })
        if (existingUsername) return reply.code(400).send({ error: 'Username Taken', message: 'Username is already taken' })
      }

      const hashedPassword = await authService.hashPassword(data.password)
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(), password: hashedPassword, firstName: data.firstName,
          lastName: data.lastName, username: data.username, isActive: data.isActive ?? true, isVerified: data.isVerified ?? false
        },
        select: { id: true, email: true, username: true, firstName: true, lastName: true, isActive: true, isVerified: true, createdAt: true }
      })

      if (data.roles && data.roles.length > 0) {
        const roles = await prisma.role.findMany({ where: { name: { in: data.roles } } })
        const roleAssignments = roles.map(role => ({
          userId: user.id, roleId: role.id, assignedBy: (request as any).user?.id
        }))
        await prisma.userRole.createMany({ data: roleAssignments })
      }

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'user_created',
        resource: 'user',
        resourceId: user.id,
        ipAddress: request.ip,
        success: true,
        newData: { email: user.email, roles: data.roles }
      })

      authLogger.info({ adminId: (request as any).user?.id, createdUserId: user.id, email: user.email }, 'User created by admin')

      return reply.code(201).send({ message: 'User created successfully', user })
    } catch (error: any) {
      authLogger.error(error, 'Failed to create user')
      return reply.code(400).send({ error: 'User Creation Failed', message: error.message })
    }
  }

  async updateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = updateUserSchema.parse(request.body)

      const existingUser = await prisma.user.findUnique({ where: { id } })
      if (!existingUser) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      if (data.email && data.email !== existingUser.email) {
        const emailExists = await prisma.user.findFirst({ where: { email: data.email.toLowerCase(), id: { not: id } } })
        if (emailExists) return reply.code(400).send({ error: 'Email Taken', message: 'Email is already in use' })
      }

      if (data.username && data.username !== existingUser.username) {
        const usernameExists = await prisma.user.findFirst({ where: { username: data.username, id: { not: id } } })
        if (usernameExists) return reply.code(400).send({ error: 'Username Taken', message: 'Username is already taken' })
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { ...data, email: data.email?.toLowerCase() },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true, avatar: true,
          isActive: true, isVerified: true, updatedAt: true,
          roles: { select: { role: { select: { id: true, name: true, displayName: true } } } }
        }
      })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'user_updated',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { email: existingUser.email, isActive: existingUser.isActive },
        newData: data
      })

      return reply.send({ message: 'User updated successfully', user: updatedUser })
    } catch (error: any) {
      authLogger.error(error, 'Failed to update user')
      return reply.code(400).send({ error: 'User Update Failed', message: error.message })
    }
  }

  async deleteUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
      if (!user) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      if (user.id === (request as any).user?.id) { 
        return reply.code(400).send({ error: 'Self Deletion', message: 'Cannot delete your own account' })
      }

      await prisma.user.delete({ where: { id } })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'user_deleted',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { email: user.email }
      })

      authLogger.info({ adminId: (request as any).user?.id, deletedUserId: id, email: user.email }, 'User deleted by admin')

      return reply.send({ message: 'User deleted successfully' })
    } catch (error: any) {
      authLogger.error(error, 'Failed to delete user')
      return reply.code(500).send({ error: 'User Deletion Failed', message: error.message })
    }
  }

  async assignRoles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = assignRoleSchema.parse(request.body)

      const user = await prisma.user.findUnique({ where: { id } })
      if (!user) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      const roles = await prisma.role.findMany({ where: { id: { in: data.roleIds } } })
      if (roles.length !== data.roleIds.length) return reply.code(400).send({ error: 'Invalid Roles', message: 'Some role IDs are invalid' })

      await prisma.userRole.deleteMany({ where: { userId: id, roleId: { in: data.roleIds } } })

      const roleAssignments = data.roleIds.map(roleId => ({
        userId: id, roleId, assignedBy: (request as any).user?.id, expiresAt: data.expiresAt 
      }))

      await prisma.userRole.createMany({ data: roleAssignments })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'roles_assigned',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        newData: { roleIds: data.roleIds, roleNames: roles.map(r => r.name), expiresAt: data.expiresAt }
      })

      return reply.send({
        message: 'Roles assigned successfully',
        assignedRoles: roles.map(r => ({ id: r.id, name: r.name, displayName: r.displayName }))
      })
    } catch (error: any) {
      authLogger.error(error, 'Failed to assign roles')
      return reply.code(400).send({ error: 'Role Assignment Failed', message: error.message })
    }
  }

  async removeRoles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { roleIds } = request.body as { roleIds: string[] }

      const user = await prisma.user.findUnique({ where: { id } })
      if (!user) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
      const result = await prisma.userRole.deleteMany({ where: { userId: id, roleId: { in: roleIds } } })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'roles_removed',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        oldData: { roleIds, roleNames: roles.map(r => r.name) }
      })

      return reply.send({ message: `${result.count} role(s) removed successfully` })
    } catch (error: any) {
      authLogger.error(error, 'Failed to remove roles')
      return reply.code(500).send({ error: 'Role Removal Failed', message: error.message })
    }
  }

  async getUserSessions(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const sessions = await prisma.userSession.findMany({
        where: { userId: id, isActive: true, expiresAt: { gt: new Date() } },
        select: { id: true, fingerprint: true, ipAddress: true, userAgent: true, deviceType: true, deviceName: true, lastUsedAt: true, createdAt: true, expiresAt: true },
        orderBy: { lastUsedAt: 'desc' }
      })
      return reply.send({ sessions })
    } catch (error: any) {
      authLogger.error(error, 'Failed to get user sessions')
      return reply.code(500).send({ error: 'Sessions Fetch Failed', message: error.message })
    }
  }

  async terminateUserSessions(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const result = await prisma.userSession.updateMany({ where: { userId: id, isActive: true }, data: { isActive: false } })

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'user_sessions_terminated',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        metadata: { terminatedCount: result.count }
      })

      return reply.send({ message: `${result.count} session(s) terminated successfully` })
    } catch (error: any) {
      authLogger.error(error, 'Failed to terminate user sessions')
      return reply.code(500).send({ error: 'Session Termination Failed', message: error.message })
    }
  }

  async changeUserStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { isActive, reason } = request.body as { isActive: boolean; reason?: string }

      if (!isActive && id === (request as any).user?.id) { // CORREÇÃO
        return reply.code(400).send({ error: 'Self Deactivation', message: 'Cannot deactivate your own account' })
      }

      const user = await prisma.user.update({ where: { id }, data: { isActive }, select: { id: true, email: true, isActive: true } })

      if (!isActive) {
        await prisma.userSession.updateMany({ where: { userId: id }, data: { isActive: false } })
      }

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: isActive ? 'user_activated' : 'user_deactivated',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true,
        metadata: { reason }
      })

      return reply.send({ message: `User ${isActive ? 'activated' : 'deactivated'} successfully`, user })
    } catch (error: any) {
      authLogger.error(error, 'Failed to change user status')
      return reply.code(500).send({ error: 'Status Change Failed', message: error.message })
    }
  }

  async forcePasswordReset(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
      if (!user) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      await authService.forgotPassword(user.email, request.ip)

      await db.createAuditLog({
        userId: (request as any).user?.id, 
        action: 'password_reset_forced',
        resource: 'user',
        resourceId: id,
        ipAddress: request.ip,
        success: true
      })

      return reply.send({ message: 'Password reset email sent to user' })
    } catch (error: any) {
      authLogger.error(error, 'Failed to force password reset')
      return reply.code(500).send({ error: 'Password Reset Failed', message: error.message })
    }
  }
}

export const userController = new UserController()