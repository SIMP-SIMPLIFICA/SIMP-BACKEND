import { prisma } from '../lib/prisma.js';
import type { FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';
import { EventEmitter } from 'events';

class NotificationService extends EventEmitter {
  private clients: Map<string, (FastifyReply & { raw: ServerResponse })[]> = new Map();

  addClient(userId: string, reply: FastifyReply & { raw: ServerResponse }) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, []);
    }
    this.clients.get(userId)?.push(reply);

    reply.raw.on('close', () => {
      this.removeClient(userId, reply);
    });
  }

  removeClient(userId: string, reply: FastifyReply & { raw: ServerResponse }) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      this.clients.set(userId, userClients.filter(c => c !== reply));
    }
  }

  async notify(data: { userId: string; title: string; message: string; type: string; link?: string }) {
    // 1. Salvar no Banco
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type,
        link: data.link,
        read: false
      }
    });

    // 2. Enviar Real-time (se o usuário estiver online)
    const userClients = this.clients.get(data.userId);
    if (userClients && userClients.length > 0) {
      const payload = `data: ${JSON.stringify(notification)}\n\n`;
      userClients.forEach(client => client.raw.write(payload));
    }

    return notification;
  }

  // Helper para notificar múltiplos usuários
  async notifyMany(userIds: string[], data: { title: string; message: string; type: string; link?: string }) {
    return Promise.all(userIds.map(id => this.notify({ ...data, userId: id })));
  }
}

export const notificationService = new NotificationService();