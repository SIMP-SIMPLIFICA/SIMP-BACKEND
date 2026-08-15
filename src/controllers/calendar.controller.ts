import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { calendarEventIdSchema, createCalendarEventSchema, updateCalendarEventSchema } from '../schemas/calendar.schemas.js';
import { notificationService } from '../services/notification.service.js';
import { z } from 'zod';

export class CalendarController {

    // --- LIST ---
    async list(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.user.id;

        // Filtros opcionais de data
        const querySchema = z.object({
            start: z.string().optional(),
            end: z.string().optional()
        });

        const { start, end } = querySchema.parse(request.query);

        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
        const whereClause: any = { userId, ...orgFilter };

        if (start && end) {
            whereClause.startAt = {
                gte: new Date(start),
                lte: new Date(end)
            };
        }

        const events = await prisma.calendarEvent.findMany({
            where: whereClause,
            include: { attachments: true },
            orderBy: { startAt: 'asc' }
        });

        return reply.send(events);
    }

    // --- CREATE ---
    async create(request: FastifyRequest, reply: FastifyReply) {
        const { attachments, ...data } = createCalendarEventSchema.parse(request.body);
        const userId = request.user.id;

        const event = await prisma.calendarEvent.create({
            data: {
                title: data.title,
                description: data.description,
                ...data,
                startAt: new Date(data.startAt),
                endAt: data.endAt ? new Date(data.endAt) : null,
                ...(request.user.organizationId && { organization: { connect: { id: request.user.organizationId } } }),
                user: { connect: { id: userId } },
                attachments: attachments ? {
                    create: attachments as any
                } : undefined
            },
            include: { attachments: true }
        });

        // Dispara notificação se o evento for hoje ou amanhã
        const eventDate = new Date(event.startAt);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Zera as horas para comparar apenas os dias
        eventDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        tomorrow.setHours(0, 0, 0, 0);

        if (eventDate.getTime() === today.getTime() || eventDate.getTime() === tomorrow.getTime()) {
            const dayLabel = eventDate.getTime() === today.getTime() ? 'HOJE' : 'AMANHÃ';

            await notificationService.notify({
                userId: userId,
                title: `Compromisso Agendado para ${dayLabel}`,
                message: `Lembrete: "${event.title}" está agendado para o dia ${new Date(event.startAt).toLocaleDateString('pt-BR')}.`,
                type: 'CALENDAR_ALERT',
                link: `/utilities/calendar?eventId=${event.id}`,
                entityId: event.id,
            });
        }

        return reply.status(201).send(event);
    }

    // --- UPDATE ---
    async update(request: FastifyRequest, reply: FastifyReply) {
        const { id } = calendarEventIdSchema.parse(request.params);
        const { attachments, ...data } = updateCalendarEventSchema.parse(request.body);
        const userId = request.user.id;

        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
        const event = await prisma.calendarEvent.findFirst({ where: { id, userId, ...orgFilter } });

        if (!event) return reply.status(404).send({ message: 'Evento não encontrado' });

        const updatedEvent = await prisma.calendarEvent.update({
            where: { id },
            data: {
                ...data,
                startAt: data.startAt ? new Date(data.startAt) : undefined,
                endAt: data.endAt !== undefined ? (data.endAt ? new Date(data.endAt) : null) : undefined,
                attachments: attachments ? {
                    deleteMany: {}, // Simplification for now: delete all and recreate
                    create: attachments as any
                } : undefined
            },
            include: { attachments: true }
        });

        return reply.send(updatedEvent);
    }

    // --- DELETE ---
    async delete(request: FastifyRequest, reply: FastifyReply) {
        const { id } = calendarEventIdSchema.parse(request.params);
        const userId = request.user.id;

        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
        const event = await prisma.calendarEvent.findFirst({ where: { id, userId, ...orgFilter } });

        if (!event) return reply.status(404).send({ message: 'Evento não encontrado' });

        await prisma.calendarEvent.delete({ where: { id } });

        return reply.status(204).send();
    }

    // --- TODAY ALERTS (Upcoming events for badge/notification bar) ---
    async getTodayAlerts(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.user.id;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const afterTomorrow = new Date(today);
        afterTomorrow.setDate(today.getDate() + 2);

        const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId };
        const events = await prisma.calendarEvent.findMany({
            where: {
                userId,
                ...orgFilter,
                startAt: {
                    gte: today,
                    lt: afterTomorrow
                }
            },
            include: { attachments: true },
            orderBy: { startAt: 'asc' }
        });

        return reply.send(events);
    }
}
