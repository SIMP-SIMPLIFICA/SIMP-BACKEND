import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createBankAccountSchema, updateBankAccountSchema } from '../schemas/finance.schema.js';

export class FinanceBankAccountController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const data = createBankAccountSchema.parse(request.body);
        const userId = request.user.id;

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: data.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const account = await prisma.bankAccount.create({
            data: {
                workspaceId: data.workspaceId,
                name: data.name,
                agency: data.agency ?? null,
                accountNumber: data.accountNumber ?? null,
                initialBalanceCents: data.initialBalanceCents ?? 0,
            }
        });

        return reply.status(201).send(account);
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
        const userId = request.user.id;

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const accounts = await prisma.bankAccount.findMany({
            where: { workspaceId },
            orderBy: { name: 'asc' },
        });

        return reply.send(accounts);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = updateBankAccountSchema.parse(request.body);
        const userId = request.user.id;

        const account = await prisma.bankAccount.findUnique({ where: { id } });
        if (!account) return reply.status(404).send({ message: 'Conta não encontrada' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: account.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const updated = await prisma.bankAccount.update({ where: { id }, data });
        return reply.send(updated);
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = request.user.id;

        const account = await prisma.bankAccount.findUnique({ where: { id } });
        if (!account) return reply.status(404).send({ message: 'Conta não encontrada' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: account.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        await prisma.bankAccount.delete({ where: { id } });
        return reply.status(204).send();
    }
}
