import { authRoutes } from '@/routes/auth.routes.js'
import { userRoutes } from '@/routes/user.routes.js'
import { roleRoutes } from '@/routes/role.routes.js'
import { workspaceRoutes } from '@/routes/workspace.routes.js'
import { taskRoutes } from '@/routes/task.routes.js'
import { notificationRoutes } from '@/routes/notification.routes.js'
import { communicationRoutes } from '@/routes/communication.routes.js'
import { settingsRoutes } from '@/routes/settings.routes.js'
import { auditoriaRoutes } from '@/routes/auditoria.routes.js'
import { financeRoutes } from '@/routes/finance.routes.js'
import { calendarRoutes } from '@/routes/calendar.routes.js'
import { notesRoutes } from '@/routes/notes.routes.js'
import { organizationRoutes } from '@/routes/organization.routes.js'
import { adminRoutes } from '@/routes/admin.routes.js'

import { AppServer } from '@/types/server'
import { db } from '@/utils/database.js'
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { virtualProcessRoutes } from '@/routes/virtual-process.routes.js'
import { covenantRoutes } from '@/routes/covenant.routes.js'
import { protocolRoutes } from '@/routes/protocol.routes.js'
import { departmentRoutes } from '@/routes/department.routes.js'
import { councilPublicRoutes, councilRoutes } from '@/routes/council.routes.js'
import { supportRoutes } from '@/routes/support.routes.js'
import { errorHandler } from '@/utils/error-handler.js'
import { safeFetch } from '@/utils/url-security.js'
import { honeypotGuard, registerHoneypotRoutes } from '@/middleware/honeypot.middleware.js'

import { publicRoutes } from '@/routes/public.routes.js'

