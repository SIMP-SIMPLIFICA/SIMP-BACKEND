import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  type CreateDailyAllowanceInput,
  DailyAllowanceError,
  type RequestScope,
  type UpdateDailyAllowanceInput,
  dailyAllowanceService,
} from '@/services/daily-allowance.service.js'

/**
 * Diárias de servidor (Épico 3, Task 3.1).
 *
 * As mensagens de erro vão em pt-BR porque chegam ao servidor da prefeitura;
 * os códigos de erro seguem em inglês, por serem contrato de máquina.
 */

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  beneficiaryName: z.string().trim().min(1, 'Informe o nome do beneficiário.').max(200),
  destination: z.string().min(1, 'Informe o destino.').max(255),
  purpose: z.string().min(1, 'Informe o motivo do deslocamento.'),
  departureDate: z.coerce.date(),
  returnDate: z.coerce.date(),
  // Positivo: diária com valor zero ou negativo não existe e mascararia erro de
  // digitação num documento de prestação de contas.
  dailyRate: z.coerce.number().positive('O valor da diária deve ser maior que zero.'),
  dayCount: z.coerce.number().positive('A quantidade de diárias deve ser maior que zero.'),
})

const updateSchema = createSchema.partial()

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  beneficiaryName: z.string().min(1).optional(),
  issued: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

// ─── Escopo ───────────────────────────────────────────────────────────────────

/**
 * Extrai organização e usuário do token.
 *
 * Nunca do corpo da requisição: aceitar `organizationId` do cliente permitiria
 * criar diárias no nome de outra prefeitura.
 */
function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new DailyAllowanceError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar diárias.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<DailyAllowanceError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  ALREADY_ISSUED: 409,
  NOT_ISSUED: 409,
  INVALID_PERIOD: 400,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof DailyAllowanceError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar diária')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a diária.',
  })
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const dailyAllowanceController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      // zod 3: um schema que contenha z.coerce.* é inferido com TODAS as chaves
      // opcionais — o tipo de ENTRADA do coerce aceita undefined e contamina a
      // inferência de saída. O parse já garantiu a presença em tempo de execução;
      // o cast apenas devolve ao TypeScript o que o zod assegura.
      const input = createSchema.parse(request.body) as CreateDailyAllowanceInput
      const record = await dailyAllowanceService.create(input, scope)
      return reply.code(201).send(record)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter: z.infer<typeof listSchema> = listSchema.parse(request.query)

      const result = await dailyAllowanceService.list(
        {
          page: filter.page ?? 1,
          limit: filter.limit ?? 20,
          beneficiaryName: filter.beneficiaryName,
          issued: filter.issued,
          startDate: filter.startDate,
          endDate: filter.endDate,
        },
        scope
      )
      return reply.send(result)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async getById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await dailyAllowanceService.getById(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body) as UpdateDailyAllowanceInput
      return reply.send(await dailyAllowanceService.update(id, input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await dailyAllowanceService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** POST /:id/issue — gera o PDF oficial e congela o registro. */
  async issue(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await dailyAllowanceService.issue(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /:id/pdf — baixa o documento já emitido. */
  async downloadPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const { bytes, publicId } = await dailyAllowanceService.getPdf(id, scope)

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="diaria-${publicId}.pdf"`)
        .send(bytes)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
