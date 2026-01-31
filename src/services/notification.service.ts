import { prisma } from '../lib/prisma';

export class NotificationService {
  
  /**
   * Cria uma notificação no banco de dados
   */
  static async notify(data: {
    userId: string;
    title: string;
    message: string;
    type: string;
    link?: string;
  }) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type,
          link: data.link
        }
      });
      
      // Futuro: Aqui entra o disparo de WebSocket/Socket.io
      return notification;
    } catch (error) {
      console.error("Erro ao criar notificação:", error);
    }
  }

  static async markAsRead(notificationId: string) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { read: true }
    });
  }
}