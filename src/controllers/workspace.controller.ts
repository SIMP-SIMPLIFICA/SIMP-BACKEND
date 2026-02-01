import { FastifyReply, FastifyRequest } from 'fastify';
<<<<<<< Updated upstream
import { prisma } from '../lib/prisma.js'; // Atenção ao .js
import { createWorkspaceSchema, addMemberSchema } from '../schemas/workspace.schemas.js';
=======
import { prisma } from '../lib/prisma.js';
>>>>>>> Stashed changes
import { z } from 'zod';
import { createWorkspaceSchema } from '../schemas/workspace.schemas.js';
import { notificationService } from '../services/notification.service.js';

export class WorkspaceController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
<<<<<<< Updated upstream
    const { name, description } = createWorkspaceSchema.parse(request.body);
    const userId = request.user.id;

    const slug = name.toLowerCase().replace(/ /g, '-') + '-' + Date.now();
=======
    const data = createWorkspaceSchema.parse(request.body);
    const userId = (request.user as any).id;
    
    const baseSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const uniqueSuffix = Date.now().toString().slice(-4);
    const slug = `${baseSlug}-${uniqueSuffix}`;
>>>>>>> Stashed changes

    const workspace = await prisma.workspace.create({
      data: {
        name: data.name,
        description: data.description,
        slug,
        members: {
          create: {
            userId,
            role: 'OWNER'
          }
        }
      }
    });

    return reply.status(201).send(workspace);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;

    const workspaces = await prisma.workspace.findMany({
<<<<<<< Updated upstream
      where: {
        members: {
          some: { userId }
        }
      },
      include: {
        _count: {
          select: { tasks: true, members: true }
        }
      }
=======
      where: { members: { some: { userId } } },
      include: { _count: { select: { members: true, tasks: true } } },
      orderBy: { createdAt: 'desc' }
>>>>>>> Stashed changes
    });

    return reply.send(workspaces);
  }

  // --- NOVO MÉTODO: GET BY ID ---
  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;

    // Verifica se o usuário é membro do workspace
    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        members: { some: { userId } }
      },
      include: {
<<<<<<< Updated upstream
        members: { include: { user: true } }, // Inclui dados dos membros
=======
        members: { include: { user: { select: { id: true, firstName: true, email: true, avatar: true } } } },
>>>>>>> Stashed changes
        _count: { select: { tasks: true } }
      }
    });

<<<<<<< Updated upstream
    if (!workspace) {
      return reply.status(404).send({ message: 'Workspace não encontrado ou sem permissão' });
    }

=======
    if (!workspace) return reply.status(404).send({ message: 'Workspace não encontrado' });
>>>>>>> Stashed changes
    return reply.send(workspace);
  }
  // -----------------------------

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
<<<<<<< Updated upstream
    const { email, role } = addMemberSchema.parse(request.body);
=======
    const userId = (request.user as any).id;
    
    const requester = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } },
        include: { workspace: true }
    });

    if (!requester || (requester.role !== 'OWNER' && requester.role !== 'ADMIN')) {
        return reply.status(403).send({ message: 'Apenas admins podem convidar membros.' });
    }

    const bodySchema = z.object({
      email: z.string().email(),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
    });
    const { email, role } = bodySchema.parse(request.body);
>>>>>>> Stashed changes

    const userToAdd = await prisma.user.findUnique({ where: { email } });
    
    if (!userToAdd) {
      return reply.status(404).send({ message: 'Usuário não encontrado' });
    }

    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId: id,
        userId: userToAdd.id,
        role: role as any
      }
    });

    await notificationService.notify({
        userId: userToAdd.id,
        title: 'Novo Workspace',
        message: `Você foi adicionado ao workspace "${requester.workspace.name}"`,
        type: 'WORKSPACE_INVITE',
        link: `/workspaces/${id}`
    });

    return reply.status(201).send(member);
  }
<<<<<<< Updated upstream
=======

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    const paramsSchema = z.object({
      id: z.string(),       
      userId: z.string()    
    });
    
    const { id, userId: targetUserId } = paramsSchema.parse(request.params);
    const requesterId = (request.user as any).id;

    const requesterMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: requesterId } }
    });

    if (!requesterMember) {
        return reply.status(403).send({ message: 'Você não é membro deste workspace.' });
    }

    const targetMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
        include: { workspace: true }
    });

    if (!targetMember) {
        return reply.status(404).send({ message: 'Membro alvo não encontrado.' });
    }

    const isSelf = requesterId === targetUserId; 
    const isOwner = requesterMember.role === 'OWNER';
    const isAdmin = requesterMember.role === 'ADMIN';

    if (targetMember.role === 'OWNER') {
        return reply.status(400).send({ message: 'O dono do workspace não pode ser removido.' });
    }

    if (!isSelf && !isOwner && !isAdmin) {
        return reply.status(403).send({ message: 'Você não tem permissão para remover este membro.' });
    }

    await prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } }
    });

    if (!isSelf) {
        await notificationService.notify({
            userId: targetUserId,
            title: 'Removido do Workspace',
            message: `Você foi removido do workspace "${targetMember.workspace.name}"`,
            type: 'WORKSPACE_REMOVED',
            link: `/workspaces` 
        });
    }

    return reply.status(204).send();
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } }
    });

    if (!member || member.role !== 'OWNER') {
      return reply.status(403).send({ message: 'Apenas o dono pode excluir o workspace' });
    }

    await prisma.workspace.delete({ where: { id } });
    return reply.status(204).send();
  }
>>>>>>> Stashed changes
}