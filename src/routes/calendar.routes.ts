import { FastifyInstance } from 'fastify'
import { CalendarController } from '@/controllers/calendar.controller'
import { requireModule } from '@/middleware/auth.middleware.js'

export async function calendarRoutes(app: FastifyInstance) {
    const controller = new CalendarController()

    // Middleware de autenticação padrão (igual as outras rotas)
    app.addHook('onRequest', async (request, reply) => {
        try {
            await request.jwtVerify()
            const user = request.user as any
            if (user && user.sub && !user.id) {
                user.id = user.sub
            }
        } catch (err) {
            reply.send(err)
        }
    })
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
