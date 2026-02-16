
import Fastify from 'fastify'
import { registerPlugins } from '../src/config/plugins.js'
import { registerRoutes } from '../src/config/routes.js'
import { config } from '../src/config/config.js'
import { communicationRoutes } from '../src/routes/communication.routes.js'

async function run() {
    const server = Fastify({
        logger: false // Keep it clean for output
    })

    // We need config to enable swagger
    config.isDevelopment = true
    config.features.swagger = true

    // Mock DB to avoid connection errors if possible
    // But plugins might try to use it. 
    // For this reproduction, we hope plugins don't crash on DB during registration.
    // Actually, plugins might verify db connection. passing { ... }

    // Let's try to just register plugins and the problematic route
    // We need to register plugins because it registers swagger

    // Hack: mock db if needed, but db is imported in plugins.ts
    // We'll see if it crashes.

    try {
        await registerPlugins(server)
        await server.register(communicationRoutes, { prefix: '/api/v1/communication' })

        await server.ready()

        const response = await server.inject({
            method: 'GET',
            url: '/documentation/json'
        })

        console.log('Status Code:', response.statusCode)
        if (response.statusCode === 500) {
            console.error('Response Body:', response.body)
        } else {
            console.log('Success! JSON length:', response.body.length)
        }

    } catch (error) {
        console.error('Crash during startup or request:', error)
    }
}

run()
