import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  BeneficiaryError,
  type RequestScope,
  beneficiaryService,
} from '@/services/beneficiary.service.js'

/**
 * Cadastro de beneficiários de diárias.
 *
 * Códigos de erro em inglês (contrato de máquina), mensagens em pt-BR.
 */

const listSchema = z.object({
  search: z.string().optional(),
})

const createSchema = z.object({
  name: z.string().min(1, 'Informe o nome do beneficiário.').max(200),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

/** Organização e usuário sempre do token — nunca do corpo da requisição. */
function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new BeneficiaryError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar beneficiários.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<BeneficiaryError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  INVALID_NAME: 400,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof BeneficiaryError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar beneficiário')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a solicitação.',
  })
}

export const beneficiaryController = {
  /** GET /api/v1/beneficiaries */
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { search } = listSchema.parse(request.query)
      return reply.send(await beneficiaryService.list(scope, search))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /**
   * POST /api/v1/beneficiaries
   *
   * Responde 200 quando o nome já existia e 201 quando foi criado agora. A
   * interface não precisa distinguir — os dois casos significam "o nome está na
   * lista" —, mas a diferença fica registrada para quem consulta o log.
   */
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { name } = createSchema.parse(request.body)

      const { beneficiary, created } = await beneficiaryService.create(name, scope)
      return reply.code(created ? 201 : 200).send(beneficiary)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** DELETE /api/v1/beneficiaries/:id */
  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await beneficiaryService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
