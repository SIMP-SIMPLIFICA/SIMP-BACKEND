import { authRoutes } from '@/routes/auth.routes.js'
import { userRoutes } from '@/routes/user.routes.js'
import { roleRoutes } from '@/routes/role.routes.js'
import { workspaceRoutes } from '@/routes/workspace.routes.js'
import { taskRoutes } from '@/routes/task.routes.js'
import { notificationRoutes } from '@/routes/notification.routes.js'
import { communicationRoutes } from '@/routes/communication.routes.js'
import { settingsRoutes } from '@/routes/settings.routes.js'
import { financeRoutes } from '@/routes/finance.routes.js'
import { calendarRoutes } from '@/routes/calendar.routes.js'
import { notesRoutes } from '@/routes/notes.routes.js'
import { organizationRoutes } from '@/routes/organization.routes.js'
import { adminRoutes } from '@/routes/admin.routes.js'

import { AppServer } from '@/types/server'
import { db } from '@/utils/database.js'
import { logger } from '@/utils/logger.js'
import { virtualProcessRoutes } from '@/routes/virtual-process.routes.js'
import { covenantRoutes } from '@/routes/covenant.routes.js'
import { protocolRoutes } from '@/routes/protocol.routes.js'
import { errorHandler } from '@/utils/error-handler.js'

import { publicRoutes } from '@/routes/public.routes.js'

export async function registerRoutes(server: AppServer) {
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

      const dsn = new URL(header.dsn)
      const projectId = dsn.pathname.replace('/', '')

      // Só aceita o host legítimo do Sentry — evita abuso do tunnel como proxy genérico
      if (!dsn.hostname.endsWith('.sentry.io')) {
        return reply.code(400).send({ error: 'Invalid DSN host' })
      }

      const sentryUrl = `https://${dsn.hostname}/api/${projectId}/envelope/`

      const response = await fetch(sentryUrl, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'application/x-sentry-envelope' }
      })

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