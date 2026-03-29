import { FastifyInstance } from 'fastify'
import { PublicController } from '@/controllers/public.controller'
import { z } from 'zod'

const controller = new PublicController()

export async function publicRoutes(app: FastifyInstance) {

    app.get('/validate/:hash', {
        schema: {
            tags: ['Public'],
            description: 'Valida a autenticidade de um documento pelo Hash',
            params: z.object({
                hash: z.string().describe('Hash SHA-256 do documento ou assinatura')
            }),
            response: {
                200: z.object({
                    valid: z.boolean(),
                    protocol: z.string().optional(),
                    type: z.string().optional(),
                    date: z.string().optional(),
                    signer: z.string().optional(),
                    signatures: z.array(z.object({
                        name: z.string(),
                        role: z.string().nullable(),
                        date: z.string(),
                        hash: z.string().optional()
                    })).optional()
                }),
                404: z.object({
                    valid: z.boolean(),
                    message: z.string()
                })
            }
        }
    }, controller.validateDocument.bind(controller))

}
