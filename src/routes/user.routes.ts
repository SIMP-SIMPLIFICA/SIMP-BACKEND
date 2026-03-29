import type { FastifyInstance } from 'fastify'
import { z } from 'zod' // Importando Zod
import { userController } from '@/controllers/user.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'

export async function userRoutes(server: FastifyInstance) {

  // Get list of users
  server.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get paginated list of users',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          search: z.string().optional(),
          isActive: z.coerce.boolean().optional(),
          isVerified: z.coerce.boolean().optional(),
          role: z.string().optional(),
          sortBy: z.enum(['createdAt', 'email', 'firstName', 'lastName']).optional(),
          sortOrder: z.enum(['asc', 'desc']).default('desc')
        })
      }
    },
    userController.getUsers.bind(userController)
  )

  // --- Rota de Certificado Digital ---
  server.post(
    '/me/certificate',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Generate a self-signed digital certificate (PFX) for the current user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        body: z.object({}).optional() // Body vazio mas definido como Zod
      }
    },
    userController.generateCertificate.bind(userController)
  )

  // --- Rota de Upload de Logo Institucional ---
  server.post(
    '/me/logo',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Upload da logo institucional do usuário (multipart/form-data)',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data']
      }
    },
    userController.uploadLogo.bind(userController)
  )

  // --- Rota de Remoção de Logo ---
  server.delete(
    '/me/logo',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Remove a logo institucional do usuário',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }]
      }
    },
    userController.removeLogo.bind(userController)
  )

  // Get specific user by ID
  server.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get user by ID',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    userController.getUserById.bind(userController)
  )

  // Create new user
  server.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Create a new user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        body: z.object({
          email: z.string().email(),
          password: z.string().min(8),
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          username: z.string().min(3),
          isActive: z.boolean().default(true),
          isVerified: z.boolean().default(false),
          roles: z.array(z.string()).optional()
        })
      }
    },
    userController.createUser.bind(userController)
  )

  // Update user
  server.put(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Update user information',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          email: z.string().email().optional(),
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          username: z.string().min(3).optional(),
          avatar: z.string().optional().nullable(),
          isActive: z.boolean().optional(),
          isVerified: z.boolean().optional(),
          preferences: z.record(z.any()).optional(),
          metadata: z.record(z.any()).optional()
        })
      }
    },
    userController.updateUser.bind(userController)
  )

  // Delete user
  server.delete(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Delete a user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    userController.deleteUser.bind(userController)
  )

  // Assign roles to user
  server.post(
    '/:id/roles',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Assign roles to user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          roleIds: z.array(z.string()).min(1),
          expiresAt: z.string().datetime().optional()
        })
      }
    },
    userController.assignRoles.bind(userController)
  )

  // Remove roles from user
  server.delete(
    '/:id/roles',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Remove roles from user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          roleIds: z.array(z.string()).min(1)
        })
      }
    },
    userController.removeRoles.bind(userController)
  )

  // Get user's active sessions
  server.get(
    '/:id/sessions',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get user active sessions',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    userController.getUserSessions.bind(userController)
  )

  // Terminate user sessions
  server.delete(
    '/:id/sessions',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Terminate all user sessions',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    userController.terminateUserSessions.bind(userController)
  )

  // Activate/Deactivate user
  server.patch(
    '/:id/status',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Change user active status',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          isActive: z.boolean(),
          reason: z.string().optional()
        })
      }
    },
    userController.changeUserStatus.bind(userController)
  )

  // Force password reset for user
  server.post(
    '/:id/force-password-reset',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Force password reset for user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    userController.forcePasswordReset.bind(userController)
  )
}