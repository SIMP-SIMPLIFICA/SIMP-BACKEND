import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  type CreateHolidayInput,
  HolidayError,
  type RequestScope,
  holidayService,
} from '@/services/holiday.service.js'

/**
 * Feriados cadastráveis por organização (Épico 8, FR-020).
 * Códigos de erro em inglês (contrato de máquina), mensagens em pt-BR.
 */

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  date: z.coerce.date(),
  name: z.string().trim().min(1, 'Informe o nome do feriado.').max(150),
  scope: z.enum(['NATIONAL', 'STATE', 'MUNICIPAL']).optional(),
})

const listSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

// ─── Escopo ───────────────────────────────────────────────────────────────────

function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new HolidayError('NOT_FOUND', 'Usuário sem organização não pode gerenciar feriados.')
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<HolidayError['code'], number> = {
  NOT_FOUND: 404,
  DUPLICATE_DATE: 409,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof HolidayError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar feriado')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar o feriado.',
  })
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const holidayController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter = listSchema.parse(request.query)
      return reply.send(await holidayService.list(filter, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const input = createSchema.parse(request.body) as CreateHolidayInput
      return reply.code(201).send(await holidayService.create(input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await holidayService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
