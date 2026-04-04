import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { authService } from '@/services/auth.service.js'
import { db } from '@/utils/database.js'
import { authLogger } from '@/utils/logger.js'
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from '@/schemas/auth.schemas.js'

function zodErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map(i => i.message).join('. ')
  }
  return error instanceof Error ? error.message : String(error)
}

export class AuthController {
  // ... register, login, refreshToken, logout (mantidos igual) ...

  async register(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = registerSchema.parse(request.body)
      const ipAddress = request.ip
      const result = await authService.register(data, ipAddress)
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
      })
      return reply.code(201).send({ message: 'User registered successfully', user: result.user, tokens: { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn } })
    } catch (error: unknown) {
      authLogger.error(error, 'Registration failed')
      return reply.code(400).send({ error: 'Registration Failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = loginSchema.parse(request.body)
      const ipAddress = request.ip
      const userAgent = request.headers['user-agent']
      const result = await authService.login(data, ipAddress, userAgent)
      if (result.requiresTwoFactor) {
        return reply.send({ message: 'Two-factor authentication required', requiresTwoFactor: true, tempUserId: result.user.id })
      }
      const cookieDays = data.rememberMe ? 30 : 7
      reply.setCookie('refreshToken', result.tokens.refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: cookieDays * 24 * 60 * 60 * 1000
      })
      return reply.send({ message: 'Login successful', user: result.user, tokens: { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn } })
    } catch (error: unknown) {
      return reply.code(400).send({ error: 'Login Failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async refreshToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const refreshToken = request.cookies.refreshToken || refreshTokenSchema.parse(request.body).refreshToken
      if (!refreshToken) return reply.code(400).send({ error: 'Missing Token', message: 'Refresh token is required' })
      const tokens = await authService.refreshTokens(refreshToken, request.ip)
      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
      })
      return reply.send({ message: 'Token refreshed successfully', tokens: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } })
    } catch (error: unknown) {
      return reply.code(401).send({ error: 'Token Refresh Failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    try {
      const refreshToken = request.cookies.refreshToken
      const userId = (request as any).user?.id
      if (refreshToken && userId) await authService.logout(refreshToken, userId, request.ip)
      reply.clearCookie('refreshToken')
      return reply.send({ message: 'Logged out successfully' })
    } catch (error: unknown) {
      return reply.code(400).send({ error: 'Logout Failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // --- ROTA USADA PELO USEAUTH (/me) ---
  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const req = request as any
      if (!req.user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Authentication required'
        })
      }

      const user = await db.findUserById(req.user.id)
      if (!user) {
        return reply.code(404).send({
          error: 'User Not Found',
          message: 'User profile not found'
        })
      }

      // IMPORTANTE: Retorna { user: ... }
      return reply.send({
        user: {
          ...user,
          password: undefined,
          twoFactorSecret: undefined,
          verifyToken: undefined,
          passwordResetToken: undefined
        }
      })
    } catch (error: unknown) {
      return reply.code(500).send({
        error: 'Profile Fetch Failed',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // ... (outros métodos: updateProfile, changePassword, etc. mantidos) ...
  async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user.id
      const data = updateProfileSchema.parse(request.body)

      const updatedUser = await authService.updateProfile(userId, data, request.ip)

      return reply.send({
        message: 'Profile updated successfully',
        user: {
          ...updatedUser,
          password: undefined,
          twoFactorSecret: undefined,
          verifyToken: undefined,
          passwordResetToken: undefined
        }
      })
    } catch (error: any) {
      return reply.code(400).send({
        error: 'Profile Update Failed',
        message: error.message
      })
    }
  }
  async changePassword(request: FastifyRequest, reply: FastifyReply) { /* ... */ }

  async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { email } = forgotPasswordSchema.parse(request.body)
      await authService.forgotPassword(email, request.ip)
      // Sempre retorna 200 para não vazar se o e-mail existe
      return reply.send({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' })
    } catch (error: unknown) {
      authLogger.error(error, 'Forgot password failed')
      return reply.code(400).send({ error: 'Request Failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { token, password } = resetPasswordSchema.parse(request.body)
      await authService.resetPassword(token, password, request.ip)
      return reply.send({ message: 'Senha redefinida com sucesso.' })
    } catch (error: unknown) {
      authLogger.error(error, 'Reset password failed')
      return reply.code(400).send({ error: 'Reset Failed', message: zodErrorMessage(error) })
    }
  }
  async verifyEmail(request: FastifyRequest, reply: FastifyReply) { /* ... */ }
  async getSessions(request: FastifyRequest, reply: FastifyReply) { /* ... */ }
  async terminateSession(request: FastifyRequest, reply: FastifyReply) { /* ... */ }
  async terminateAllSessions(request: FastifyRequest, reply: FastifyReply) { /* ... */ }
}

export const authController = new AuthController()