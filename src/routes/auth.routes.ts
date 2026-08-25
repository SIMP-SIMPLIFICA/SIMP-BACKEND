import { FastifyInstance, FastifyRequest } from 'fastify'
import { authController } from '../controllers/auth.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { config } from '../config/config.js'
import { turnstileMiddleware } from '../middleware/turnstile.middleware.js'
import { honeypotFieldGuard } from '../middleware/honeypot.middleware.js'

/**
 * Limite por IP para uma rota sensível. Vai em `config.rateLimit`, consumido pelo
 * @fastify/rate-limit global.
 */
function ipLimit(max: number, timeWindow: string = config.rateLimit.authWindow) {
  return { rateLimit: { max, timeWindow } }
}

/**
 * Limite por CONTA, complementar ao limite por IP.
 *
 * O limite por IP sozinho não detém credential stuffing: o atacante distribui as
 * tentativas por centenas de IPs (botnet, proxies residenciais) e cada um fica
 * confortavelmente abaixo de 5/minuto, enquanto a mesma conta recebe milhares de
 * tentativas. Chavear pelo e-mail alvo fecha essa dimensão — independentemente de
 * quantos IPs o atacante controle, uma conta específica só aceita N tentativas por
 * janela.
 *
 * O e-mail é normalizado (trim + lowercase) para que "Admin@x.com " e "admin@x.com"
 * não sejam contados como alvos diferentes.
 */
function accountLimit(app: FastifyInstance, max: number) {
  // O @fastify/rate-limit não é registrado em modo de teste (ver plugins.ts), então
  // `app.rateLimit` não existe lá. Devolver [] mantém as rotas montáveis nos testes
  // sem espalhar `if (isTest)` por cada uma.
  if (typeof app.rateLimit !== 'function') return []

  return [app.rateLimit({
    max,
    timeWindow: config.rateLimit.authWindow,
    keyGenerator: (request: FastifyRequest) => {
      const body = request.body as { email?: unknown } | undefined
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

      // Sem e-mail no corpo não há conta para proteger; cai no IP para não criar
      // uma chave única compartilhada que limitaria todos os usuários juntos.
      return email ? `account:${email}` : `account-ip:${request.ip}`
    },
  })]
}

export function authRoutes(app: FastifyInstance) {
  const { authMax } = config.rateLimit

  // --- Rotas Públicas ---

  // Registro: sem limite antes desta mudança. Um script podia criar contas em
  // massa, inflando o banco e disparando envio de e-mails de verificação.
  app.post('/register', {
    config: ipLimit(authMax),
    preHandler: turnstileMiddleware,
  }, authController.register)

  // Turnstile roda DEPOIS do rate limit: verificar o token custa uma chamada de
  // rede à Cloudflare, e não queremos pagar esse custo para tráfego que já seria
  // recusado por excesso de requisições.
  app.post('/login', {
    config: ipLimit(authMax),
    preHandler: [honeypotFieldGuard, ...accountLimit(app, authMax * 2), turnstileMiddleware],
  }, authController.login)

  // Refresh token: sem limite antes. É um oráculo de validade de token — permitia
  // testar tokens roubados/forjados sem qualquer freio.
  app.post('/refresh-token', { config: ipLimit(20) }, authController.refreshToken)

  app.post('/logout', authController.logout)

  // Recuperação de Senha e Verificação
  app.post('/forgot-password', {
    config: ipLimit(3),
    // Também por conta: senão um atacante inunda a caixa de entrada de uma vítima
    // específica alternando de IP.
    preHandler: [...accountLimit(app, 3), turnstileMiddleware],
  }, authController.forgotPassword)

  app.post('/reset-password', {
    config: ipLimit(3),
    preHandler: turnstileMiddleware,
  }, authController.resetPassword)

  // Verificação de e-mail: sem limite antes. O token é adivinhável por força bruta
  // se não houver freio nenhum.
  app.post('/verify-email', { config: ipLimit(10) }, authController.verifyEmail)

  // --- Rotas Protegidas (Requer Login) ---
  // Perfil do Usuário
  app.get('/me', { preHandler: authenticate }, authController.getProfile)
  app.put('/profile', { preHandler: authenticate }, authController.updateProfile)

  // Troca de senha exige a senha atual — é um alvo de brute force como o login.
  app.post('/change-password', {
    preHandler: authenticate,
    config: ipLimit(10),
  }, authController.changePassword)

  // Gerenciamento de Sessões
  app.get('/sessions', { preHandler: authenticate }, authController.getSessions)
  app.delete('/sessions/:sessionId', { preHandler: authenticate }, authController.terminateSession)
  app.delete('/sessions', { preHandler: authenticate }, authController.terminateAllSessions)
}
