import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { createWorkspaceSchema } from '../schemas/workspace.schemas.js';
import { z } from 'zod';

export class WorkspaceController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { name, description } = createWorkspaceSchema.parse(request.body);
    const userId = (request.user as any).id;

    const slug = name.toLowerCase().replace(/ /g, '-') + '-' + Date.now();

    const workspace = await prisma.workspace.create({
      data: {
        name,
        description,
        slug,
        members: {
          create: { userId, role: 'OWNER' }
        }
      }
    });

    return reply.status(201).send(workspace);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request.user as any).id;
    const workspaces = await prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include: {
        _count: { select: { tasks: true, members: true } }
      }
    });
    return reply.send(workspaces);
  }

  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    const workspace = await prisma.workspace.findFirst({
      where: { id, members: { some: { userId } } },
      include: {
        members: { include: { user: { select: { id: true, firstName: true, email: true, avatar: true } } } }, 
        _count: { select: { tasks: true } }
      }
    });

    if (!workspace) {
      return reply.status(404).send({ message: 'Workspace não encontrado ou permissão negada' });
    }

    return reply.send(workspace);
  }

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;
    
    const requester = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } }
    });

    if (!requester || (requester.role !== 'OWNER' && requester.role !== 'ADMIN')) {
        return reply.status(403).send({ message: 'Apenas admins podem convidar membros.' });
    }

    const bodySchema = z.object({
      email: z.string().email(),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
    });
    const { email, role } = bodySchema.parse(request.body);

    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) return reply.status(404).send({ message: 'Usuário não encontrado' });

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId: userToAdd.id } }
    });
    if (existing) return reply.status(409).send({ message: 'Usuário já está no workspace' });

    const member = await prisma.workspaceMember.create({
      data: { workspaceId: id, userId: userToAdd.id, role: role as any },
      include: { user: { select: { id: true, firstName: true, email: true, avatar: true } } }
    });

    return reply.status(201).send(member);
  }

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    const paramsSchema = z.object({
      id: z.string(),       // ID do Workspace
      userId: z.string()    // ID do Usuário a ser removido (Target)
    });
    
    const { id, userId: targetUserId } = paramsSchema.parse(request.params);
    const requesterId = (request.user as any).id; // Quem está fazendo a requisição

    console.log(`[RemoveMember] Workspace: ${id} | Requester: ${requesterId} | Target: ${targetUserId}`);

    // 1. Busca o membro que está FAZENDO a requisição
    const requesterMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: requesterId } }
    });

    if (!requesterMember) {
        return reply.status(403).send({ message: 'Você não é membro deste workspace.' });
    }

    // 2. Busca o membro que será REMOVIDO
    const targetMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } }
    });

    if (!targetMember) {
        return reply.status(404).send({ message: 'Membro alvo não encontrado.' });
    }

    // 3. Regras de Permissão
    const isSelf = requesterId === targetUserId; // A pessoa está saindo?
    const isOwner = requesterMember.role === 'OWNER';
    const isAdmin = requesterMember.role === 'ADMIN';

    // Regra A: O Dono do workspace NUNCA pode ser removido (nem por ele mesmo, ele deve deletar o workspace)
    if (targetMember.role === 'OWNER') {
        return reply.status(400).send({ message: 'O dono do workspace não pode sair ou ser removido. Transfira a propriedade ou delete o workspace.' });
    }

    // Regra B: Se NÃO for ele mesmo saindo, tem que ser Admin ou Dono para expulsar
    if (!isSelf && !isOwner && !isAdmin) {
        return reply.status(403).send({ message: 'Você não tem permissão para remover este membro.' });
    }

    // Executa a remoção
    await prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } }
    });

    return reply.status(204).send();
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } }
    });

    if (!membership || membership.role !== 'OWNER') {
        return reply.status(403).send({ message: 'Apenas o DONO pode deletar o workspace.' });
    }

    await prisma.workspace.delete({ where: { id } });
    return reply.status(204).send();
  }
}