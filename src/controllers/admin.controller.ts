import { FastifyReply, FastifyRequest } from 'fastify'
import { z, ZodError } from 'zod'
import { hash } from '@node-rs/argon2'
import { prisma } from '../lib/prisma.js'
import { authService } from '../services/auth.service.js'
import { DEFAULT_MODULES, ALL_MODULES, ModuleKey } from '../constants/modules.js'
import { invalidateModuleCache } from '../middleware/auth.middleware.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map(i => i.message).join('. ')
  return error instanceof Error ? error.message : String(error)
}

function generateTempPassword(): string {
  const lower   = 'abcdefghijkmnpqrstuvwxyz'
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const nums    = '23456789'
  const special = '@$!%*?&'
  const rand = (s: string) => s[Math.floor(Math.random() * s.length)]
  const base = Array.from({ length: 6 }, () => rand(lower)).join('')
  return rand(upper) + base + rand(nums) + rand(special)
}

function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as any
  if (!user?.isSuperAdmin) {
    reply.code(403).send({ error: 'Forbidden', message: 'Acesso restrito a Super Admins.' })
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const orgIdParamSchema    = z.object({ id: z.string() })
const moduleParamSchema   = z.object({ id: z.string(), module: z.string() })

const createOrgSchema = z.object({
  orgName:        z.string().min(3, 'Nome deve ter ao menos 3 caracteres'),
  orgSlug:        z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug: apenas letras minúsculas, números e hífens'),
  orgCnpj:        z.string().optional(),
  plan:           z.string().default('basic'),
  enabledModules: z.array(z.string()).default(DEFAULT_MODULES),
  adminEmail:     z.string().email('E-mail inválido'),
  adminFirstName: z.string().min(1),
  adminLastName:  z.string().min(1),
})

const updateOrgSchema = z.object({
  name:     z.string().min(3).optional(),
  plan:     z.string().optional(),
  isActive: z.boolean().optional(),
})

const toggleModuleSchema = z.object({
  isEnabled: z.boolean(),
  notes:     z.string().optional(),
})

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AdminController {

  // GET /admin/organizations
  async listOrganizations(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        cnpj: true,
        plan: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
        modules: {
          select: { module: true, isEnabled: true },
          orderBy: { module: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: organizations })
  }

  // POST /admin/organizations
  async createOrganization(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const superAdmin = request.user as any

    let data: z.infer<typeof createOrgSchema>
    try {
      data = createOrgSchema.parse(request.body)
    } catch (err) {
      return reply.code(400).send({ error: 'Bad Request', message: zodErrorMessage(err) })
    }

    const [slugExists, cnpjExists, emailExists] = await Promise.all([
      prisma.organization.findUnique({ where: { slug: data.orgSlug } }),
      data.orgCnpj ? prisma.organization.findUnique({ where: { cnpj: data.orgCnpj } }) : null,
      prisma.user.findUnique({ where: { email: data.adminEmail.toLowerCase() } }),
    ])
    if (slugExists)  return reply.code(409).send({ error: 'Conflict', message: 'Slug já está em uso.' })
    if (cnpjExists)  return reply.code(409).send({ error: 'Conflict', message: 'CNPJ já cadastrado.' })
    if (emailExists) return reply.code(409).send({ error: 'Conflict', message: 'E-mail já está em uso.' })

    const tempPassword   = generateTempPassword()
    const hashedPassword = await hash(tempPassword, { memoryCost: 65536, timeCost: 3, parallelism: 4 })

    const validModules = data.enabledModules.filter(m =>
      (ALL_MODULES as readonly string[]).includes(m)
    ) as ModuleKey[]

    const { org, adminUser } = await prisma.$transaction(async tx => {
      const org = await tx.organization.create({
        data: { name: data.orgName, slug: data.orgSlug, cnpj: data.orgCnpj ?? null, plan: data.plan },
      })

      await tx.organizationModule.createMany({
        data: ALL_MODULES.map(module => ({
          organizationId: org.id,
          module,
          isEnabled: validModules.includes(module),
          enabledById: superAdmin.id ?? null,
        })),
      })

      const adminRole = await tx.role.findFirst({ where: { name: 'admin' } })

      const adminUser = await tx.user.create({
        data: {
          email: data.adminEmail.toLowerCase(),
          firstName: data.adminFirstName,
          lastName: data.adminLastName,
          password: hashedPassword,
          isActive: true,
          isVerified: true,
          organizationId: org.id,
          isSuperAdmin: false,
        },
      })

      if (adminRole) {
        await tx.userRole.create({
          data: { userId: adminUser.id, roleId: adminRole.id, assignedBy: 'super-admin' },
        })
      }

      return { org, adminUser }
    })

    return reply.code(201).send({
      message: 'Organização criada com sucesso.',
      org: { id: org.id, name: org.name, slug: org.slug, cnpj: org.cnpj, plan: org.plan },
      admin: { id: adminUser.id, email: adminUser.email, firstName: adminUser.firstName, lastName: adminUser.lastName },
      tempPassword, // TODO produção: enviar por email e remover do body
      enabledModules: validModules,
    })
  }

  // GET /admin/organizations/:id
  async getOrganization(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const { id } = orgIdParamSchema.parse(request.params)

    const org = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, cnpj: true, plan: true,
        isActive: true, createdAt: true, updatedAt: true,
        _count: { select: { users: true, workspaces: true } },
        modules: {
          select: { module: true, isEnabled: true, notes: true, updatedAt: true },
          orderBy: { module: 'asc' },
        },
        users: {
          take: 50,
          select: {
            id: true, firstName: true, lastName: true, email: true,
            isActive: true, createdAt: true,
            roles: { select: { role: { select: { displayName: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!org) return reply.code(404).send({ error: 'Not Found', message: 'Organização não encontrada.' })

    // Merge DB module rows with ALL_MODULES so newly added modules are always visible
    const dbModules = org.modules
    const mergedModules = ALL_MODULES.map(m => {
      const found = dbModules.find((d) => d.module === m)
      return found ?? { module: m, isEnabled: false, notes: null, updatedAt: new Date().toISOString() }
    })

    return reply.send({ data: { ...org, modules: mergedModules } })
  }

  // PATCH /admin/organizations/:id
  async updateOrganization(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const { id } = orgIdParamSchema.parse(request.params)

    let data: z.infer<typeof updateOrgSchema>
    try {
      data = updateOrgSchema.parse(request.body)
    } catch (err) {
      return reply.code(400).send({ error: 'Bad Request', message: zodErrorMessage(err) })
    }

    const org = await prisma.organization.findUnique({ where: { id } })
    if (!org) return reply.code(404).send({ error: 'Not Found', message: 'Organização não encontrada.' })

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(data.name     !== undefined && { name: data.name }),
        ...(data.plan     !== undefined && { plan: data.plan }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      select: { id: true, name: true, slug: true, plan: true, isActive: true, updatedAt: true },
    })

    return reply.send({ message: 'Organização atualizada.', data: updated })
  }

  // GET /admin/organizations/:id/modules
  async listModules(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const { id } = orgIdParamSchema.parse(request.params)

    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!org) return reply.code(404).send({ error: 'Not Found', message: 'Organização não encontrada.' })

    const dbModules = await prisma.organizationModule.findMany({
      where: { organizationId: id },
      orderBy: { module: 'asc' },
      select: { module: true, isEnabled: true, notes: true, updatedAt: true },
    })

    // Merge with ALL_MODULES so new modules are always visible even without a DB row
    const modules = ALL_MODULES.map(m => {
      const found = dbModules.find(d => d.module === m)
      return found ?? { module: m, isEnabled: false, notes: null, updatedAt: new Date().toISOString() }
    })

    return reply.send({ data: { org, modules } })
  }

  // PATCH /admin/organizations/:id/modules/:module
  async toggleModule(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const superAdmin = request.user as any
    const { id: orgId, module } = moduleParamSchema.parse(request.params)

    if (!(ALL_MODULES as readonly string[]).includes(module)) {
      return reply.code(400).send({ error: 'Bad Request', message: `Módulo inválido: "${module}".` })
    }

    let data: z.infer<typeof toggleModuleSchema>
    try {
      data = toggleModuleSchema.parse(request.body)
    } catch (err) {
      return reply.code(400).send({ error: 'Bad Request', message: zodErrorMessage(err) })
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    if (!org) return reply.code(404).send({ error: 'Not Found', message: 'Organização não encontrada.' })

    const updated = await prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId: orgId, module } },
      update:  { isEnabled: data.isEnabled, notes: data.notes ?? null, enabledById: superAdmin.id ?? null },
      create:  { organizationId: orgId, module, isEnabled: data.isEnabled, notes: data.notes ?? null, enabledById: superAdmin.id ?? null },
      select:  { module: true, isEnabled: true, notes: true, updatedAt: true },
    })

    invalidateModuleCache(orgId)

    const action = data.isEnabled ? 'habilitado' : 'desabilitado'
    return reply.send({ message: `Módulo "${module}" ${action}.`, data: updated })
  }

  // POST /admin/organizations/:id/impersonate
  async impersonate(request: FastifyRequest, reply: FastifyReply) {
    if (!requireSuperAdmin(request, reply)) return

    const { id: orgId } = orgIdParamSchema.parse(request.params)

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, isActive: true },
    })
    if (!org)         return reply.code(404).send({ error: 'Not Found', message: 'Organização não encontrada.' })
    if (!org.isActive) return reply.code(403).send({ error: 'Forbidden', message: 'Organização inativa.' })

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: orgId, isActive: true, roles: { some: { role: { name: 'admin' } } } },
      select: { id: true, email: true, firstName: true, lastName: true },
    })
    if (!adminUser) {
      return reply.code(404).send({ error: 'Not Found', message: 'Nenhum admin ativo encontrado nesta organização.' })
    }

    const accessToken = await authService.generateAccessToken(adminUser.id, ['system:admin'], orgId, false)

    return reply.send({
      message: `Impersonating admin of "${org.name}"`,
      organization: { id: org.id, name: org.name, slug: org.slug },
      user: { id: adminUser.id, email: adminUser.email, firstName: adminUser.firstName, lastName: adminUser.lastName },
      accessToken,
    })
  }
}

export const adminController = new AdminController()
