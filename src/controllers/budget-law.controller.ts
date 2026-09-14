import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  BudgetLawError,
  type RequestScope,
  type UpsertBudgetLawInput,
  budgetLawService,
} from '@/services/budget-law.service.js'

/**
 * Leis Orçamentárias — LOA, PPA e LDO (Épico 4, Fase 2).
 *
 * Mesma permissão do QDD (`departments:*`): é cadastro do setor, mantido por
 * quem cuida do orçamento, que nem sempre emite diária.
 */

const yearField = z.coerce
  .number()
  .int()
  .min(2000, 'Exercício inválido.')
  .max(2100, 'Exercício inválido.')

const upsertSchema = z.object({
  departmentId: z.string().min(1, 'Selecione o departamento.'),
  type: z.enum(['LOA', 'PPA', 'LDO']),
  year: yearField,
  lawNumber: z.string().trim().max(50).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  details: z.string().trim().max(2000).nullable().optional(),
})

const listSchema = z.object({
  departmentId: z.string().min(1).optional(),
  year: yearField.optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new BudgetLawError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar leis orçamentárias.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<BudgetLawError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  DUPLICATE: 409,
  INVALID_DEPARTMENT: 400,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof BudgetLawError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({ error: error.code, message: error.message })
  }

  request.log.error(error, 'Falha ao processar lei orçamentária')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a lei orçamentária.',
  })
}

export const budgetLawController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter = listSchema.parse(request.query)
      return reply.send(await budgetLawService.list(filter, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async upsert(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      // zod 3: `z.coerce.*` torna todas as chaves opcionais na inferência; o
      // parse já garante a presença em tempo de execução.
      const input = upsertSchema.parse(request.body) as UpsertBudgetLawInput
      return reply.send(await budgetLawService.upsert(input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await budgetLawService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
