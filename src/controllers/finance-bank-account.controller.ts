import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const createSchema = z.object({
    name: z.string().min(1).max(100),
    agency: z.string().max(20).optional().nullable(),
    accountNumber: z.string().max(30).optional().nullable(),
    initialBalanceCents: z.number().int().default(0),
}).strip();

const updateSchema = createSchema.partial();

export class FinanceBankAccountController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const organizationId = request.user.organizationId
        if (!organizationId && !request.user.isSuperAdmin) {
            return reply.status(403).send({ message: 'Usuário sem organização' })
        }
        const data = createSchema.parse(request.body);
        const account = await prisma.bankAccount.create({
            data: {
                organizationId: organizationId!,
                name: data.name,
                agency: data.agency ?? null,
                accountNumber: data.accountNumber ?? null,
                initialBalanceCents: data.initialBalanceCents ?? 0,
            }
        });
        return reply.status(201).send(account);
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
        const accounts = await prisma.bankAccount.findMany({
            where: orgFilter,
            orderBy: { name: 'asc' },
        });
        return reply.send(accounts);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = updateSchema.parse(request.body);

        const account = await prisma.bankAccount.findUnique({ where: { id } });
        if (!account) return reply.status(404).send({ message: 'Conta não encontrada' });

        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
        if (!request.user.isSuperAdmin && account.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Conta não encontrada' });
        }

        const updated = await prisma.bankAccount.update({ where: { id }, data });
        return reply.send(updated);
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

        const account = await prisma.bankAccount.findUnique({ where: { id } });
        if (!account) return reply.status(404).send({ message: 'Conta não encontrada' });

        if (!request.user.isSuperAdmin && account.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Conta não encontrada' });
        }

        await prisma.bankAccount.delete({ where: { id } });
        return reply.status(204).send();
    }
}
