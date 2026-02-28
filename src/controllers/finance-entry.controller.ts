import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createEntrySchema, updateEntrySchema } from '../schemas/finance.schema.js';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

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
                subcategoryName: data.subcategoryName,
                nfeNumber: data.nfeNumber,
                issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
                providerDocument: data.providerDocument,
                empenhoNumber: data.empenhoNumber,
                liquidacaoNumber: data.liquidacaoNumber,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
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
                issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
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

    // --- ATTACHMENTS ---
    async listAttachments(request: FastifyRequest, reply: FastifyReply) {
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const attachments = await prisma.financeAttachment.findMany({
            where: { entryId },
            orderBy: { createdAt: 'desc' }
        });

        const backendUrl = process.env.API_URL || 'http://localhost:3000';
        const mappedAttachments = attachments.map(att => ({
            ...att,
            url: `${backendUrl}/uploads/${att.fileUrl}`
        }));

        return reply.send(mappedAttachments);
    }

    async uploadAttachment(request: FastifyRequest, reply: FastifyReply) {
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        const data = await request.file();
        if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' });

        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const fileExt = path.extname(data.filename);
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${fileExt}`;
        const uploadPath = path.join(uploadDir, uniqueName);

        await pipeline(data.file, createWriteStream(uploadPath));
        const stats = fs.statSync(uploadPath);

        const attachment = await prisma.financeAttachment.create({
            data: {
                entryId,
                uploaderId: userId,
                fileName: data.filename,
                fileType: data.mimetype,
                fileSize: stats.size,
                fileUrl: uniqueName
            }
        });

        // Update entry status if it was NONE
        if (entry.attachmentsStatus === 'NONE' || entry.attachmentsStatus === 'none') {
            await prisma.financeEntry.update({
                where: { id: entryId },
                data: { attachmentsStatus: 'ok' }
            });
        }

        const backendUrl = process.env.API_URL || 'http://localhost:3000';
        return reply.status(201).send({
            ...attachment,
            url: `${backendUrl}/uploads/${attachment.fileUrl}`
        });
    }

    async deleteAttachment(request: FastifyRequest, reply: FastifyReply) {
        const { entryId, attachmentId } = z.object({
            entryId: z.string().uuid(),
            attachmentId: z.string().uuid()
        }).parse(request.params);
        const userId = (request.user as any).id;

        const attachment = await prisma.financeAttachment.findUnique({
            where: { id: attachmentId },
            include: { entry: true }
        });

        if (!attachment || attachment.entryId !== entryId) {
            return reply.status(404).send({ message: 'Anexo não encontrado' });
        }

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: attachment.entry.workspaceId, userId } }
        });

        if (!member) return reply.status(403).send({ message: 'Acesso negado ao workspace' });

        await prisma.financeAttachment.delete({ where: { id: attachmentId } });

        try {
            const filePath = path.join(process.cwd(), 'uploads', attachment.fileUrl);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
            console.error('Erro ao deletar arquivo físico:', e);
        }

        // Check if there are remaining attachments, update entry status if 0
        const remaining = await prisma.financeAttachment.count({ where: { entryId } });
        if (remaining === 0) {
            await prisma.financeEntry.update({
                where: { id: entryId },
                data: { attachmentsStatus: 'none' }
            });
        }

        return reply.status(204).send();
    }
}
