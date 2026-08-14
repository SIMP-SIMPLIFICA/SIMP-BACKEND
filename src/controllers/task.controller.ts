import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { createChecklistItemSchema, createTaskSchema, updateChecklistItemSchema, updateTaskSchema } from '../schemas/task.schemas.js';
import { notificationService } from '../services/notification.service.js';
import { userHasPermission, PERMISSION_MISSING_MESSAGE } from '../services/rbac.service.js';
import { z } from 'zod';
import { saveFile, getFileUrl, deleteFile } from '../services/storage.service.js';

// --- HELPERS ---

async function checkPermission(workspaceId: string, userId: string, allowedRoles: string[]) {
    const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
    });
    if (!member || !allowedRoles.includes(member.role)) {
        return false;
    }
    return true;
}

const getRecipients = (task: any, currentUserId: string) => {
    const recipients = new Set<string>();
    if (task.creatorId) recipients.add(task.creatorId);
    task.assignees?.forEach((a: any) => recipients.add(a.userId));
    recipients.delete(currentUserId);
    return Array.from(recipients);
};

export class TaskController {
  
  // --- CREATE ---
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.params);
    const data = createTaskSchema.parse(request.body);
    const userId = request.user.id; 

    // Buscamos o workspace para ter o nome na notificação + validar org
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
    const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, ...orgFilter } });
    if (!workspace) return reply.status(404).send({ message: "Workspace não encontrado" });

    const canCreate = await checkPermission(workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canCreate) return reply.status(403).send({ message: 'Sem permissão.' });

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

    const recipients = getRecipients(task, userId);
    if (recipients.length > 0) {
        await notificationService.notifyMany(recipients, {
            title: 'Nova Tarefa',
            message: `[${workspace.name}] Você foi vinculado à nova tarefa "${task.title}"`,
            type: 'TASK_CREATED',
            link: `/workspaces/${workspaceId}?taskId=${task.id}`,
            entityId: task.id,
        });
    }

    return reply.status(201).send(task);
  }

  // --- LIST ---
  async list(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.params);
    const userId = request.user.id;
    
    const isMember = await checkPermission(workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
    if (!isMember) return reply.status(403).send();

    const tasks = await prisma.task.findMany({
      where: { workspaceId },
      include: {
        assignees: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } } } },
        _count: { select: { checklist: true, notes: true, attachments: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return reply.send(tasks);
  }

  // --- DETAILS ---
  async details(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignees: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } } } },
        checklist: { orderBy: { id: 'asc' } },
        notes: { include: { author: { select: { id: true, firstName: true, avatar: true } } }, orderBy: { createdAt: 'desc' } },
        history: { include: { user: { select: { id: true, firstName: true } } }, orderBy: { createdAt: 'desc' } },
        attachments: true,
        creator: { select: { id: true, firstName: true } }
      }
    });

    if (!task) return reply.status(404).send({ message: 'Tarefa não encontrada' });

    // Garante que o usuário é membro do workspace da tarefa
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: task.workspaceId, userId } }
    });
    if (!member) return reply.status(403).send({ message: 'Sem permissão.' });

    // URL pública local de cada anexo (antes: presigned URL do R2)
    const attachmentsWithUrls = task.attachments.map((att) => ({
      ...att,
      signedUrl: getFileUrl(att.fileUrl),
    }));

    return reply.send({ ...task, attachments: attachmentsWithUrls });
  }

  // --- UPDATE ---
  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const data = updateTaskSchema.parse(request.body);
    const userId = request.user.id;

    // Incluimos Workspace para pegar o nome
    const oldTask = await prisma.task.findUnique({ 
        where: { id }, 
        include: { assignees: true, workspace: true } 
    });
    if (!oldTask) return reply.status(404).send();

    const canEdit = await checkPermission(oldTask.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canEdit) return reply.status(403).send();

    const changes: string[] = [];
    if (data.priority && data.priority !== oldTask.priority) changes.push(`Prioridade: ${data.priority}`);
    if (data.status && data.status !== oldTask.status) changes.push(`Status: ${data.status}`);
    if (data.dueDate && data.dueDate !== oldTask.dueDate?.toISOString()) changes.push(`Data: Alterada`);
    if (data.title && data.title !== oldTask.title) changes.push(`Título: ${data.title}`);

    const historyAction = changes.length > 0 ? `Atualizou: ${changes.join(', ')}` : 'Atualizou a tarefa';

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        history: { create: { action: historyAction, userId, metadata: data } }
      },
      include: { workspace: true, assignees: true } // Importante incluir no retorno também
    });

    if (changes.length > 0) {
        const recipients = getRecipients(updatedTask, userId);
        const userActor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });

        if (recipients.length > 0) {
            await notificationService.notifyMany(recipients, {
                title: 'Tarefa Atualizada',
                message: `[${updatedTask.workspace.name}] ${userActor?.firstName} atualizou "${updatedTask.title}" (${changes.join(', ')})`,
                type: 'TASK_UPDATE',
                link: `/workspaces/${updatedTask.workspaceId}?taskId=${id}`,
                entityId: id,
            });
        }
    }

    return reply.send(updatedTask);
  }

  // --- TOGGLE STATUS ---
  async toggleStatus(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'EXPIRED']) }).parse(request.body);
    const userId = request.user.id;

    // Incluindo Workspace
    const task = await prisma.task.findUnique({ where: { id }, include: { assignees: true, workspace: true } });
    if (!task) return reply.status(404).send();

    const canMove = await checkPermission(task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canMove) return reply.status(403).send();

    if (task.status === status) return reply.send(task);

    const updatedTask = await prisma.task.update({
      where: { id },
      data: { 
        status,
        history: { create: { action: `Moveu para ${status}`, userId } }
      }
    });

    const recipients = getRecipients(task, userId);
    const userActor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });

    if (recipients.length > 0) {
        await notificationService.notifyMany(recipients, {
            title: 'Status Alterado',
            message: `[${task.workspace.name}] ${userActor?.firstName} moveu "${task.title}" para ${status}`,
            type: 'TASK_STATUS',
            link: `/workspaces/${task.workspaceId}?taskId=${id}`,
            entityId: id,
        });
    }

    return reply.send(updatedTask);
  }

  // --- ADD ASSIGNEE ---
  async addAssignee(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { userId } = z.object({ userId: z.string() }).parse(request.body);
    const requesterId = request.user.id;

    const task = await prisma.task.findUnique({ where: { id }, include: { workspace: { include: { members: true } } } });
    if (!task) return reply.status(404).send();

    const canAssign = await checkPermission(task.workspaceId, requesterId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canAssign) return reply.status(403).send({ message: 'Sem permissão.' });

    // RBAC: usuário alvo deve ter permissão mínima de tasks:read
    const targetCanUseTasks = await userHasPermission(userId, 'tasks:read');
    if (!targetCanUseTasks) {
      return reply.status(400).send({ message: PERMISSION_MISSING_MESSAGE });
    }

    const assignee = await prisma.taskAssignee.create({
      data: { taskId: id, userId },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } }
    });

    await prisma.taskHistory.create({
      data: { taskId: id, userId: requesterId, action: `Adicionou ${assignee.user.firstName} como responsável` }
    });

    if (userId !== requesterId) {
        await notificationService.notify({
            userId: userId,
            title: 'Você foi atribuído',
            message: `[${task.workspace.name}] Você é responsável pela tarefa "${task.title}"`,
            type: 'TASK_ASSIGNED',
            link: `/workspaces/${task.workspaceId}?taskId=${id}`,
            entityId: id,
        });
    }

    return reply.status(201).send(assignee);
  }

  // --- REMOVE ASSIGNEE ---
  async removeAssignee(request: FastifyRequest, reply: FastifyReply) {
    const { id, userId: targetUserId } = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    const requesterId = request.user.id;

    const task = await prisma.task.findUnique({
        where: { id },
        include: { 
            workspace: { include: { members: true } },
            assignees: true 
        }
    });

    if (!task) return reply.status(404).send({ message: 'Task not found' });

    const requesterMember = task.workspace.members.find(m => m.userId === requesterId);
    
    const isSelf = requesterId === targetUserId;
    const isCreator = task.creatorId === requesterId;
    const isAdminOrOwner = requesterMember?.role === 'ADMIN' || requesterMember?.role === 'OWNER';

    if (!isSelf && !isCreator && !isAdminOrOwner) {
        return reply.status(403).send({ message: 'Permissão negada.' });
    }

    try {
      await prisma.taskAssignee.delete({
        where: { taskId_userId: { taskId: id, userId: targetUserId } }
      });
      
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { firstName: true } });
      const actionText = isSelf ? 'Saiu da tarefa' : `Removeu ${targetUser?.firstName} da tarefa`;

      await prisma.taskHistory.create({
        data: { taskId: id, userId: requesterId, action: actionText }
      });

      if (!isSelf) {
          await notificationService.notify({
              userId: targetUserId,
              title: 'Removido da Tarefa',
              message: `[${task.workspace.name}] Você foi removido da tarefa "${task.title}"`,
              type: 'TASK_UNASSIGNED',
              link: `/workspaces/${task.workspaceId}?taskId=${id}`,
              entityId: id,
          });
      }

      const recipients = getRecipients(task, requesterId); 
      const remainingRecipients = recipients.filter(uid => uid !== targetUserId); 
      const actor = await prisma.user.findUnique({ where: { id: requesterId }, select: { firstName: true } });

      if (remainingRecipients.length > 0) {
          await notificationService.notifyMany(remainingRecipients, {
              title: 'Responsáveis Atualizados',
              message: `[${task.workspace.name}] ${actor?.firstName} removeu ${targetUser?.firstName} da tarefa "${task.title}".`,
              type: 'TASK_UPDATE',
              link: `/workspaces/${task.workspaceId}?taskId=${id}`,
              entityId: id,
          });
      }

    } catch (_error) {
       return reply.status(404).send({ message: 'Usuário não encontrado.' });
    }

    return reply.status(204).send();
  }

  // --- UPLOAD ATTACHMENT ---
  async uploadAttachment(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;
    
    // Incluindo Workspace
    const task = await prisma.task.findUnique({ where: { id }, include: { assignees: true, workspace: true } });
    if (!task) return reply.status(404).send();

    const canUpload = await checkPermission(task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canUpload) return reply.status(403).send();

    const data = await request.file();
    if (!data) return reply.status(400).send();

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const fileBuffer = Buffer.concat(chunks);

    const fileKey = await saveFile(fileBuffer, {
        organizationId: request.user.organizationId ?? null,
        scope: 'tasks',
        originalName: data.filename,
    });

    const attachment = await prisma.taskAttachment.create({
        data: {
            taskId: id,
            uploaderId: userId,
            fileName: data.filename,
            fileType: data.mimetype,
            fileSize: fileBuffer.length,
            fileUrl: fileKey
        }
    });

    await prisma.taskHistory.create({
        data: { taskId: id, userId, action: `Anexou: "${data.filename}"` }
    });

    const recipients = getRecipients(task, userId);
    const uploader = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });

    if (recipients.length > 0) {
        await notificationService.notifyMany(recipients, {
            title: 'Novo Anexo',
            message: `[${task.workspace.name}] ${uploader?.firstName} anexou arquivo em "${task.title}"`,
            type: 'FILE_UPLOAD',
            link: `/workspaces/${task.workspaceId}?taskId=${id}`,
            entityId: id,
        });
    }

    return reply.status(201).send(attachment);
  }

  // --- DELETE ATTACHMENT ---
  async deleteAttachment(request: FastifyRequest, reply: FastifyReply) {
    const { attachmentId } = z.object({ attachmentId: z.string() }).parse(request.params);
    const userId = request.user.id;

    // Incluindo Workspace via Task
    const attachment = await prisma.taskAttachment.findUnique({ 
        where: { id: attachmentId }, 
        include: { task: { include: { assignees: true, workspace: true } } } 
    });
    
    if (!attachment) return reply.status(404).send();

    const canDelete = await checkPermission(attachment.task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canDelete) return reply.status(403).send();

    await prisma.taskAttachment.delete({ where: { id: attachmentId } });
    try {
        await deleteFile(attachment.fileUrl);
    } catch (_e) { /* ignore */ }
    
    await prisma.taskHistory.create({
        data: { taskId: attachment.taskId, userId, action: `Removeu anexo: "${attachment.fileName}"` }
    });

    const recipients = getRecipients(attachment.task, userId);
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });

    if (recipients.length > 0) {
        await notificationService.notifyMany(recipients, {
            title: 'Anexo Removido',
            message: `[${attachment.task.workspace.name}] ${actor?.firstName} removeu arquivo de "${attachment.task.title}"`,
            type: 'TASK_UPDATE',
            link: `/workspaces/${attachment.task.workspaceId}?taskId=${attachment.taskId}`,
            entityId: attachment.taskId,
        });
    }

    return reply.status(204).send();
  }

  // --- ADD CHECKLIST ---
  async addChecklistItem(request: FastifyRequest, reply: FastifyReply) {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { title } = createChecklistItemSchema.parse(request.body);
      const userId = request.user.id;
      
      const task = await prisma.task.findUnique({ where: { id }, include: { assignees: true, workspace: true } });
      if(!task) return reply.status(404).send();

      const canCreate = await checkPermission(task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
      if (!canCreate) return reply.status(403).send();

      const item = await prisma.checklistItem.create({ data: { taskId: id, title } });
      await prisma.taskHistory.create({ data: { taskId: id, userId, action: `Adicionou ao checklist: "${title}"` } });

      const recipients = getRecipients(task, userId);
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });
      
      if (recipients.length > 0) {
          await notificationService.notifyMany(recipients, {
              title: 'Checklist Atualizado',
              message: `[${task.workspace.name}] ${actor?.firstName} adicionou item na tarefa "${task.title}"`,
              type: 'TASK_UPDATE',
              link: `/workspaces/${task.workspaceId}?taskId=${id}`,
              entityId: id,
          });
      }

      return reply.status(201).send(item);
  }

  // --- UPDATE CHECKLIST ---
  async updateChecklistItem(request: FastifyRequest, reply: FastifyReply) {
      const { itemId } = z.object({ itemId: z.string() }).parse(request.params);
      const data = updateChecklistItemSchema.parse(request.body);
      const userId = request.user.id;
      
      const item = await prisma.checklistItem.findUnique({ 
          where: { id: itemId }, 
          include: { task: { include: { assignees: true, workspace: true } } } 
      });
      if (!item) return reply.status(404).send();

      const canUpdate = await checkPermission(item.task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
      if (!canUpdate) return reply.status(403).send();

      const updatedItem = await prisma.checklistItem.update({ where: { id: itemId }, data });
      
      if (data.isDone !== undefined) {
          const action = data.isDone ? `Concluiu: "${item.title}"` : `Reabriu: "${item.title}"`;
          await prisma.taskHistory.create({
              data: { taskId: item.taskId, userId, action }
          });

          if (data.isDone) {
            const recipients = getRecipients(item.task, userId);
            const actor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });
            if (recipients.length > 0) {
                await notificationService.notifyMany(recipients, {
                    title: 'Item Concluído',
                    message: `[${item.task.workspace.name}] ${actor?.firstName} completou "${item.title}" em "${item.task.title}"`,
                    type: 'CHECKLIST_DONE',
                    link: `/workspaces/${item.task.workspaceId}?taskId=${item.taskId}`,
                    entityId: item.taskId,
                });
            }
          }
      }
      return reply.send(updatedItem);
  }

  // --- ADD NOTE ---
  async addNote(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { content } = z.object({ content: z.string().min(1) }).parse(request.body);
    const userId = request.user.id;

    const task = await prisma.task.findUnique({ where: { id }, include: { assignees: true, workspace: true } });
    if (!task) return reply.status(404).send();

    const canComment = await checkPermission(task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (!canComment) return reply.status(403).send();

    const note = await prisma.taskNote.create({
      data: { taskId: id, content, authorId: userId },
      include: { author: { select: { id: true, firstName: true, avatar: true } } }
    });

    await prisma.taskHistory.create({ data: { taskId: id, userId, action: 'Comentou na tarefa' } });

    const recipients = getRecipients(task, userId);
    if (recipients.length > 0) {
        await notificationService.notifyMany(recipients, {
            title: 'Novo Comentário',
            message: `[${task.workspace.name}] ${note.author.firstName} comentou em "${task.title}"`,
            type: 'TASK_COMMENT',
            link: `/workspaces/${task.workspaceId}?taskId=${id}`,
            entityId: id,
        });
    }

    return reply.status(201).send(note);
  }

  // --- DELETE TASK ---
  async delete(request: FastifyRequest, reply: FastifyReply) {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const userId = request.user.id;
      
      const task = await prisma.task.findUnique({ where: { id }, include: { assignees: true, workspace: true } });
      if (!task) return reply.status(404).send();

      const canDelete = await checkPermission(task.workspaceId, userId, ['OWNER', 'ADMIN']);
      if (!canDelete) return reply.status(403).send();

      const recipients = getRecipients(task, userId);
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });
      
      if (recipients.length > 0) {
          await notificationService.notifyMany(recipients, {
              title: 'Tarefa Excluída',
              message: `[${task.workspace.name}] ${actor?.firstName} excluiu a tarefa "${task.title}"`,
              type: 'TASK_DELETED',
              link: `/workspaces/${task.workspaceId}`,
              entityId: id,
          });
      }

      await prisma.task.delete({ where: { id } });
      return reply.status(204).send();
  }

  // --- DELETE CHECKLIST ITEM ---
  async deleteChecklistItem(request: FastifyRequest, reply: FastifyReply) {
      const { itemId } = z.object({ itemId: z.string() }).parse(request.params);
      const userId = request.user.id;

      const item = await prisma.checklistItem.findUnique({
          where: { id: itemId },
          include: { task: { include: { assignees: true, workspace: true } } }
      });
      if (!item) return reply.status(404).send();

      const canDelete = await checkPermission(item.task.workspaceId, userId, ['OWNER', 'ADMIN', 'MEMBER']);
      if (!canDelete) return reply.status(403).send();

      await prisma.checklistItem.delete({ where: { id: itemId } });
      await prisma.taskHistory.create({
          data: { taskId: item.taskId, userId, action: `Removeu do checklist: "${item.title}"` }
      });

      return reply.status(204).send();
  }

  // --- DELETE NOTE ---
  async deleteNote(request: FastifyRequest, reply: FastifyReply) {
      const { taskId, noteId } = z.object({ taskId: z.string(), noteId: z.string() }).parse(request.params);
      const userId = request.user.id;

      const note = await prisma.taskNote.findUnique({
          where: { id: noteId },
          include: { task: { include: { workspace: true } } }
      });
      if (!note || note.taskId !== taskId) return reply.status(404).send();

      const isAuthor = note.authorId === userId;
      const canDelete = isAuthor || await checkPermission(note.task.workspaceId, userId, ['OWNER', 'ADMIN']);
      if (!canDelete) return reply.status(403).send();

      await prisma.taskNote.delete({ where: { id: noteId } });
      await prisma.taskHistory.create({
          data: { taskId, userId, action: 'Removeu um comentário' }
      });

      return reply.status(204).send();
  }
}