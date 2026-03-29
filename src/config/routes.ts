import { authRoutes } from '@/routes/auth.routes.js'
import { userRoutes } from '@/routes/user.routes.js'
import { roleRoutes } from '@/routes/role.routes.js'
import { workspaceRoutes } from '@/routes/workspace.routes.js'
import { taskRoutes } from '@/routes/task.routes.js'
import { notificationRoutes } from '@/routes/notification.routes.js' // Rota de notificações adicionada
import { financeRoutes } from '@/routes/finance.routes.js'

import { AppServer } from '@/types/server'
import { db } from '@/utils/database.js'
import { logger } from '@/utils/logger.js'

export async function registerRoutes(server: AppServer) {
  // --- ERROR HANDLER GLOBAL ---
  // eslint-disable-next-line @typescript-eslint/require-await
  server.setErrorHandler(async (error, request, reply) => {
    request.log.error(error, 'Request error occurred')

    const err = error as { validation?: unknown; statusCode?: number; message?: string; name?: string; stack?: string; retryAfter?: number };

    if (err.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: 'Request validation failed',
        details: err.validation,
        statusCode: 400,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    if (err.statusCode === 401) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: err.message || 'Authentication required',
        statusCode: 401,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    if (err.statusCode === 403) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: err.message || 'Insufficient permissions',
        statusCode: 403,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    if (err.statusCode === 404) {
      return reply.code(404).send({
        error: 'Not Found',
        message: err.message || 'Resource not found',
        statusCode: 404,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    if (err.statusCode === 429) {
      const retryAfter = 'retryAfter' in err ? err.retryAfter : 60
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: err.message || 'Rate limit exceeded',
        statusCode: 429,
        timestamp: new Date().toISOString(),
        requestId: request.id,
        retryAfter: retryAfter
      })
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: err.name || 'Bad Request',
        message: err.message,
        statusCode: err.statusCode,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    const statusCode = err?.statusCode && err.statusCode >= 500 ? err.statusCode : 500

    return reply.code(statusCode).send({
      error: 'Internal Server Error',
      message:
        process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
      statusCode,
      timestamp: new Date().toISOString(),
      requestId: request.id,
      ...(process.env.NODE_ENV !== 'production' && {
        stack: err.stack
      })
    })
  })

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
      await server.register(userRoutes, { prefix: '/users', logLevel: 'info' })
      await server.register(roleRoutes, { prefix: '/roles', logLevel: 'info' })

      server.get('/', { /* schema omitido */ }, (request, reply) => {
        return reply.send({ message: "API V1 Root" })
      })
    },
    { prefix: '/api/v1' }
  )

  // --- ROTAS PRINCIPAIS (ROOT LEVEL) ---

  // 1. Workspaces (Gera /workspaces/...)
  await server.register(workspaceRoutes, {
    prefix: '/workspaces',
    logLevel: 'info'
  })

  // 2. Tasks (Gera /tasks/...)
  // Importante: O prefixo é necessário para que a rota GET /tasks/:id funcione corretamente
  await server.register(taskRoutes, {
    prefix: '/tasks',
    logLevel: 'info'
  })

  // 3. Notifications (Gera /notifications/...)
  await server.register(notificationRoutes, {
    prefix: '/notifications',
    logLevel: 'info'
  })

  // 4. Finance (Gera /finance/...)
  await server.register(financeRoutes, {
    prefix: '/finance',
    logLevel: 'info'
  })

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
  })
}

// Route summary para documentação/debug
export const routeSummary = {
  '/api/v1/auth': { description: 'Authentication routes' },
  '/api/v1/users': { description: 'User management' },
  '/api/v1/roles': { description: 'RBAC management' },
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