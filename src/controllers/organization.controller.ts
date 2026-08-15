import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma.js'
import { authService } from '@/services/auth.service.js'
import { ensureAdminRole } from '@/services/rbac.service.js'
import { ALL_MODULES, DEFAULT_MODULES } from '@/constants/modules.js'

const createOrgSchema = z.object({
  orgName: z.string().min(3, 'Nome da organização deve ter ao menos 3 caracteres'),
  orgSlug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  orgCnpj: z.string().optional(),
  adminEmail: z.string().email('E-mail inválido'),
  adminPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Deve conter ao menos uma letra maiúscula')
    .regex(/[a-z]/, 'Deve conter ao menos uma letra minúscula')
    .regex(/[0-9]/, 'Deve conter ao menos um número')
    .regex(/[@$!%*?&]/, 'Deve conter ao menos um caractere especial'),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1)
})

function zodErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map(i => i.message).join('. ')
  }
  return error instanceof Error ? error.message : String(error)
}

export class OrganizationController {
  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user.isSuperAdmin) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Acesso restrito a super admins.' })
    }
    try {
      const orgs = await prisma.organization.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' }
      })
      return reply.send({ data: orgs })
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Internal Server Error', message: zodErrorMessage(error) })
    }
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createOrgSchema.parse(request.body)

      // Verificar conflitos antes da transação
      const [slugExists, cnpjExists, emailExists] = await Promise.all([
        prisma.organization.findUnique({ where: { slug: data.orgSlug } }),
        data.orgCnpj
          ? prisma.organization.findUnique({ where: { cnpj: data.orgCnpj } })
          : Promise.resolve(null),
        prisma.user.findUnique({ where: { email: data.adminEmail.toLowerCase() } })
      ])

      if (slugExists) {
        return reply.code(409).send({ error: 'Conflict', message: 'Slug já está em uso' })
      }
      if (cnpjExists) {
        return reply.code(409).send({ error: 'Conflict', message: 'CNPJ já está cadastrado' })
      }
      if (emailExists) {
        return reply.code(409).send({ error: 'Conflict', message: 'E-mail já está em uso' })
      }

      const hashedPassword = await authService.hashPassword(data.adminPassword)

      // Criar org + admin em transação
      const { org, adminUser } = await prisma.$transaction(async tx => {
        const org = await tx.organization.create({
          data: {
            name: data.orgName,
            slug: data.orgSlug,
            cnpj: data.orgCnpj ?? null
          }
        })

        const adminUser = await tx.user.create({
          data: {
            id: randomUUID(),
            email: data.adminEmail.toLowerCase(),
            firstName: data.adminFirstName,
            lastName: data.adminLastName,
            password: hashedPassword,
            isActive: true,
            isVerified: true,
            organizationId: org.id,
            isSuperAdmin: false
          }
        })

        // Atribuir role admin ao usuário
        const adminRole = await ensureAdminRole(tx)
        await tx.userRole.create({
          data: { userId: adminUser.id, roleId: adminRole.id, assignedBy: 'system' }
        })

        // Criar módulos padrão para a nova organização
        await tx.organizationModule.createMany({
          data: ALL_MODULES.map(module => ({
            organizationId: org.id,
            module,
            isEnabled: DEFAULT_MODULES.includes(module),
          })),
        })

        return { org, adminUser }
      })

      // Gerar tokens para o admin já entrar logado
      const tokens = await authService.generateTokenPair(adminUser.id)

      return reply.code(201).send({
        message: 'Organização criada com sucesso',
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          cnpj: org.cnpj,
          plan: org.plan
        },
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          organizationId: adminUser.organizationId
        },
        tokens: {
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn
        }
      })
    } catch (error: unknown) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: zodErrorMessage(error)
      })
    }
  }
}

export const organizationController = new OrganizationController()
