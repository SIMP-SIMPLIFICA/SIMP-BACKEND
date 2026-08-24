import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { HARD_QUERY_CAP } from '@/constants/pagination.js'

const createSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
}).strip();

const updateSchema = createSchema.partial();

export class FinanceCategoryController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const organizationId = request.user.organizationId
        if (!organizationId && !request.user.isSuperAdmin) {
            return reply.status(403).send({ message: 'Usuário sem organização' })
        }
        const data = createSchema.parse(request.body);
        const category = await prisma.financeCategory.create({
            data: {
                organizationId: organizationId,
                name: data.name,
                description: data.description,
            }
        });
        return reply.status(201).send(category);
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
        const categories = await prisma.financeCategory.findMany({
          // Teto de memoria: esta listagem nao expoe paginacao ao cliente.
          take: HARD_QUERY_CAP,
            where: orgFilter,
            orderBy: { name: 'asc' },
        });
        return reply.send(categories);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = updateSchema.parse(request.body);

        const category = await prisma.financeCategory.findUnique({ where: { id } });
        if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });

        if (!request.user.isSuperAdmin && category.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Categoria não encontrada' });
        }

        const updated = await prisma.financeCategory.update({ where: { id }, data });
        return reply.send(updated);
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

        const category = await prisma.financeCategory.findUnique({ where: { id } });
        if (!category) return reply.status(404).send({ message: 'Categoria não encontrada' });

        if (!request.user.isSuperAdmin && category.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Categoria não encontrada' });
        }

        await prisma.financeCategory.delete({ where: { id } });
        return reply.status(204).send();
    }
}
