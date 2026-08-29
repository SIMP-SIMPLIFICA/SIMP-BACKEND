import { randomInt, randomUUID } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { SignJWT, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { config } from '@/config/config.js'
import { db, prisma } from '@/utils/database.js'
import { authLogger, logSecurity } from '@/utils/logger.js'
import { emailService } from '@/services/email.service.js'
import { calcularFingerprint } from '@/services/fingerprint.service.js'

export class AuthService {
  /** Gera uma senha temporária forte para contas criadas por um admin (nunca retornada na resposta da API — apenas por e-mail). */
  generateTempPassword(): string {
    const lower = 'abcdefghijkmnpqrstuvwxyz'
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const nums = '23456789'
    const special = '@$!%*?&'
    // randomInt (CSPRNG) em vez de Math.random(): este valor é uma CREDENCIAL.
    // Math.random() é um PRNG previsível — conhecendo saídas anteriores é possível
    // inferir as próximas, o que tornaria senhas temporárias adivinháveis
    // (CodeQL: insecure randomness).
    const rand = (s: string) => s[randomInt(s.length)]
    const base = Array.from({ length: 6 }, () => rand(lower)).join('')
    return rand(upper) + base + rand(nums) + rand(special)
  }

  async hashPassword(password: string): Promise<string> {
    try {
      return await hash(password, {
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4
      })
    } catch (error) {
      authLogger.error(error, 'Failed to hash password')
      // `cause` preserva a origem: sem isso, a causa real do erro se perde ao
      // trocar a exceção por uma mensagem genérica.
      throw new Error('Password hashing failed', { cause: error })
    }
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    try {
      return await verify(hashedPassword, password)
    } catch (error) {
      authLogger.error(error, 'Failed to verify password')
      return false
    }
  }

  async generateAccessToken(
    userId: string,
    permissions: string[],
    organizationId: string | null,
    isSuperAdmin: boolean,
    /** Fingerprint da sessão — ver src/services/fingerprint.service.ts */
    fingerprint?: string
  ): Promise<string> {
    const secret = new TextEncoder().encode(config.jwt.accessSecret)
    const jti = nanoid()

    return await new SignJWT({
      sub: userId,
      permissions,
      organizationId,
      isSuperAdmin,
      // Vincula o token ao dispositivo/faixa de rede de origem. O middleware
      // recalcula e compara a cada requisição (Task 2.2).
      fp: fingerprint,
      type: 'access'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(config.jwt.accessExpiresIn)
      .setIssuer(config.urls.app)
      .setAudience(config.urls.app)
      .sign(secret)
  }

  async generateRefreshToken(userId: string, rememberMe = false): Promise<string> {
    const secret = new TextEncoder().encode(config.jwt.refreshSecret)
    const jti = nanoid()
    const expiry = rememberMe ? '30d' : config.jwt.refreshExpiresIn

    return await new SignJWT({
      sub: userId,
      type: 'refresh'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .setIssuer(config.urls.app)
      .setAudience(config.urls.app)
      .sign(secret)
  }

  async verifyRefreshToken(token: string): Promise<any> {
    try {
      const secret = new TextEncoder().encode(config.jwt.refreshSecret)
      const { payload } = await jwtVerify(token, secret)
      return payload
    } catch {
      throw new Error('Invalid refresh token')
    }
  }

  async generateTokenPair(userId: string, rememberMe = false, fingerprint?: string) {
    const [permissions, user] = await Promise.all([
      db.getUserPermissions(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true, isSuperAdmin: true }
      })
    ])

    const accessToken = await this.generateAccessToken(
      userId,
      permissions,
      user?.organizationId ?? null,
      user?.isSuperAdmin ?? false,
      fingerprint
    )

    const refreshDays = rememberMe ? 30 : 7
    const refreshToken = await this.generateRefreshToken(userId, rememberMe)

    await db.createUserSession({
      userId,
      refreshToken,
      expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000)
    })

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60
    }
  }

  async register(data: any, ipAddress: string) {
    try {
      const existingUser = await db.findUserByEmail(data.email)
      if (existingUser) {
        throw new Error('User already exists with this email')
      }

      if (data.username) {
        const existingUsername = await prisma.user.findUnique({
          where: { username: data.username }
        })
        if (existingUsername) {
          throw new Error('Username already taken')
        }
      }

      const hashedPassword = await this.hashPassword(data.password)
      const verifyToken = nanoid(32)

      const user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: data.email.toLowerCase(),
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          password: hashedPassword,
          verifyToken,
          isActive: true,
          isVerified: true
        },
        include: {
          roles: {
            include: {
              role: true
            }
          }
        }
      })

      const userRole = await prisma.role.findUnique({
        where: { name: 'user' }
      })

      if (userRole) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: userRole.id
          }
        })
      }

      await db.createAuditLog({
        userId: user.id,
        action: 'user_register',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        success: true,
        newData: {
          email: user.email,
          username: user.username
        }
      })

      authLogger.info(
        {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        },
        'User registered successfully'
      )

      const tokens = await this.generateTokenPair(user.id)

      return {
        user: {
          ...user,
          password: undefined,
          verifyToken: undefined
        },
        tokens
      }
    } catch (error) {
      authLogger.error(error, 'Registration failed')
      throw error
    }
  }

  async login(data: any, ipAddress: string, userAgent?: string) {
    try {
      const user = await db.findUserByEmail(data.email)
      if (!user) {
        logSecurity('login_attempt_invalid_email', 'low', {
          email: data.email,
          ip: ipAddress
        })
        throw new Error('Invalid credentials')
      }

      if (!user.isActive) {
        logSecurity('login_attempt_inactive_user', 'medium', {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        })
        throw new Error('Account is deactivated')
      }

      const isValidPassword = await this.verifyPassword(data.password, user.password)
      if (!isValidPassword) {
        logSecurity('login_attempt_invalid_password', 'medium', {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        })
        throw new Error('Invalid credentials')
      }

      // Kill switch: organização suspensa impede o login.
      // Verificado APÓS a senha de propósito — informar o estado da organização
      // antes disso revelaria a existência da conta a quem não tem a credencial.
      // Super Admin é imune (não pertence a nenhuma organização suspensa).
      if (!user.isSuperAdmin && user.organizationId) {
        const org = await prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { isActive: true },
        })
        if (!org?.isActive) {
          logSecurity('login_attempt_suspended_org', 'medium', {
            userId: user.id,
            email: user.email,
            organizationId: user.organizationId,
            ip: ipAddress
          })
          throw new Error('ORGANIZATION_SUSPENDED')
        }
      }

      if (user.twoFactorEnabled) {
        return {
          user: {
            id: user.id,
            email: user.email,
            twoFactorEnabled: true
          },
          tokens: {
            accessToken: '',
            refreshToken: '',
            expiresIn: 0
          },
          requiresTwoFactor: true
        }
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      })

      const tokens = await this.generateTokenPair(user.id, data.rememberMe === true, calcularFingerprint(ipAddress, userAgent))

      await db.createAuditLog({
        userId: user.id,
        action: 'user_login',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        userAgent,
        success: true
      })

      authLogger.info(
        {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        },
        'User logged in successfully'
      )

      return {
        user: {
          ...user,
          password: undefined
        },
        tokens
      }
    } catch (error) {
      authLogger.error(error, 'Login failed')
      throw error
    }
  }

  async refreshTokens(refreshToken: string, ipAddress: string, fingerprint?: string) {
    try {
      await this.verifyRefreshToken(refreshToken)

      const session = await db.findActiveSession(refreshToken)
      if (!session) {
        throw new Error('Invalid or expired refresh token')
      }

      if (!session.user.isActive) {
        throw new Error('Account is deactivated')
      }

      // Fingerprint recalculado a partir da requisição ATUAL: o token novo passa
      // a valer para a rede/dispositivo de agora, não para os do login original.
      const newTokens = await this.generateTokenPair(session.userId, false, fingerprint)

      await prisma.userSession.update({
        where: { id: session.id },
        data: { isActive: false }
      })

      await prisma.userSession.updateMany({
        where: { refreshToken: newTokens.refreshToken },
        data: { lastUsedAt: new Date() }
      })

      authLogger.info(
        {
          userId: session.userId,
          sessionId: session.id,
          ip: ipAddress
        },
        'Tokens refreshed successfully'
      )

      return newTokens
    } catch (error) {
      authLogger.error(error, 'Token refresh failed')
      throw error
    }
  }

  async logout(refreshToken: string, userId: string, ipAddress: string): Promise<void> {
    try {
      await prisma.userSession.updateMany({
        where: {
          refreshToken,
          userId,
          isActive: true
        },
        data: { isActive: false }
      })

      await db.createAuditLog({
        userId,
        action: 'user_logout',
        resource: 'user',
        resourceId: userId,
        ipAddress,
        success: true
      })

      authLogger.info(
        {
          userId,
          ip: ipAddress
        },
        'User logged out successfully'
      )
    } catch (error) {
      authLogger.error(error, 'Logout failed')
      throw error
    }
  }

  async changePassword(
    userId: string,
    data: any,
    ipAddress: string
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      })

      if (!user) {
        throw new Error('User not found')
      }

      const isValidPassword = await this.verifyPassword(data.currentPassword, user.password)
      if (!isValidPassword) {
        logSecurity('password_change_invalid_current', 'medium', {
          userId,
          ip: ipAddress
        })
        throw new Error('Current password is incorrect')
      }

      const hashedPassword = await this.hashPassword(data.newPassword)

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      })

      await prisma.userSession.updateMany({
        where: {
          userId,
          isActive: true
        },
        data: { isActive: false }
      })

      await db.createAuditLog({
        userId,
        action: 'password_changed',
        resource: 'user',
        resourceId: userId,
        ipAddress,
        success: true
      })

      authLogger.info(
        {
          userId,
          ip: ipAddress
        },
        'Password changed successfully'
      )
    } catch (error) {
      authLogger.error(error, 'Password change failed')
      throw error
    }
  }

  async forgotPassword(email: string, ipAddress: string): Promise<void> {
    try {
      const user = await db.findUserByEmail(email)

      if (!user) {
        authLogger.info(
          {
            email,
            ip: ipAddress
          },
          'Password reset requested for non-existent email'
        )
        return
      }

      const resetToken = nanoid(32)
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpires: resetExpires
        }
      })

      await emailService.sendPasswordResetEmail(user.email, resetToken)

      await db.createAuditLog({
        userId: user.id,
        action: 'password_reset_requested',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        success: true
      })

      authLogger.info(
        {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        },
        'Password reset requested'
      )
    } catch (error) {
      authLogger.error(error, 'Password reset request failed')
      throw error
    }
  }

  async resetPassword(token: string, newPassword: string, ipAddress: string): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          passwordResetToken: token,
          passwordResetExpires: {
            gt: new Date()
          }
        }
      })

      if (!user) {
        throw new Error('Invalid or expired reset token')
      }

      const hashedPassword = await this.hashPassword(newPassword)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null
        }
      })

      await prisma.userSession.updateMany({
        where: { userId: user.id },
        data: { isActive: false }
      })

      await db.createAuditLog({
        userId: user.id,
        action: 'password_reset_completed',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        success: true
      })

      authLogger.info(
        {
          userId: user.id,
          ip: ipAddress
        },
        'Password reset completed'
      )
    } catch (error) {
      authLogger.error(error, 'Password reset failed')
      throw error
    }
  }

  async verifyEmail(token: string, ipAddress: string): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: { verifyToken: token }
      })

      if (!user) {
        throw new Error('Invalid verification token')
      }

      if (user.isVerified) {
        throw new Error('Email already verified')
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verifyToken: null
        }
      })

      await db.createAuditLog({
        userId: user.id,
        action: 'email_verified',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        success: true
      })

      authLogger.info(
        {
          userId: user.id,
          email: user.email,
          ip: ipAddress
        },
        'Email verified successfully'
      )
    } catch (error) {
      authLogger.error(error, 'Email verification failed')
      throw error
    }
  }

  async updateProfile(userId: string, data: any, ipAddress: string) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) throw new Error('User not found')

      // Check username uniqueness if changing
      if (data.username && data.username !== user.username) {
        const existing = await prisma.user.findUnique({ where: { username: data.username } })
        if (existing) throw new Error('Username already taken')
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          username: data.username,
          jobTitle: data.jobTitle,
          avatar: data.avatar,
          preferences: data.preferences ? { ...((user.preferences as object) || {}), ...data.preferences } : undefined
        }
      })

      await db.createAuditLog({
        userId,
        action: 'user_profile_updated',
        resource: 'user',
        resourceId: userId,
        ipAddress,
        success: true,
        newData: data
      })

      return updatedUser
    } catch (error) {
      authLogger.error(error, 'Profile update failed')
      throw error
    }
  }
}

export const authService = new AuthService()