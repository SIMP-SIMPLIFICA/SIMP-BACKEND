import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createEntrySchema, updateEntrySchema } from '../schemas/finance.schema.js';
import { deleteFile, getFileUrl, saveFile } from '../services/storage.service.js';
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'
import { HARD_QUERY_CAP, MAX_PAGE_SIZE } from '@/constants/pagination.js'

export class FinanceEntryController {

    async create(request: FastifyRequest, reply: FastifyReply) {
        const parsed = createEntrySchema.safeParse(request.body);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return reply.status(400).send({
                error: 'Validation Error',
                field: issue.path.join('.') || 'unknown',
                message: issue.message,
            });
        }
        const data = parsed.data;
        const userId = request.user.id;
        const organizationId = request.user.organizationId;

        if (!organizationId && !request.user.isSuperAdmin) {
            return reply.status(403).send({ message: 'Usuário sem organização' });
        }

        const entry = await prisma.financeEntry.create({
            data: {
                organizationId: organizationId,
                occurredAt: new Date(data.occurredAt),
                description: data.description,
                amountCents: data.amountCents,
                type: data.type,
                categoryId: data.categoryId,
                accountId: data.accountId,
                subcategoryName: data.subcategoryName,
                nfeNumber: data.nfeNumber,
                issueDate: new Date(data.issueDate),
                providerDocument: data.providerDocument,
                empenhoNumber: data.empenhoNumber,
                liquidacaoNumber: data.liquidacaoNumber,
                deliveryDate: new Date(data.deliveryDate),
                attachmentsStatus: data.attachmentsStatus,
                createdById: userId,
            },
            include: {
                category: { select: { name: true } }
            }
        });

