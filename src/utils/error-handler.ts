import { FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { logger, logSecurity } from './logger.js'

type AppError = Error & { statusCode?: number; validation?: unknown }

export const errorHandler = (
    error: AppError,
    request: FastifyRequest,
    reply: FastifyReply
) => {
    const requestId = (request as any).id
    const statusCode = error.statusCode || 500
    const isProduction = process.env.NODE_ENV === 'production'

    if (error instanceof ZodError) {
        return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
            details: error.issues,
            requestId
        })
    }

    if (error.validation) {
        return reply.code(400).send({
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
                return reply.code(409).send({
                    statusCode: 409,
                    error: 'Conflict',
                    message: 'Este registro já existe em nossa base de dados',
                    requestId
                })
            case 'P2025':
                return reply.code(404).send({
                    statusCode: 404,
                    error: 'Not Found',
                    message: 'O recurso solicitado não foi encontrado',
                    requestId
                })
            default:
                logger.error({ error, requestId }, 'Prisma Error')
                return reply.code(400).send({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: 'Ocorreu um erro ao processar sua solicitação no banco de dados',
                    requestId
                })
        }
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
        logger.error({ error, requestId }, 'Database initialization error — cannot reach Supabase pooler')
        return reply.code(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'O banco de dados está temporariamente indisponível. Tente novamente em instantes.',
            requestId,
        })
    }

    if (error instanceof Prisma.PrismaClientRustPanicError) {
        logger.fatal({ error, requestId }, 'Prisma engine panic — process will restart')
        return reply.code(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Erro crítico no servidor. A equipe foi notificada.',
            requestId,
        })
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
        logger.error({ error, requestId }, 'Prisma unknown request error')
        return reply.code(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Erro inesperado ao processar a requisição no banco de dados.',
            requestId,
        })
    }

    if (statusCode >= 500) {
        logger.error({
            err: error,
            requestId,
            method: (request as any).method,
            url: (request as any).url,
            ip: (request as any).ip
        }, 'Internal Server Error')

        return reply.code(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: isProduction ? 'Ocorreu um erro inesperado no servidor' : error.message,
            requestId,
            ...(isProduction ? {} : { stack: error.stack })
        })
    }

    if (statusCode === 429) {
        logSecurity('Rate limit exceeded', 'low', { ip: (request as any).ip, url: (request as any).url })
    }

    return reply.code(statusCode).send({
        statusCode,
        error: error.name || 'Error',
        message: error.message,
        requestId
    })
}
