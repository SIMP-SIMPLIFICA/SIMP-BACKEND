import { FastifyInstance } from 'fastify'
import { CalendarController } from '@/controllers/calendar.controller'
import { authenticate, requireModule } from '@/middleware/auth.middleware.js'

export async function calendarRoutes(app: FastifyInstance) {
    const controller = new CalendarController()

    // Middleware compartilhado em vez de hook próprio. O hook anterior:
    //  1. devolvia o erro cru com reply.send(err), expondo stack trace (CodeQL);
    //  2. omitia a normalização de organizationId, o mesmo defeito que causou o
    //     vazamento entre organizações no módulo de Comunicação (Épico 1);
    //  3. contornava o kill switch de organização suspensa (Épico 3).
    app.addHook('preHandler', authenticate)
    app.addHook('preHandler', requireModule('calendar'))

    app.get('/', {
        schema: {
            tags: ['Calendar'],
            description: 'List user calendar events'
        }
    }, controller.list.bind(controller))

    app.post('/', {
        schema: {
            tags: ['Calendar'],
            description: 'Create a calendar event'
        }
    }, controller.create.bind(controller))

    app.put('/:id', {
        schema: {
            tags: ['Calendar'],
            description: 'Update a calendar event'
        }
    }, controller.update.bind(controller))

    app.delete('/:id', {
        schema: {
            tags: ['Calendar'],
            description: 'Delete a calendar event'
        }
    }, controller.delete.bind(controller))

    app.get('/today-alerts', {
        schema: {
            tags: ['Calendar'],
            description: 'Get events happening today or tomorrow for notifications'
        }
    }, controller.getTodayAlerts.bind(controller))
}