        return reply.status(201).send({
            ...entry,
            categoryName: entry.category?.name || 'Sem Categoria',
        });
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const organizationId = request.user.organizationId;
        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId };

        const { startDate, endDate, type, categoryNames, page, limit, search } = z.object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            type: z.enum(['EXPENSE', 'INCOME']).optional(),
            categoryNames: z.string().optional(),
            page: z.coerce.number().min(1).optional(),
            limit: z.coerce.number().min(1).max(MAX_PAGE_SIZE).optional(),
            search: z.string().optional(),
        }).parse(request.query || {});

        const whereClause: any = {
            ...orgFilter,
            deletedAt: null
        };

        if (startDate && endDate) {
            whereClause.occurredAt = { gte: new Date(startDate), lte: new Date(endDate) };
        } else if (startDate) {
            whereClause.occurredAt = { gte: new Date(startDate) };
        } else if (endDate) {
            whereClause.occurredAt = { lte: new Date(endDate) };
        }

        if (type) whereClause.type = type;
        if (categoryNames) {
            whereClause.category = { name: { in: categoryNames.split(',') } };
        }
        if (search) {
            whereClause.OR = [
                { description: { contains: search, mode: 'insensitive' } },
                { category: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const queryOptions: any = {
            where: whereClause,
            include: { category: { select: { name: true } } },
            orderBy: { occurredAt: 'desc' }
        };

        if (page && limit) {
            queryOptions.skip = (page - 1) * limit;
            queryOptions.take = limit;
        } else {
            // Sem page/limit a query era ILIMITADA: uma organização com anos de
            // lançamentos carregava tudo em memória num único findMany. O formato
            // da resposta (array puro) é mantido para não quebrar o frontend — só
            // o número de linhas passa a ter teto.
            queryOptions.take = HARD_QUERY_CAP;
        }

        const [entries, totalCount, aggregations] = await Promise.all([
            prisma.financeEntry.findMany(queryOptions),
            prisma.financeEntry.count({ where: whereClause }),
            prisma.financeEntry.groupBy({
                by: ['type'],
                where: whereClause,
                _sum: { amountCents: true }
            })
        ]);

        const mappedEntries = (entries as Array<typeof entries[0] & { category?: { name: string } | null }>).map(entry => ({
            ...entry,
            categoryName: entry.category?.name || 'Sem Categoria'
        }));

        if (page && limit) {
            let totalIncome = 0;
            let totalExpense = 0;
            aggregations.forEach(agg => {
                const sum = agg._sum.amountCents || 0;
                if (agg.type === 'INCOME') totalIncome += sum;
                if (agg.type === 'EXPENSE') totalExpense += sum;
            });
            return reply.send({
                data: mappedEntries,
                meta: { total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit), totalIncome, totalExpense }
            });
        }

        return reply.send(mappedEntries);
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const parsed = updateEntrySchema.safeParse(request.body);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return reply.status(400).send({
                error: 'Validation Error',
                field: issue.path.join('.') || 'unknown',
                message: issue.message,
            });
        }
        const data = parsed.data;
        const userId = request.user.id;

        const entry = await prisma.financeEntry.findUnique({ where: { id } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        if (!request.user.isSuperAdmin && entry.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Lançamento não encontrado' });
        }

        const updatedEntry = await prisma.financeEntry.update({
            where: { id },
            data: {
                ...data,
                occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
                issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
                updatedById: userId,
            },
            include: { category: { select: { name: true } } }
        });

        return reply.send({
            ...updatedEntry,
            categoryName: updatedEntry.category?.name || 'Sem Categoria'
        });
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = request.user.id;

        const entry = await prisma.financeEntry.findUnique({ where: { id } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        if (!request.user.isSuperAdmin && entry.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Lançamento não encontrado' });
        }

        await prisma.financeEntry.update({
            where: { id },
            data: { deletedAt: new Date(), updatedById: userId }
        });

        return reply.status(204).send();
    }

    // --- ATTACHMENTS ---
    async listAttachments(request: FastifyRequest, reply: FastifyReply) {
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        if (!request.user.isSuperAdmin && entry.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Lançamento não encontrado' });
        }

        const attachments = await prisma.financeAttachment.findMany({
            where: { entryId },
            orderBy: { createdAt: 'desc' }
        });

        // fileUrl guarda o fileKey completo (definido no upload)
        const mappedAttachments = attachments.map(att => ({ ...att, url: getFileUrl(att.fileUrl) }));

        return reply.send(mappedAttachments);
    }

    async uploadAttachment(request: FastifyRequest, reply: FastifyReply) {
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const userId = request.user.id;

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        if (!request.user.isSuperAdmin && entry.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Lançamento não encontrado' });
        }

        const data = await request.file();
        if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' });

        const buffer = await data.toBuffer();

        // Comprovante fiscal não validava tipo algum antes desta mudança.
        const detected = assertAllowedFile(buffer, {
            policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT,
            declaredMime: data.mimetype,
            fileName: data.filename,
        });

        const fileKey = await saveFile(buffer, {
            organizationId: entry.organizationId,
            scope: 'finance',
            originalName: data.filename,
        });

        const attachment = await prisma.financeAttachment.create({
            data: {
                entryId,
                uploaderId: userId,
                fileName: data.filename,
                fileType: detected.mime,
                fileSize: buffer.length,
                fileUrl: fileKey  // store full key
            }
        });

        if (entry.attachmentsStatus === 'NONE' || entry.attachmentsStatus === 'none') {
            await prisma.financeEntry.update({
                where: { id: entryId },
                data: { attachmentsStatus: 'ok' }
            });
        }

        return reply.status(201).send({ ...attachment, url: getFileUrl(fileKey) });
    }

    async deleteAttachment(request: FastifyRequest, reply: FastifyReply) {
        const { entryId, attachmentId } = z.object({
            entryId: z.string().uuid(),
            attachmentId: z.string().uuid()
        }).parse(request.params);

        const attachment = await prisma.financeAttachment.findUnique({
            where: { id: attachmentId },
            include: { entry: true }
        });

        if (attachment?.entryId !== entryId) {
            return reply.status(404).send({ message: 'Anexo não encontrado' });
        }

        if (!request.user.isSuperAdmin && attachment.entry.organizationId !== request.user.organizationId) {
            return reply.status(404).send({ message: 'Anexo não encontrado' });
        }

        await prisma.financeAttachment.delete({ where: { id: attachmentId } });

        try {
            await deleteFile(attachment.fileUrl);
        } catch (_e) {
            // falha ao apagar do disco não impede a exclusão do registro
        }

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
