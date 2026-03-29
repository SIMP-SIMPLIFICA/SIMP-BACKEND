import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export class PublicController {

    async validateDocument(request: FastifyRequest<{ Params: { hash: string } }>, reply: FastifyReply) {
        const { hash } = request.params

        if (!hash) return reply.code(400).send({ message: 'Hash não fornecido' })

        const document = await prisma.communicationDocument.findFirst({
            where: {
                OR: [
                    { originalHash: hash },
                    { signatures: { some: { sealData: { path: ['hash'], equals: hash } } } } // Se quisermos validar pelo hash da assinatura também
                ]
            },
            select: {
                id: true,
                protocolNumber: true,
                title: true,
                documentType: true,
                sentAt: true,
                status: true,
                creator: {
                    select: { firstName: true, lastName: true, jobTitle: true }
                },
                signatures: {
                    where: { isValid: true },
                    select: {
                        signedAt: true,
                        user: { select: { firstName: true, lastName: true, jobTitle: true } },
                        sealData: true
                    }
                },
                originalHash: true
            }
        }) as any

        if (!document) {
            return reply.code(404).send({ valid: false, message: 'Documento não encontrado ou hash inválido.' })
        }

        return reply.send({
            valid: true,
            protocol: document.protocolNumber,
            type: document.documentType,
            date: document.sentAt,
            signer: `${document.creator.firstName} ${document.creator.lastName}`,
            signatures: document.signatures.map(s => ({
                name: `${s.user.firstName} ${s.user.lastName}`,
                role: s.user.jobTitle,
                date: s.signedAt,
                hash: (s.sealData as any)?.hash
            }))
        })
    }
}
