import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import sensible from '@fastify/sensible'
import underPressure from '@fastify/under-pressure'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'

import { config } from './config.js'
import { Sentry } from './sentry.js'
import { AppServer } from '@/types/server.js'
import { db } from '@/utils/database.js'

export async function registerPlugins(server: AppServer) {
  await server.register(helmet, { contentSecurityPolicy: false })

  await server.register(cors, {
    origin: config.server.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })

  await server.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    keyGenerator: request => `rate_limit:${request.ip}`,
    errorResponseBuilder: (request, context) => ({
      error: 'Too Many Requests',
      message: `Tente novamente em ${Math.round(context.ttl / 1000)} segundos`,
      statusCode: 429
    })
  })

  await server.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 1000000000,
    maxRssBytes: 1000000000,
    maxEventLoopUtilization: 0.98,
    retryAfter: 50,
    healthCheck: async () => {
      try { await db.isHealthy(); return true } catch { return false }
    },
    healthCheckInterval: 5000,
    exposeStatusRoute: '/status'
  })

  await server.register(jwt, {
    secret: {
      private: config.jwt.accessSecret,
      public: config.jwt.accessSecret
    },
    sign: { expiresIn: config.jwt.accessExpiresIn },
    cookie: { cookieName: 'token', signed: false }
  })

  await server.register(cookie, {
    secret: config.security.sessionSecret,
    parseOptions: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? 'strict' : 'lax'
    }
  })

  await server.register(sensible)
  await server.register(formbody)

  // --- ARQUIVOS ---
  await server.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }
  })

  await server.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/', 
    decorateReply: false
  })

  if (config.features.swagger && config.isDevelopment) {
    await server.register(swagger, {
      openapi: {
        openapi: '3.0.0',
        info: { title: 'SIMP API', description: 'API Documentation', version: '1.0.0' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
        security: [{ bearerAuth: [] }]
      }
    })
    await server.register(swaggerUi, {
      routePrefix: '/documentation',
      staticCSP: true,
      transformStaticCSP: header => header
    })
  }

  if (config.logging.enableRequestLogging) {
    // eslint-disable-next-line @typescript-eslint/require-await
    server.addHook('onRequest', async (request) => {
      request.log.info({ method: request.method, url: request.url }, 'Incoming request')
    })
  }

  if (config.observability.sentryDsn) {
    Sentry.setupFastifyErrorHandler(server)
  }
}