export async function registerRoutes(server: AppServer) {
  // --- HONEYPOT ---
  // Hook global PRIMEIRO: um IP banido é cortado antes de qualquer rota, plugin
  // de autenticação ou consulta ao banco.
  server.addHook('onRequest', honeypotGuard)

  // Rotas-isca antes do notFoundHandler, senão virariam 404 comum.
  registerHoneypotRoutes(server)

  // --- ROTAS PÚBLICAS ---
  await server.register(publicRoutes, { prefix: '/public', logLevel: 'info' })

  // --- ERROR HANDLER GLOBAL ---
  server.setErrorHandler(errorHandler)

  // --- NOT FOUND HANDLER ---
  server.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: 'Not Found',
      message: `Endpoint ${request.method}:${request.url} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
      requestId: request.id,
      suggestion: 'Check the API documentation at /documentation'
    })
  })

  // --- SENTRY TUNNEL ---
  // Recebe envelopes do frontend e repassa para o Sentry.
  // Necessário para contornar ad blockers que bloqueiam *.sentry.io diretamente.
  server.addContentTypeParser('application/x-sentry-envelope', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body)
  })

  server.post('/api/sentry-tunnel', async (request, reply) => {
    try {
      const envelope = request.body as string
      const firstLine = envelope.split('\n')[0]
      const header = JSON.parse(firstLine) as { dsn?: string }

      if (!header.dsn) {
        return reply.code(400).send({ error: 'Missing DSN' })
      }

      // SSRF: a URL de destino é derivada EXCLUSIVAMENTE do DSN configurado no
      // servidor (variável de ambiente). O DSN que vem no corpo da requisição é
      // usado apenas para CONFERIR se bate com o do servidor — nunca para montar
      // o destino do fetch. Assim o tunnel não pode ser usado como proxy genérico,
      // mesmo que host e projectId do cliente sejam manipulados.
      const serverDsnRaw = config.observability.sentryDsn
      if (!serverDsnRaw) {
        return reply.code(503).send({ error: 'Sentry tunnel not configured' })
      }

      const serverDsn = new URL(serverDsnRaw)
      const projectId = serverDsn.pathname.replace(/^\//, '')

      // Defesa em profundidade: host do próprio DSN do servidor precisa ser Sentry
      // e o projectId precisa ser numérico (formato do Sentry).
      if (!serverDsn.hostname.endsWith('.sentry.io') || !/^\d+$/.test(projectId)) {
        return reply.code(503).send({ error: 'Sentry tunnel misconfigured' })
      }

      // O envelope só é encaminhado se o cliente declarou o mesmo projeto do servidor.
      const clientDsn = new URL(header.dsn)
      if (clientDsn.hostname !== serverDsn.hostname
        || clientDsn.pathname.replace(/^\//, '') !== projectId) {
        return reply.code(400).send({ error: 'DSN mismatch' })
      }

      const sentryUrl = `https://${serverDsn.hostname}/api/${projectId}/envelope/`

      // safeFetch em vez de fetch cru: o destino já é derivado apenas do DSN do
      // servidor, mas isto impede que um DSN mal configurado apontando para a rede
      // interna transforme o tunnel num proxy — e bloqueia seguir 30x para host interno.
      const response = await safeFetch(sentryUrl, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'application/x-sentry-envelope' }
      }, { maxRedirects: 0, timeoutMs: 5000 })

      return reply.code(response.status).send()
    } catch (err) {
      request.log.error(err, 'Sentry tunnel error')
      return reply.code(500).send({ error: 'Tunnel error' })
    }
  })

  // --- HEALTH CHECK ---
  server.get('/health', async () => {
    const dbHealth = await db.isHealthy()
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      database: dbHealth
    }
  })

  // --- API V1 ROUTES (Auth, User, Role) ---
  await server.register(
    async server => {
      await server.register(authRoutes, { prefix: '/auth', logLevel: 'info' })
      await server.register(organizationRoutes, { prefix: '/organizations', logLevel: 'info' })
      await server.register(userRoutes, { prefix: '/users', logLevel: 'info' })
      await server.register(roleRoutes, { prefix: '/roles', logLevel: 'info' })

      // Módulo de Comunicação
      await server.register(adminRoutes, { prefix: '/admin', logLevel: 'info' })

      // Módulo de Comunicação
      await server.register(communicationRoutes, { prefix: '/communication', logLevel: 'info' })

      // Módulo de Configurações
      await server.register(settingsRoutes, { prefix: '/settings', logLevel: 'info' })

      // Painel de Auditoria (trilha imutável — somente leitura)
      await server.register(auditoriaRoutes, { prefix: '/auditoria', logLevel: 'info' })

      // Módulo de Utilidades
      await server.register(calendarRoutes, { prefix: '/utilities/calendar', logLevel: 'info' })
      await server.register(notesRoutes, { prefix: '/utilities/notes', logLevel: 'info' })

      server.get('/', { /* schema omitido */ }, async (request, reply) => {
        return reply.send({ message: "API V1 Root" })
      })
    },
    { prefix: '/api/v1' }
  )

  // --- ROTAS PRINCIPAIS (ROOT LEVEL) ---
  await server.register(workspaceRoutes, { prefix: '/workspaces', logLevel: 'info' })
  await server.register(taskRoutes, { prefix: '/tasks', logLevel: 'info' })
  await server.register(notificationRoutes, { prefix: '/notifications', logLevel: 'info' })

  // Módulo Financeiro
  await server.register(financeRoutes, { prefix: '/finance', logLevel: 'info' })
  await server.register(virtualProcessRoutes, { prefix: '/virtual-processes', logLevel: 'info' })
  await server.register(covenantRoutes, { prefix: '/covenants', logLevel: 'info' })
  await server.register(protocolRoutes, { prefix: '/protocols', logLevel: 'info' })
  await server.register(departmentRoutes, { prefix: '/departments', logLevel: 'info' })
  await server.register(councilRoutes, { prefix: '/councils', logLevel: 'info' })
  await server.register(councilPublicRoutes, { prefix: '/councils', logLevel: 'info' })
  await server.register(supportRoutes, { prefix: '/support', logLevel: 'info' })

  // --- TEST ENDPOINT ---
  server.get('/test', (request, reply) => {
    logger.info('Test endpoint hit')
    return reply.send({ message: 'Test endpoint working', timestamp: new Date().toISOString() })
  })

  server.ready(() => {
    logger.info('All routes registered successfully')
    logger.info('✅ Workspaces mounted at /workspaces')
    logger.info('✅ Tasks mounted at /tasks')
    logger.info('✅ Notifications mounted at /notifications')
    logger.info('✅ Communication mounted at /api/v1/communication')
    logger.info('✅ Finance mounted at /finance')
  })
}

export const routeSummary = {
  '/api/v1/auth': { description: 'Authentication routes' },
  '/api/v1/users': { description: 'User management' },
  '/api/v1/roles': { description: 'RBAC management' },
  '/api/v1/communication': { description: 'Protocolo e Comunicação' },
  '/finance': { description: 'Módulo de Gestão Financeira' },
  '/virtual-processes': { description: 'Módulo de Processos Virtuais' },
  '/workspaces': {
    description: 'Workspace management',
    endpoints: ['GET /', 'POST /', 'GET /:id', 'POST /:id/members', 'GET /:id/assignable-users']
  },
  '/tasks': {
    description: 'Task management',
    endpoints: ['GET /:id (Details)', 'PUT /:id', 'POST /:id/checklist', 'POST /:id/assignees']
  },
  '/notifications': {
    description: 'Real-time notifications',
    endpoints: ['GET /', 'GET /stream', 'PATCH /:id/read']
  }
}