import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'

const updateSettingsSchema = z.object({
    MayorName: z.string().optional(),
    CityAddress: z.string().optional(),
    CoatOfArmsUrl: z.string().optional()
})

export class SettingsController {
    async getPublicSettings(request: FastifyRequest, reply: FastifyReply) {
        try {
            const settings = await prisma.setting.findMany({
                where: { isPublic: true }
            })

            // Convert array to object
            const settingsMap = settings.reduce((acc, curr) => {
                acc[curr.key] = curr.value
                return acc
            }, {} as Record<string, any>)

            return reply.send(settingsMap)
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to fetch settings' })
        }
    }

    async updateSettings(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = updateSettingsSchema.parse(request.body)
            const results = []

            for (const [key, value] of Object.entries(data)) {
                if (value === undefined) continue;
                
                const setting = await prisma.setting.upsert({
                    where: { key },
                    update: { value: value },
                    create: {
                        key,
                        value: value,
                        type: 'string',
                        isPublic: true // Default to public for these header settings
                    }
                })
                results.push(setting)
            }

            return reply.send({ message: 'Settings updated', settings: results })
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to update settings' })
        }
    }
}

export const settingsController = new SettingsController()
