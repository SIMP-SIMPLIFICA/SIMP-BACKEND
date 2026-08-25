import type { FastifyReply, FastifyRequest } from 'fastify'
import { authService } from '@/services/auth.service.js'
import { db } from '@/utils/database.js'
import { prisma } from '@/lib/prisma.js'
import { authLogger } from '@/utils/logger.js'
import { assignRoleSchema, createUserSchema, updateUserSchema, userQuerySchema } from '@/schemas/auth.schemas.js'
import { certificateService } from '@/services/certificate.service.js'
import { deleteFile, getFileUrl, saveFile } from '@/services/storage.service.js'
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'

export class UserController {
  async getUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = userQuerySchema.parse(request.query)
      const where: any = {}

      // Isolamento por organização
      if (!request.user.isSuperAdmin) {
        where.organizationId = request.user.organizationId
      }

      if (query.search) {
        where.OR = [
          { email: { contains: query.search, mode: 'insensitive' } },
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { username: { contains: query.search, mode: 'insensitive' } },
        ]
      }

      if (query.isActive !== undefined) where.isActive = query.isActive
      if (query.isVerified !== undefined) where.isVerified = query.isVerified
      if (query.createdAfter) where.createdAt = { gte: query.createdAfter }
      if (query.createdBefore) where.createdAt = { ...where.createdAt, lte: query.createdBefore }
      if (query.role) where.roles = { some: { role: { name: query.role } } }

      // Super admin pode filtrar por organização específica
      if (request.user.isSuperAdmin && query.organizationId) {
        where.organizationId = query.organizationId
      }

      const orderBy: any = {}
      if (query.sortBy) orderBy[query.sortBy] = query.sortOrder
      else orderBy.createdAt = 'desc'

