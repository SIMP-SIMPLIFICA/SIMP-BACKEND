import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createWorkspaceSchema } from '../schemas/workspace.schemas.js';
import { notificationService } from '../services/notification.service.js';
import { userHasPermission, getUsersWithPermission, PERMISSION_MISSING_MESSAGE } from '../services/rbac.service.js';

export class WorkspaceController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createWorkspaceSchema.parse(request.body);
    const userId = request.user.id;
    
    const baseSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const uniqueSuffix = Date.now().toString().slice(-4);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const workspace = await prisma.workspace.create({
      data: {
        name: data.name,
        description: data.description,
        slug,
        organizationId: request.user.organizationId,
        members: { create: { userId, role: 'OWNER' } }
      }
    });
    return reply.status(201).send(workspace);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
    const workspaces = await prisma.workspace.findMany({
      where: { members: { some: { userId } }, ...orgFilter },
      include: { _count: { select: { members: true, tasks: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return reply.send(workspaces);
  }

  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
    const workspace = await prisma.workspace.findFirst({
      where: { id, members: { some: { userId } }, ...orgFilter },
      include: {
        members: { include: { user: { select: { id: true, firstName: true, email: true, avatar: true } } } },
        _count: { select: { tasks: true } }
      }
    });
    if (!workspace) return reply.status(404).send({ message: 'Workspace não encontrado' });
    return reply.send(workspace);
  }

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };

    const workspace = await prisma.workspace.findFirst({ where: { id, ...orgFilter } });
    if (!workspace) return reply.status(404).send({ message: 'Workspace não encontrado' });

    const requester = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } },
    });

    // REGRA: Apenas OWNER e ADMIN podem adicionar (Membro e Viewer não)
    if (!requester || (requester.role !== 'OWNER' && requester.role !== 'ADMIN')) {
        return reply.status(403).send({ message: 'Apenas Admins podem convidar membros.' });
    }

    const { email, role } = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER') }).parse(request.body);
    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) return reply.status(404).send({ message: 'Usuário não encontrado' });

    // REGRA: usuário convidado deve pertencer à mesma organização
    if (!request.user.isSuperAdmin && userToAdd.organizationId !== request.user.organizationId) {
        return reply.status(403).send({ message: 'Usuário não pertence a esta organização.' });
    }

    // RBAC: usuário alvo deve ter permissão mínima de workspaces:read
    const canUseWorkspaces = await userHasPermission(userToAdd.id, 'workspaces:read');
    if (!canUseWorkspaces) {
      return reply.status(400).send({ message: PERMISSION_MISSING_MESSAGE });
    }

    const member = await prisma.workspaceMember.create({
      data: { workspaceId: id, userId: userToAdd.id, role: role as any }
    });

    await notificationService.notify({
        userId: userToAdd.id,
        title: 'Novo Workspace',
        message: `Você foi adicionado ao workspace "${workspace?.name}"`,
        type: 'WORKSPACE_INVITE',
        link: `/workspaces/${id}`,
        entityId: id,
    });
    return reply.status(201).send(member);
  }

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    const { id, userId: targetUserId } = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    const requesterId = request.user.id;

    const requesterMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: requesterId } }
    });

    if (!requesterMember) return reply.status(403).send({ message: 'Você não é membro deste workspace.' });

    const targetMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } },
        include: { workspace: true }
    });

    if (!targetMember) return reply.status(404).send({ message: 'Membro alvo não encontrado.' });

    const isSelf = requesterId === targetUserId; 
    const isOwner = requesterMember.role === 'OWNER';
    const isAdmin = requesterMember.role === 'ADMIN';

    // REGRA: Membros e Viewers não removem ninguém (exceto a si mesmos)
    // REGRA: Admin não remove Owner
    if (targetMember.role === 'OWNER') return reply.status(400).send({ message: 'O dono do workspace não pode ser removido.' });
    
    if (!isSelf && !isOwner && !isAdmin) {
        return reply.status(403).send({ message: 'Você não tem permissão para remover usuários.' });
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
            link: `/workspaces`,
            entityId: id,
        });
    }

    return reply.status(204).send();
  }

  // REGRA: APENAS OWNER DELETA WORKSPACE
  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };

    const workspace = await prisma.workspace.findFirst({ where: { id, ...orgFilter } });
    if (!workspace) return reply.status(404).send({ message: 'Workspace não encontrado' });

    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } });

    if (member?.role !== 'OWNER') {
        return reply.status(403).send({ message: 'Apenas o CRIADOR (Dono) pode excluir o workspace' });
    }

    await prisma.workspace.delete({ where: { id } });
    return reply.status(204).send();
  }

  async listAssignableUsers(request: FastifyRequest, reply: FastifyReply) {
    const params = z.object({ workspaceId: z.string().optional(), id: z.string().optional() }).parse(request.params);
    const workspaceId = params.workspaceId || params.id;
    if (!workspaceId) return reply.status(400).send({ message: "Workspace ID is required" });
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
    const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, ...orgFilter } });
    if (!workspace) return reply.status(404).send({ message: 'Workspace não encontrado' });
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } } },
      orderBy: { user: { firstName: 'asc' } }
    });
    const users = members.map(m => m.user);
    const permitted = await getUsersWithPermission(users.map(u => u.id), 'tasks:read');
    return reply.send(users.map(u => ({ ...u, hasPermission: permitted.has(u.id) })));
  }
}