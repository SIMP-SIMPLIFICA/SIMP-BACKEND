import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { createTaskSchema, updateTaskSchema, createChecklistItemSchema, updateChecklistItemSchema } from '../schemas/task.schemas.js';
import { z } from 'zod';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export class TaskController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.params);
    const data = createTaskSchema.parse(request.body);
    const userId = request.user.id; 

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });

    if (!member) {
      return reply.status(403).send({ message: 'Acesso negado ao workspace' });
    }

    const task = await prisma.task.create({
      data: {
        workspaceId,
        creatorId: userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        dueDate: data.dueDate,
        assignees: data.assigneeIds ? {
          create: data.assigneeIds.map(aid => ({ userId: aid }))
        } : undefined,
        history: {
          create: { action: 'Criou a tarefa', userId, metadata: { title: data.title } }
        }
      },
      include: { assignees: { include: { user: true } }, creator: true }
    });

    return reply.status(201).send(task);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.params);
    const tasks = await prisma.task.findMany({
      where: { workspaceId },
      include: {
        assignees: { include: { user: { select: { id: true, firstName: true, avatar: true } } } },
        _count: { select: { checklist: true, notes: true, attachments: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return reply.send(tasks);
  }

  async details(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignees: { include: { user: { select: { id: true, firstName: true, avatar: true } } } },
        checklist: { orderBy: { id: 'asc' } },
        notes: { include: { author: { select: { id: true, firstName: true, avatar: true } } }, orderBy: { createdAt: 'desc' } },
        history: { include: { user: { select: { id: true, firstName: true } } }, orderBy: { createdAt: 'desc' } },
        attachments: true,
        creator: { select: { id: true, firstName: true } }
      }
    });
    if (!task) return reply.status(404).send({ message: 'Tarefa não encontrada' });
    return reply.send(task);
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = updateTaskSchema.parse(request.body);
    const userId = request.user.id;

    let historyAction = 'Atualizou a tarefa';
    if (data.priority) historyAction = `Alterou a prioridade para ${data.priority}`;
    if (data.dueDate) historyAction = `Alterou a data de entrega`;
    if (data.description) historyAction = `Atualizou a descrição`;

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        assignees: data.assigneeIds ? {
          deleteMany: {}, 
          create: data.assigneeIds.map(aid => ({ userId: aid }))
        } : undefined,
        history: {
          create: { action: historyAction, userId, metadata: data }
        }
      }
    });
    return reply.send(task);
  }

  async addChecklistItem(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { title } = createChecklistItemSchema.parse(request.body);
    const userId = request.user.id;

    const item = await prisma.checklistItem.create({ data: { taskId: id, title } });
    await prisma.taskHistory.create({
        data: { taskId: id, userId, action: `Adicionou ao checklist: "${title}"` }
    });
    return reply.status(201).send(item);
  }

  async updateChecklistItem(request: FastifyRequest, reply: FastifyReply) {
    const { itemId } = z.object({ itemId: z.string() }).parse(request.params);
    const data = updateChecklistItemSchema.parse(request.body);
    const userId = request.user.id;

    const item = await prisma.checklistItem.findUnique({ where: { id: itemId } });
    if (!item) return reply.status(404).send();

    const updatedItem = await prisma.checklistItem.update({ where: { id: itemId }, data });

    if (data.isDone !== undefined) {
        await prisma.taskHistory.create({
            data: {
                taskId: item.taskId, userId,
                action: data.isDone ? `Concluiu o item: "${item.title}"` : `Reabriu o item: "${item.title}"`
            }
        });
    }
    return reply.send(updatedItem);
  }

  async addNote(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { content } = z.object({ content: z.string().min(1) }).parse(request.body);
    const userId = request.user.id;

    const note = await prisma.taskNote.create({
      data: { taskId: id, content, authorId: userId },
      include: { author: { select: { id: true, firstName: true, avatar: true } } }
    });
    await prisma.taskHistory.create({ data: { taskId: id, userId, action: 'Comentou na tarefa' } });
    return reply.status(201).send(note);
  }

  async toggleStatus(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED']) }).parse(request.body);
    const userId = request.user.id;

    const task = await prisma.task.update({
      where: { id },
      data: { 
        status,
        history: { create: { action: `Alterou o status para ${status}`, userId } }
      }
    });
    return reply.send(task);
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await prisma.task.delete({ where: { id } });
    return reply.status(204).send(); 
  }

  // --- UPLOAD ROBUSTO (NOVO) ---
  async uploadAttachment(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;
    
    // 1. Processar arquivo
    const data = await request.file();
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' });

    // 2. Criar diretório
    const uploadDir = join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // 3. Gerar nome único e seguro
    const fileExt = path.extname(data.filename);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${fileExt}`;
    const uploadPath = join(uploadDir, uniqueName);

    // 4. Salvar arquivo
    await pipeline(data.file, createWriteStream(uploadPath));
    const stats = fs.statSync(uploadPath);

    // 5. Salvar no Banco
    const attachment = await prisma.taskAttachment.create({
        data: {
            taskId: id,
            uploaderId: userId,
            fileName: data.filename, // Nome original para exibição
            fileType: data.mimetype,
            fileSize: stats.size,
            fileUrl: uniqueName // Nome físico para URL
        }
    });

    // 6. Histórico
    await prisma.taskHistory.create({
        data: { taskId: id, userId, action: `Anexou o arquivo: "${data.filename}"` }
    });

    return reply.status(201).send(attachment);
  }

  async deleteAttachment(request: FastifyRequest, reply: FastifyReply) {
    const { attachmentId } = z.object({ attachmentId: z.string() }).parse(request.params);
    const userId = request.user.id;

    const attachment = await prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) return reply.status(404).send();

    await prisma.taskAttachment.delete({ where: { id: attachmentId } });

    // Tentar apagar arquivo físico
    try {
        const filePath = join(process.cwd(), 'uploads', attachment.fileUrl);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        console.error("Erro ao deletar arquivo físico:", e);
    }

    await prisma.taskHistory.create({
        data: { taskId: attachment.taskId, userId, action: `Removeu o anexo: "${attachment.fileName}"` }
    });

    return reply.status(204).send();
  }
}