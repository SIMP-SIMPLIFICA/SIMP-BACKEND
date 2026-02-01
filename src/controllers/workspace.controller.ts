import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { createWorkspaceSchema } from '../schemas/workspace.schemas.js'; // Mantendo schemas existentes
import { z } from 'zod';

export class WorkspaceController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { name, description } = createWorkspaceSchema.parse(request.body);
    const userId = (request.user as any).id;

    // Gera um slug simples
    const slug = name.toLowerCase().replace(/ /g, '-') + '-' + Date.now();

    const workspace = await prisma.workspace.create({
      data: {
        name,
        description,
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
    const userId = (request.user as any).id;

    const workspaces = await prisma.workspace.findMany({
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
    });

    return reply.send(workspaces);
  }

  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    // Verifica se o usuário é membro do workspace para poder visualizar
    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        members: { some: { userId } }
      },
      include: {
        members: { include: { user: true } }, // Retorna os membros para mostrar no front
        _count: { select: { tasks: true } }
      }
    });

    if (!workspace) {
      return reply.status(404).send({ message: 'Workspace not found or permission denied' });
    }

    return reply.send(workspace);
  }

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const paramsSchema = z.object({ id: z.string() });
    const bodySchema = z.object({
      email: z.string().email(),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
    });

    const { id } = paramsSchema.parse(request.params);
    const { email, role } = bodySchema.parse(request.body);

    // 1. Busca usuário pelo email
    const userToAdd = await prisma.user.findUnique({ where: { email } });
    
    if (!userToAdd) {
      return reply.status(404).send({ message: 'User not found with this email' });
    }

    // 2. Verifica se já é membro deste workspace
    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: id,
          userId: userToAdd.id
        }
      }
    });

    if (existingMember) {
      return reply.status(409).send({ message: 'User is already a member of this workspace' });
    }

    // 3. Adiciona
    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId: id,
        userId: userToAdd.id,
        role: role as any
      },
      include: {
        user: { select: { id: true, firstName: true, email: true, avatar: true } }
      }
    });

    return reply.status(201).send(member);
  }

  // NOVO MÉTODO: DELETE
  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    // Verifica permissão (apenas OWNER ou ADMIN pode deletar)
    const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } }
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
        return reply.status(403).send({ message: 'Permission denied to delete workspace' });
    }

    await prisma.workspace.delete({
      where: { id }
    });

    return reply.status(204).send();
  }
}