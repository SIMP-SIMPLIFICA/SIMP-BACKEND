import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js'; // Atenção ao .js
import { createWorkspaceSchema, addMemberSchema } from '../schemas/workspace.schemas.js';
import { z } from 'zod';

export class WorkspaceController {
  
  async create(request: FastifyRequest, reply: FastifyReply) {
    const { name, description } = createWorkspaceSchema.parse(request.body);
    const userId = request.user.id;

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
    const userId = request.user.id;

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
        members: { include: { user: true } }, // Inclui dados dos membros
        _count: { select: { tasks: true } }
      }
    });

    if (!workspace) {
      return reply.status(404).send({ message: 'Workspace não encontrado ou sem permissão' });
    }

    return reply.send(workspace);
  }
  // -----------------------------

  async addMember(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { email, role } = addMemberSchema.parse(request.body);

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

    return reply.status(201).send(member);
  }
}