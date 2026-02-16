import { authRoutes } from '@/routes/auth.routes.js'
import { userRoutes } from '@/routes/user.routes.js'
import { roleRoutes } from '@/routes/role.routes.js'
import { workspaceRoutes } from '@/routes/workspace.routes.js'
import { taskRoutes } from '@/routes/task.routes.js'
import { notificationRoutes } from '@/routes/notification.routes.js'
import { communicationRoutes } from '@/routes/communication.routes.js'
import { settingsRoutes } from '@/routes/settings.routes.js'

import { AppServer } from '@/types/server'
import { db } from '@/utils/database.js'
import { logger } from '@/utils/logger.js'

import { publicRoutes } from '@/routes/public.routes.js'

export async function registerRoutes(server: AppServer) {
  // ... existing error handler ...

  // --- ROTAS PÚBLICAS ---
  await server.register(publicRoutes, { prefix: '/public', logLevel: 'info' })

  // --- API V1 ROUTES (Auth, User, Role) ---
  // --- ERROR HANDLER GLOBAL ---
  server.setErrorHandler(async (error, request, reply) => {
    request.log.error(error, 'Request error occurred')

    const err = error as any;

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
  server.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: 'Not Found',
      message: `Endpoint ${request.method}:${request.url} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
      requestId: request.id,
      suggestion: 'Check the API documentation at /documentation'
    })
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

      // Módulo de Comunicação
      await server.register(communicationRoutes, { prefix: '/communication', logLevel: 'info' })

      // Módulo de Configurações
      await server.register(settingsRoutes, { prefix: '/settings', logLevel: 'info' })

      server.get('/', { /* schema omitido */ }, async (request, reply) => {
        return reply.send({ message: "API V1 Root" })
      })
    },
    { prefix: '/api/v1' }
  )

  // --- ROTAS PRINCIPAIS (ROOT LEVEL) ---

  await server.register(workspaceRoutes, {
    prefix: '/workspaces',
    logLevel: 'info'
  })

  await server.register(taskRoutes, {
    prefix: '/tasks',
    logLevel: 'info'
  })

  await server.register(notificationRoutes, {
    prefix: '/notifications',
    logLevel: 'info'
  })

  // --- TEST ENDPOINT ---
  server.get('/test', async (request, reply) => {
    logger.info('Test endpoint hit')
    return reply.send({ message: 'Test endpoint working', timestamp: new Date().toISOString() })
  })

  server.ready(() => {
    logger.info('All routes registered successfully')
    logger.info('✅ Workspaces mounted at /workspaces')
    logger.info('✅ Tasks mounted at /tasks')
    logger.info('✅ Notifications mounted at /notifications')
    logger.info('✅ Communication mounted at /api/v1/communication')
  })
}

export const routeSummary = {
  '/api/v1/auth': { description: 'Authentication routes' },
  '/api/v1/users': { description: 'User management' },
  '/api/v1/roles': { description: 'RBAC management' },
  '/api/v1/communication': { description: 'Protocolo e Comunicação' },
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