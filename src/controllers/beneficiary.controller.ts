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
  /** Casamento exato. Aceita com ou sem máscara; o serviço normaliza. */
  cpf: z.string().optional(),
})

const createSchema = z.object({
  name: z.string().min(1, 'Informe o nome do beneficiário.').max(200),
  // Opcional: o combobox cria pelo nome, e o CPF pode vir depois (Q-3).
  cpf: z.string().max(20).nullable().optional(),
  // Setor de lotação. Alimenta o preenchimento automático do departamento no
  // formulário de diária — é sugestão, não trava.
  departmentId: z.string().min(1).nullable().optional(),

  // Dados de registro (Épico 4) — opcionais aqui também: podem chegar já
  // preenchidos de uma diária anterior, ou ficar para serem completados
  // depois. Ver `beneficiaryService.create`.
  registrationNumber: z.string().max(30).nullable().optional(),
  rg: z.string().max(40).nullable().optional(),
  jobTitle: z.string().max(150).nullable().optional(),
  lotacao: z.string().max(150).nullable().optional(),
  bankName: z.string().max(80).nullable().optional(),
  bankAgency: z.string().max(20).nullable().optional(),
  bankAccount: z.string().max(30).nullable().optional(),
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
  INVALID_CPF: 400,
  DUPLICATE_CPF: 409,
  CPF_MISMATCH: 409,
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
      const { search, cpf } = listSchema.parse(request.query)
      return reply.send(await beneficiaryService.list(scope, search, cpf))
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
      const { name, cpf, departmentId, ...registry } = createSchema.parse(request.body)

      const { beneficiary, created } = await beneficiaryService.create(
        name,
        scope,
        cpf,
        departmentId,
        registry
      )
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
