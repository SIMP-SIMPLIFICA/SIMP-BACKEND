import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { logger, logSecurity } from './logger.js'

export const errorHandler = (
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
) => {
    const requestId = request.id
    const statusCode = error.statusCode || 500
    const isProduction = process.env.NODE_ENV === 'production'

    if (error.validation) {
        return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Erro de validação nos dados enviados',
            details: error.validation,
            requestId
        })
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2002':
                return reply.status(409).send({
                    statusCode: 409,
                    error: 'Conflict',
                    message: 'Este registro já existe em nossa base de dados',
                    requestId
                })
            case 'P2025':
                return reply.status(404).send({
                    statusCode: 404,
                    error: 'Not Found',
                    message: 'O recurso solicitado não foi encontrado',
                    requestId
                })
            default:
                logger.error({ error, requestId }, 'Prisma Error')
                return reply.status(400).send({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: 'Ocorreu um erro ao processar sua solicitação no banco de dados',
                    requestId
                })
        }
    }

    if (statusCode >= 500) {
        logger.error({
            err: error,
            requestId,
            method: request.method,
            url: request.url,
            ip: request.ip
        }, 'Internal Server Error')

        return reply.status(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: isProduction ? 'Ocorreu um erro inesperado no servidor' : error.message,
            requestId,
            ...(isProduction ? {} : { stack: error.stack })
        })
    }

    if (statusCode === 429) {
        logSecurity('Rate limit exceeded', 'low', { ip: request.ip, url: request.url })
    }

    return reply.status(statusCode).send({
        statusCode,
        error: error.name || 'Error',
        message: error.message,
        requestId
    })
}
