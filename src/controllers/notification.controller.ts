import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { notificationService } from '../services/notification.service.js';
import { z } from 'zod';

export class NotificationController {

  stream(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;

    // --- CORREÇÃO DEFINITIVA DO CORS PARA SSE ---
    // Como estamos hijackando a resposta, precisamos definir os headers manualmente.
    // O plugin @fastify/cors não injeta headers aqui automaticamente.

    // Pega a origem de quem está chamando (ex: http://localhost:5173)
    const origin = request.headers.origin || '*';

    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Evita buffer em Nginx/Proxies
      // Headers de CORS manuais:
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true'
    };

    // Assume o controle da resposta
    reply.hijack();

    // Escreve o status 200 e os headers combinados (SSE + CORS)
    reply.raw.writeHead(200, headers);

    // Envia a primeira mensagem para confirmar a conexão
    reply.raw.write('retry: 10000\n\n');

    // Registra o cliente no serviço para receber futuras notificações
    notificationService.addClient(userId, reply);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;


    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, read: false }
    });

    return reply.send({ data: notifications, unreadCount });
  }

  async markAsRead(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = request.user.id;

    await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true }
    });

    return reply.send({ success: true });
  }

  async markAllRead(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;

    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });

    return reply.send({ success: true });
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const userId = (request.user as any).id;

    await prisma.notification.deleteMany({
      where: { id, userId }
    });

    return reply.code(204).send();
  }

  async deleteAll(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request.user as any).id;

    await prisma.notification.deleteMany({
      where: { userId }
    });

    return reply.code(204).send();
  }
}