      const total = await prisma.user.count({ where })
      const users = await prisma.user.findMany({
        where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit,
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          avatar: true, isActive: true, isVerified: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
          organization: { select: { id: true, name: true } },
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
      let { id } = request.params as { id: string }

      // --- INÍCIO DA CORREÇÃO ---
      // Se o ID passado na URL for 'me', buscamos o ID real no token decodificado
      if (id === 'me') {
        const authUser = (request as any).user
        id = authUser?.id || authUser?.sub

        if (!id) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'User ID not found in token' })
        }
      }
      // --- FIM DA CORREÇÃO ---

      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }

      const user = await prisma.user.findFirst({
        where: { id, ...orgFilter },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          avatar: true, isActive: true, isVerified: true,
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
      const parseResult = createUserSchema.safeParse(request.body)
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0]
        return reply.code(400).send({ error: 'Validation Error', message: firstIssue.message })
      }
      const data = parseResult.data
      const existingUser = await db.findUserByEmail(data.email)
      if (existingUser) return reply.code(400).send({ error: 'User Exists', message: 'User with this email already exists' })

      if (data.username) {
        const existingUsername = await prisma.user.findUnique({ where: { username: data.username } })
        if (existingUsername) return reply.code(400).send({ error: 'Username Taken', message: 'Username is already taken' })
      }

      const hashedPassword = await authService.hashPassword(data.password)

      const user = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          email: data.email.toLowerCase(), firstName: data.firstName,
          lastName: data.lastName, username: data.username, isActive: data.isActive ?? true, isVerified: data.isVerified ?? false,
          password: hashedPassword,
          organizationId: request.user.organizationId
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
      const parseResult = updateUserSchema.safeParse(request.body)
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0]
        return reply.code(400).send({ error: 'Validation Error', message: firstIssue.message })
      }
      const data = parseResult.data

      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const existingUser = await prisma.user.findFirst({ where: { id, ...orgFilter } })
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
      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const user = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true, email: true } })
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

      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const user = await prisma.user.findFirst({ where: { id, ...orgFilter } })
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

      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const user = await prisma.user.findFirst({ where: { id, ...orgFilter } })
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
      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const targetUser = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true } })
      if (!targetUser) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })
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
      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const targetUser = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true } })
      if (!targetUser) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })
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

  async terminateSingleSession(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, sessionId } = request.params as { id: string; sessionId: string }
      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const targetUser = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true } })
      if (!targetUser) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

      const session = await prisma.userSession.findFirst({ where: { id: sessionId, userId: id, isActive: true } })
      if (!session) return reply.code(404).send({ error: 'Session Not Found', message: 'Session not found or already terminated' })

      await prisma.userSession.update({ where: { id: sessionId }, data: { isActive: false } })

      return reply.send({ message: 'Session terminated successfully' })
    } catch (error: any) {
      authLogger.error(error, 'Failed to terminate single session')
      return reply.code(500).send({ error: 'Session Termination Failed', message: error.message })
    }
  }

  async changeUserStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { isActive, reason } = request.body as { isActive: boolean; reason?: string }

      if (!isActive && id === request.user.id) {
        return reply.code(400).send({ error: 'Self Deactivation', message: 'Cannot deactivate your own account' })
      }

      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const existingUser = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true } })
      if (!existingUser) return reply.code(404).send({ error: 'User Not Found', message: 'User with specified ID not found' })

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
      const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
      const user = await prisma.user.findFirst({ where: { id, ...orgFilter }, select: { id: true, email: true } })
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

  async generateCertificate(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as any
    const userId = user.id || user.sub

    try {
      const fullUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { departments: { take: 1 } }
      })

      if (!fullUser) {
        return reply.code(404).send({ message: 'User Not Found' })
      }

      const pfxBuffer = await certificateService.generateForUser({
        username: fullUser.username || 'usuario',
        fullName: `${fullUser.firstName || ''} ${fullUser.lastName || ''}`.trim(),
        email: fullUser.email,
        department: fullUser.departments[0]?.name || 'Geral'
      })

      await certificateService.saveUserCertificate(userId, pfxBuffer)

      const currentMeta = (fullUser.metadata as object) || {}
      await prisma.user.update({
        where: { id: userId },
        data: {
          metadata: {
            ...currentMeta,
            has_digital_certificate: true,
            certificate_generated_at: new Date()
          }
        }
      })

      await db.createAuditLog({
        userId: userId,
        action: 'certificate_generated',
        resource: 'user',
        resourceId: userId,
        ipAddress: request.ip,
        success: true
      })

      return reply.send({
        message: 'Certificado digital gerado com sucesso! Agora você pode assinar documentos.',
        hasCertificate: true
      })

    } catch (error: any) {
      authLogger.error(error, 'Failed to generate certificate')
      return reply.code(500).send({ error: 'Certificate Generation Failed', message: error.message })
    }
  }

  async uploadLogo(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as any
    const userId = user.id || user.sub

    try {
      const data = await request.file()

      if (!data) {
        return reply.code(400).send({ message: 'Nenhum arquivo enviado' })
      }

      // Valida tipo de arquivo
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!allowedMimeTypes.includes(data.mimetype)) {
        return reply.code(400).send({ message: 'Tipo de arquivo inválido. Envie uma imagem (JPEG, PNG, WebP ou GIF).' })
      }

      // Lê o conteúdo completo para verificar tamanho (max 5MB)
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      const fileBuffer = Buffer.concat(chunks)

      if (fileBuffer.length > 5 * 1024 * 1024) {
        return reply.code(400).send({ message: 'Arquivo muito grande. O limite é 5MB.' })
      }

      // Assinatura binária real. A checagem de mimetype acima confia no cliente;
      // esta não. SVG fica de fora da política de propósito: é XML com script
      // embutido, e /uploads/ é servido estaticamente sem autenticação.
      const detectedLogo = assertAllowedFile(fileBuffer, {
        policy: UPLOAD_POLICIES.IMAGES_ONLY,
        declaredMime: data.mimetype,
        fileName: data.filename,
      })

      // Remove logo antiga do R2 se existir
      const existingUser = await prisma.user.findUnique({ where: { id: userId } })
      const existingMeta = (existingUser?.metadata as any) || {}
      if (existingMeta?.logoKey) {
        try {
          await deleteFile(existingMeta.logoKey)
        } catch (_e) { /* ignora */ }
      }

      // A extensão gravada vem do tipo DETECTADO, não do nome nem do mimetype
      // declarado: assim o arquivo em disco nunca recebe uma extensão que mente
      // sobre o próprio conteúdo.
      const ext = `.${detectedLogo.extensions[0]}`

      const logoKey = await saveFile(fileBuffer, {
        organizationId: (request.user as any)?.organizationId ?? null,
        scope: 'logos',
        originalName: `logo${ext}`,
      })

      const logoUrl = getFileUrl(logoKey)

      // Atualiza metadata com key (para deleção futura) e URL pública
      await prisma.user.update({
        where: { id: userId },
        data: {
          metadata: {
            ...existingMeta,
            logoKey,
            logoUrl
          }
        }
      })

      await db.createAuditLog({
        userId,
        action: 'logo_uploaded',
        resource: 'user',
        resourceId: userId,
        ipAddress: request.ip,
        success: true,
        newData: { logoUrl }
      })

      return reply.send({ message: 'Logo carregada com sucesso', logoUrl })
    } catch (error: any) {
      authLogger.error(error, 'Failed to upload logo')
      return reply.code(500).send({ error: 'Logo Upload Failed', message: error.message })
    }
  }

  async removeLogo(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as any
    const userId = user.id || user.sub

    try {
      const existingUser = await prisma.user.findUnique({ where: { id: userId } })
      if (!existingUser) {
        return reply.code(404).send({ message: 'Usuário não encontrado' })
      }

      const existingMeta = (existingUser.metadata as any) || {}

      // Remove do R2 se existir
      if (existingMeta?.logoKey) {
        try {
          await deleteFile(existingMeta.logoKey)
        } catch (_e) { /* ignora */ }
      }

      // Remove logoKey e logoUrl da metadata
      const { logoKey: _key, logoUrl: _url, ...restMeta } = existingMeta
      await prisma.user.update({
        where: { id: userId },
        data: { metadata: restMeta }
      })

      await db.createAuditLog({
        userId,
        action: 'logo_removed',
        resource: 'user',
        resourceId: userId,
        ipAddress: request.ip,
        success: true
      })

      return reply.send({ message: 'Logo removida com sucesso' })
    } catch (error: any) {
      authLogger.error(error, 'Failed to remove logo')
      return reply.code(500).send({ error: 'Logo Removal Failed', message: error.message })
    }
  }
}

export const userController = new UserController()