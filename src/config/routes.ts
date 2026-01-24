import { authRoutes } from '@/routes/auth.routes.js'
import { userRoutes } from '@/routes/user.routes.js'
import { roleRoutes } from '@/routes/role.routes.js'
import { AppServer } from '@/types/server'
import { db } from '@/utils/database.js'
import { logger } from '@/utils/logger.js'

export async function registerRoutes(server: AppServer) {
  server.setErrorHandler(async (error, request, reply) => {
    request.log.error(error, 'Request error occurred')

    // Cast para 'any' para evitar erros de 'unknown' no build
    const err = error as any;

    // Handle validation errors
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

    // Handle authentication errors
    if (err.statusCode === 401) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: err.message || 'Authentication required',
        statusCode: 401,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    // Handle authorization errors
    if (err.statusCode === 403) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: err.message || 'Insufficient permissions',
        statusCode: 403,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    // Handle not found errors
    if (err.statusCode === 404) {
      return reply.code(404).send({
        error: 'Not Found',
        message: err.message || 'Resource not found',
        statusCode: 404,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    // Handle rate limiting errors
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

    // Handle other client errors (4xx)
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: err.name || 'Bad Request',
        message: err.message,
        statusCode: err.statusCode,
        timestamp: new Date().toISOString(),
        requestId: request.id
      })
    }

    // Handle server errors (5xx)
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

  // 404 handler
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

  // Health check endpoint
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

  // api/v1 routes
  await server.register(
    async server => {
      await server.register(authRoutes, {
        prefix: '/auth',
        logLevel: 'info'
      })

      await server.register(userRoutes, {
        prefix: '/users',
        logLevel: 'info'
      })

      await server.register(roleRoutes, {
        prefix: '/roles',
        logLevel: 'info'
      })

      server.get(
        '/',
        {
          schema: {
            description: 'API Information',
            tags: ['General'],
            response: {
              200: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  description: { type: 'string' },
                  endpoints: {
                    type: 'object',
                    properties: {
                      auth: { type: 'string' },
                      users: { type: 'string' },
                      roles: { type: 'string' },
                      admin: { type: 'string' },
                      documentation: { type: 'string' },
                      health: { type: 'string' }
                    }
                  },
                  features: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        async (request, reply) => {
          const response = {
            name: 'Fastify Auth API',
            version: '1.0.0',
            description: 'Modern authentication API with RBAC and comprehensive user management',
            endpoints: {
              auth: '/api/v1/auth',
              users: '/api/v1/users',
              roles: '/api/v1/roles',
              admin: '/api/v1/admin',
              documentation: '/documentation',
              health: '/health'
            },
            features: [
              'JWT Authentication with Refresh Tokens',
              'Two-Factor Authentication (TOTP)',
              'Role-Based Access Control (RBAC)',
              'Email Verification',
              'Password Reset',
              'Session Management',
              'Audit Logging',
              'Rate Limiting',
              'Real-time Security Monitoring',
              'Comprehensive Admin Dashboard'
            ]
          }

          return reply.send(response)
        }
      )
    },
    { prefix: '/api/v1' }
  )

  server.get('/test', async (request, reply) => {
    logger.info('Test endpoint hit')
    return reply.send({ message: 'Test endpoint working', timestamp: new Date().toISOString() })
  })

  server.ready(() => {
    logger.info('All routes registered successfully')
  })
}

// Route summary
export const routeSummary = {
  '/api/v1/auth': {
    description: 'Authentication and user profile management',
    endpoints: [
      'POST /register', 'POST /login', 'POST /verify-2fa', 'POST /refresh', 
      'POST /logout', 'GET /me', 'PUT /profile', 'POST /change-password'
    ]
  },
  '/api/v1/users': {
    description: 'User management (Admin/Moderator access required)',
    endpoints: ['GET /', 'GET /:id', 'POST /', 'PUT /:id', 'DELETE /:id']
  },
  '/api/v1/roles': {
    description: 'Role and permission management (Admin access required)',
    endpoints: ['GET /', 'GET /:id', 'POST /', 'PUT /:id', 'DELETE /:id']
  }
}