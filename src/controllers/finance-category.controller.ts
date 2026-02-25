import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createCategorySchema } from '../schemas/finance.schema.js';

export class FinanceCategoryController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const data = createCategorySchema.parse(request.body);
        const userId = (request.user as any).id;

        // Verificar se usuário tem acesso ao workspace (básico de segurança)
        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: data.workspaceId, userId } }
        });

        if (!member) {
            return reply.status(403).send({ message: 'Acesso negado ao workspace' });
        }

        let category = await prisma.financeCategory.findFirst({
            where: {
                workspaceId: data.workspaceId,
                name: data.name
            }
        });

        if (!category) {
            category = await prisma.financeCategory.create({
                data: {
                    workspaceId: data.workspaceId,
                    name: data.name,
                    description: data.description,
                }
            });
            return reply.status(201).send(category);
        }

        return reply.status(200).send(category);
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } }
        });

        if (!member) {
            return reply.status(403).send({ message: 'Acesso negado ao workspace' });
        }

        const categories = await prisma.financeCategory.findMany({
            where: {
                workspaceId,
                financeEntries: {
                    some: {
                        deletedAt: null
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        return reply.send(categories);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const { id } = paramsSchema.parse(request.params);

        // Simplificando o update schema apenas com os campos atualizáveis
        const updateSchema = z.object({
            name: z.string().min(1).max(100).optional(),
            description: z.string().max(500).optional()
        });
        const data = updateSchema.parse(request.body);
        const userId = (request.user as any).id;

        // Buscar a categoria para checar o workspace
        const category = await prisma.financeCategory.findUnique({ where: { id } });
        if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: category.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const updatedCategory = await prisma.financeCategory.update({
            where: { id },
            data
        });

        return reply.send(updatedCategory);
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const category = await prisma.financeCategory.findUnique({ where: { id } });
        if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: category.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        await prisma.financeCategory.delete({ where: { id } });

        return reply.status(204).send();
    }
}
