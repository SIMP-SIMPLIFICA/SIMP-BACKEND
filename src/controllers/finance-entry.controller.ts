import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createEntrySchema, updateEntrySchema } from '../schemas/finance.schema.js';

export class FinanceEntryController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const data = createEntrySchema.parse(request.body);
        const userId = (request.user as any).id;

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: data.workspaceId, userId } }
        });

        if (!member) {
            return reply.status(403).send({ message: 'Acesso negado ao workspace' });
        }

        const entry = await prisma.financeEntry.create({
            data: {
                workspaceId: data.workspaceId,
                occurredAt: new Date(data.occurredAt),
                description: data.description,
                amountCents: data.amountCents,
                type: data.type,
                categoryId: data.categoryId,
                attachmentsStatus: data.attachmentsStatus,
                createdById: userId,
            },
            include: {
                category: { select: { name: true } }
            }
        });

        // Mapeando a resposta para casar com o frontend onde esperamos "categoryName" direto
        const mappedEntry = {
            ...entry,
            categoryName: entry.category?.name || 'Sem Categoria',
        };

        return reply.status(201).send(mappedEntry);
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        // Pegando workspaceId da rota ou da query
        const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } }
        });

        if (!member) {
            return reply.status(403).send({ message: 'Acesso negado ao workspace' });
        }

        // Parâmetros de filtro opcionais (Ex: search por data, por tipo)
        const { startDate, endDate, type, categoryId } = z.object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            type: z.enum(['EXPENSE', 'INCOME']).optional(),
            categoryId: z.string().uuid().optional(),
        }).parse(request.query || {});

        const whereClause: any = {
            workspaceId,
            deletedAt: null // Não buscar itens apagados (Soft delete)
        };

        if (startDate && endDate) {
            whereClause.occurredAt = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        } else if (startDate) {
            whereClause.occurredAt = { gte: new Date(startDate) };
        } else if (endDate) {
            whereClause.occurredAt = { lte: new Date(endDate) };
        }

        if (type) whereClause.type = type;
        if (categoryId) whereClause.categoryId = categoryId;

        const entries = await prisma.financeEntry.findMany({
            where: whereClause,
            include: {
                category: { select: { name: true } }
            },
            orderBy: { occurredAt: 'desc' }
        });

        const mappedEntries = entries.map(entry => ({
            ...entry,
            categoryName: entry.category?.name || 'Sem Categoria'
        }));

        return reply.send(mappedEntries);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = updateEntrySchema.parse(request.body);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const updatedEntry = await prisma.financeEntry.update({
            where: { id },
            data: {
                ...data,
                occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
                updatedById: userId,
            },
            include: {
                category: { select: { name: true } }
            }
        });

        return reply.send({
            ...updatedEntry,
            categoryName: updatedEntry.category?.name || 'Sem Categoria'
        });
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        // Soft delete preenchendo deletedAt
        await prisma.financeEntry.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedById: userId
            }
        });

        return reply.status(204).send();
    }
}
