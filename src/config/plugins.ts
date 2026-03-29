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
import { jsonSchemaTransform, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'

import { config } from './config.js'
import { Sentry } from './sentry.js'
import { AppServer } from '@/types/server.js'
import { db } from '@/utils/database.js'

export async function registerPlugins(server: AppServer) {
  // Set global validator and serializer compilers for Zod
  server.setValidatorCompiler(validatorCompiler)
  server.setSerializerCompiler(serializerCompiler)

  await server.register(helmet, {
    contentSecurityPolicy: config.isProduction,
    crossOriginEmbedderPolicy: config.isProduction,
    crossOriginOpenerPolicy: config.isProduction,
    crossOriginResourcePolicy: config.isProduction,
    dnsPrefetchControl: true,
    frameguard: { action: 'deny' },
    hsts: config.isProduction,
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'no-referrer' },
    xssFilter: true
  })

  await server.register(cors, {
    origin: (origin, cb) => {
      // In development, allow no origin (like Postman) or local origins
      if (!config.isProduction) {
        cb(null, true)
        return
      }

      // In production, strictly check against allowed origins
      if (!origin || config.server.corsOrigins.includes(origin)) {
        cb(null, true)
        return
      }

      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-request-id'],
    exposedHeaders: ['set-cookie']
  })

  if (!config.isTest) {
    await server.register(rateLimit, {
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.timeWindow,
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true
      },
      keyGenerator: request => {
        return request.headers['x-real-ip'] as string ||
          request.headers['x-forwarded-for'] as string ||
          request.ip
      },
      errorResponseBuilder: (request, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Muitas requisições. Tente novamente em ${Math.round(context.ttl / 1000)} segundos.`,
        requestId: request.id
      })
    })
  }

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
    sign: {
      expiresIn: '15m', // Tempo curto conforme protocolo (Segurança Militar)
      algorithm: 'HS256'
    },
    cookie: {
      cookieName: 'refreshToken',
      signed: false
    }
  })

  await server.register(cookie, {
    secret: config.security.sessionSecret,
    parseOptions: {
      httpOnly: true,
      secure: config.isProduction, // True apenas em produção (HTTPS)
      sameSite: 'strict', // Blindagem contra CSRF
      path: '/'
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
      },
      transform: (params) => {
        try {
          return jsonSchemaTransform(params)
        } catch (error) {
          // Se falhar (ex: schema JSON puro que o Zod transform não entende), retorna o schema original
          // Isso corrige o erro "Cannot read properties of undefined (reading 'parent')"
          return { schema: params.schema, url: params.url }
        }
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
