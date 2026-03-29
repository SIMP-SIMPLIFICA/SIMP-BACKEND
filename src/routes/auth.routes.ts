import { FastifyInstance } from 'fastify'
import { authController } from '../controllers/auth.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'

export function authRoutes(app: FastifyInstance) {
  // --- Rotas Públicas ---
  app.post('/register', authController.register)

  app.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, authController.login)

  app.post('/refresh-token', authController.refreshToken)
  app.post('/logout', authController.logout)

  // Recuperação de Senha e Verificação
  app.post('/forgot-password', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute'
      }
    }
  }, authController.forgotPassword)

  app.post('/reset-password', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute'
      }
    }
  }, authController.resetPassword)

  app.post('/verify-email', authController.verifyEmail)

  // --- Rotas Protegidas (Requer Login) ---
  // Perfil do Usuário
  app.get('/me', { preHandler: authenticate }, authController.getProfile)
  app.put('/profile', { preHandler: authenticate }, authController.updateProfile)
  app.post('/change-password', { preHandler: authenticate }, authController.changePassword)

  // Gerenciamento de Sessões
  app.get('/sessions', { preHandler: authenticate }, authController.getSessions)
  app.delete('/sessions/:sessionId', { preHandler: authenticate }, authController.terminateSession)
  app.delete('/sessions', { preHandler: authenticate }, authController.terminateAllSessions)
}