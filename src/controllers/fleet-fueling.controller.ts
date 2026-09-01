import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  type CreateFleetFuelingInput,
  FleetFuelingError,
  type RequestScope,
  type UpdateFleetFuelingInput,
  fleetFuelingService,
} from '@/services/fleet-fueling.service.js'

/**
 * Controle de abastecimento de frota (Épico 3, Task 3.2).
 *
 * Mensagens em pt-BR, códigos de erro em inglês — padrão híbrido estrito.
 */

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  // O formato é validado no serviço, junto da normalização, para que a regra
  // valha também para quem chamar o serviço sem passar por esta rota.
  licensePlate: z.string().min(7, 'Informe a placa do veículo.').max(10),
  // Inteiro não negativo: o painel não marca fração, e zero é legítimo num
  // veículo recém-adquirido.
  odometer: z.coerce.number().int().nonnegative('O odômetro não pode ser negativo.'),
  liters: z.coerce.number().positive('A quantidade de litros deve ser maior que zero.'),
  totalValue: z.coerce.number().positive('O valor total deve ser maior que zero.'),
  date: z.coerce.date(),
})

const updateSchema = createSchema.partial()

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  licensePlate: z.string().min(1).optional(),
  issued: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

// ─── Escopo ───────────────────────────────────────────────────────────────────

/** Organização e usuário sempre do token — nunca do corpo da requisição. */
function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new FleetFuelingError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar abastecimentos.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<FleetFuelingError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  ALREADY_ISSUED: 409,
  NOT_ISSUED: 409,
  INVALID_PLATE: 400,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof FleetFuelingError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar abastecimento')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar o abastecimento.',
  })
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const fleetFuelingController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      // zod 3: schema com z.coerce.* é inferido com todas as chaves opcionais —
      // o parse já garantiu a presença em tempo de execução (ver Task 3.1).
      const input = createSchema.parse(request.body) as CreateFleetFuelingInput
      return reply.code(201).send(await fleetFuelingService.create(input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter: z.infer<typeof listSchema> = listSchema.parse(request.query)

      const result = await fleetFuelingService.list(
        {
          page: filter.page ?? 1,
          limit: filter.limit ?? 20,
          licensePlate: filter.licensePlate,
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
      return reply.send(await fleetFuelingService.getById(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body) as UpdateFleetFuelingInput
      return reply.send(await fleetFuelingService.update(id, input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await fleetFuelingService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** POST /:id/issue — gera o relatório oficial e congela o registro. */
  async issue(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await fleetFuelingService.issue(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /:id/pdf — baixa o documento já emitido. */
  async downloadPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const { bytes, publicId } = await fleetFuelingService.getPdf(id, scope)

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="abastecimento-${publicId}.pdf"`)
        .send(bytes)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
