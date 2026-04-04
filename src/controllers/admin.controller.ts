import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authService } from '../services/auth.service.js'
import { z } from 'zod'

const orgIdSchema = z.object({ id: z.string().cuid() })

export class AdminController {

    // --- LIST ORGANIZATIONS ---
    async listOrganizations(request: FastifyRequest, reply: FastifyReply) {
        const user = request.user as any
        if (!user?.isSuperAdmin) {
            return reply.code(403).send({ message: 'Acesso restrito a Super Admins.' })
        }

        const organizations = await prisma.organization.findMany({
            select: {
                id: true,
                name: true,
                slug: true,
                cnpj: true,
                plan: true,
                isActive: true,
                createdAt: true,
                _count: { select: { users: true, workspaces: true } }
            },
            orderBy: { createdAt: 'desc' }
        })

        return reply.send(organizations)
    }

    // --- IMPERSONATE ORG ADMIN ---
    async impersonate(request: FastifyRequest, reply: FastifyReply) {
        const user = request.user as any
        if (!user?.isSuperAdmin) {
            return reply.code(403).send({ message: 'Acesso restrito a Super Admins.' })
        }

        const { id: orgId } = orgIdSchema.parse(request.params)

        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { id: true, name: true, slug: true, isActive: true }
        })

        if (!org) {
            return reply.code(404).send({ message: 'Organização não encontrada.' })
        }

        if (!org.isActive) {
            return reply.code(403).send({ message: 'Organização está inativa.' })
        }

        // Busca o primeiro admin da org (role = 'admin')
        const adminUser = await prisma.user.findFirst({
            where: {
                organizationId: orgId,
                isActive: true,
                roles: { some: { role: { name: 'admin' } } }
            },
            select: { id: true, email: true, firstName: true, lastName: true }
        })

        if (!adminUser) {
            return reply.code(404).send({ message: 'Nenhum usuário admin ativo encontrado nesta organização.' })
        }

        // Gera token scoped para o admin da org (sem criar sessão — token apenas de acesso)
        const permissions = ['system:admin']
        const accessToken = await authService.generateAccessToken(
            adminUser.id,
            permissions,
            orgId,
            false
        )

        return reply.send({
            message: `Impersonating admin of "${org.name}"`,
            organization: { id: org.id, name: org.name, slug: org.slug },
            user: { id: adminUser.id, email: adminUser.email, firstName: adminUser.firstName, lastName: adminUser.lastName },
            accessToken
        })
    }
}

export const adminController = new AdminController()
