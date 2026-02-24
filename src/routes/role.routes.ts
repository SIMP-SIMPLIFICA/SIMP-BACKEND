import type { FastifyInstance } from 'fastify'
import { z } from 'zod' // Importando Zod
import { roleController } from '@/controllers/role.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'

export async function roleRoutes(server: FastifyInstance) {
  // Get list of roles
  server.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get list of roles',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          search: z.string().optional(),
          isActive: z.coerce.boolean().optional(),
          isSystem: z.coerce.boolean().optional(),
          sortBy: z.enum(['name', 'displayName', 'createdAt']).optional(),
          sortOrder: z.enum(['asc', 'desc']).default('asc')
        }),
        // Response schema pode ser mantido ou omitido se não for crítico validar a saída agora
      }
    },
    roleController.getRoles.bind(roleController)
  )

  // Get specific role by ID
  server.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get role by ID',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    roleController.getRoleById.bind(roleController)
  )

  // Create new role
  server.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Create a new role',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
          displayName: z.string().min(1).max(100),
          description: z.string().max(500).optional().nullable(),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
          permissions: z.array(z.string()).min(1),
          parentId: z.string().optional().nullable(),
          metadata: z.record(z.any()).optional().nullable()
        })
      }
    },
    roleController.createRole.bind(roleController)
  )

  // Update role
  server.put(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Update role information',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          name: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
          displayName: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional().nullable(),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
          permissions: z.array(z.string()).optional(),
          parentId: z.string().optional().nullable(),
          isActive: z.boolean().optional(),
          metadata: z.record(z.any()).optional().nullable()
        })
      }
    },
    roleController.updateRole.bind(roleController)
  )

  // Delete role
  server.delete(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Delete a role',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        })
      }
    },
    roleController.deleteRole.bind(roleController)
  )

  // Get users with specific role
  server.get(
    '/:id/users',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get users assigned to specific role',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        querystring: z.object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          isActive: z.coerce.boolean().optional()
        })
      }
    },
    roleController.getRoleUsers.bind(roleController)
  )

  // Get available permissions
  server.get(
    '/permissions/available',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get list of available permissions',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }]
      }
    },
    roleController.getAvailablePermissions.bind(roleController)
  )

  // Duplicate role
  server.post(
    '/:id/duplicate',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Duplicate an existing role',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        params: z.object({
          id: z.string()
        }),
        body: z.object({
          name: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
          displayName: z.string().min(1).max(100),
          description: z.string().optional().nullable()
        })
      }
    },
    roleController.duplicateRole.bind(roleController)
  )

  // Get role hierarchy
  server.get(
    '/hierarchy',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Get role hierarchy tree',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }]
      }
    },
    roleController.getRoleHierarchy.bind(roleController)
  )
}