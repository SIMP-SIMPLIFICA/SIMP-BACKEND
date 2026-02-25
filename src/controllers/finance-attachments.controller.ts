import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { uploadFileToR2, getPresignedUrl, deleteFileFromR2 } from '../lib/storage.js';

export class FinanceAttachmentController {

    async upload(request: FastifyRequest, reply: FastifyReply) {
        const { id: entryId } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        // Validating Access
        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado' });

        // Parsing Multipart data
        const data = await request.file();
        if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' });

        const buffer = await data.toBuffer();

        try {
            // Send to Cloudflare R2
            const { key } = await uploadFileToR2(buffer, data.filename, data.mimetype, entry.workspaceId);

            // Save relationship in Database
            const attachment = await prisma.financeAttachment.create({
                data: {
                    entryId,
                    fileName: data.filename,
                    fileKey: key,
                    fileSize: buffer.length,
                    contentType: data.mimetype,
                }
            });

            // Update parent entry status
            if (entry.attachmentsStatus === 'none' || entry.attachmentsStatus === 'pending') {
                await prisma.financeEntry.update({
                    where: { id: entryId },
                    data: { attachmentsStatus: 'ok' }
                });
            }

            return reply.status(201).send(attachment);
        } catch (error) {
            console.error('[Upload Error]', error);
            return reply.status(500).send({ message: 'Erro ao salvar o anexo na nuvem' });
        }
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const { id: entryId } = z.object({ id: z.string().uuid() }).parse(request.params);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado' });

        const attachments = await prisma.financeAttachment.findMany({
            where: { entryId },
            orderBy: { createdAt: 'desc' }
        });

        // Generate temporary secure URLs for the frontend
        const attachmentsWithUrls = await Promise.all(attachments.map(async (att) => {
            const url = await getPresignedUrl(att.fileKey);
            return { ...att, url };
        }));

        return reply.send(attachmentsWithUrls);
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id: entryId, attachmentId } = z.object({
            id: z.string().uuid(),
            attachmentId: z.string().uuid()
        }).parse(request.params);
        const userId = (request.user as any).id;

        const entry = await prisma.financeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });

        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: entry.workspaceId, userId } }
        });
        if (!member) return reply.status(403).send({ message: 'Acesso negado' });

        const attachment = await prisma.financeAttachment.findUnique({
            where: { id: attachmentId, entryId }
        });

        if (!attachment) return reply.status(404).send({ message: 'Anexo não encontrado' });

        try {
            // 1. Delete from R2
            await deleteFileFromR2(attachment.fileKey);

            // 2. Delete from Database
            await prisma.financeAttachment.delete({ where: { id: attachmentId } });

            // 3. Update parent status if it was the last attachment
            const remaining = await prisma.financeAttachment.count({ where: { entryId } });
            if (remaining === 0) {
                await prisma.financeEntry.update({
                    where: { id: entryId },
                    data: { attachmentsStatus: 'none' }
                });
            }

            return reply.status(204).send();
        } catch (error) {
            console.error('[Delete Error]', error);
            return reply.status(500).send({ message: 'Erro ao remover o anexo' });
        }
    }
}
