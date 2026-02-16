import type { FastifyInstance } from 'fastify'
import { userController } from '@/controllers/user.controller.js'
// Importamos apenas o authenticate que sabemos que existe e funciona
import { authenticate } from '../middleware/auth.middleware.js'

export function userRoutes(server: FastifyInstance) {
  // Get list of users
  server.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get paginated list of users',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string' },
            isActive: { type: 'boolean' },
            isVerified: { type: 'boolean' },
            role: { type: 'string' },
            sortBy: { type: 'string', enum: ['createdAt', 'email', 'firstName', 'lastName'] },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    username: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    avatar: { type: 'string' },
                    isActive: { type: 'boolean' },
                    isVerified: { type: 'boolean' },
                    twoFactorEnabled: { type: 'boolean' },
                    lastLoginAt: { type: 'string' },
                    createdAt: { type: 'string' },
                    roles: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          role: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                              displayName: { type: 'string' }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  total: { type: 'integer' },
                  totalPages: { type: 'integer' },
                  hasNext: { type: 'boolean' },
                  hasPrev: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    userController.getUsers.bind(userController)
  )

  // --- NOVA ROTA: Gerar Certificado Digital ---
  server.post(
    '/me/certificate',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Generate a self-signed digital certificate (PFX) for the current user',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        // CORREÇÃO: Adicionado body para evitar erro 500 no Swagger
        body: {
          type: 'object',
          properties: {} 
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              hasCertificate: { type: 'boolean' }
            }
          }
        }
      }
    },
    userController.generateCertificate.bind(userController)
  )
  // ------------------------------------------

  // Get specific user by ID
  server.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get user by ID',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
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
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            username: { type: 'string', minLength: 3 },
            isActive: { type: 'boolean', default: true },
            isVerified: { type: 'boolean', default: false },
            roles: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            username: { type: 'string', minLength: 3 },
            avatar: { type: 'string', format: 'uri' },
            isActive: { type: 'boolean' },
            isVerified: { type: 'boolean' },
            preferences: { type: 'object' },
            metadata: { type: 'object' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['roleIds'],
          properties: {
            roleIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1
            },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['roleIds'],
          properties: {
            roleIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1
            }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['isActive'],
          properties: {
            isActive: { type: 'boolean' },
            reason: { type: 'string' }
          }
        }
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
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    userController.forcePasswordReset.bind(userController)
  )
}