import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  createDriverBody,
  createVehicleBody,
  idParams,
  listDriversQuery,
  listVehiclesQuery,
  updateDriverBody,
  updateVehicleBody,
} from '@/schemas/fleet.schemas.js'
import { FleetError, type FleetErrorCode } from '@/services/fleet-error.js'
import { fleetDriverService } from '@/services/fleet-driver.service.js'
import { fleetVehicleService } from '@/services/fleet-vehicle.service.js'
import { resolveFleetScope } from '@/services/fleet-scope.service.js'

/**
 * Rotas autenticadas do Simplifica Frotas (/api/v1/fleet). Mesmo padrão do
 * controller de Diárias: Zod na entrada, escopo SEMPRE do token, erro de domínio
 * traduzido por STATUS_BY_CODE e 500 genérico sem detalhe interno.
 */

const STATUS_BY_CODE: Record<FleetErrorCode, number> = {
  NO_ORGANIZATION: 403,
  NOT_FOUND: 404,
  INVALID_PLATE: 400,
  INVALID_RENAVAM: 400,
  INVALID_CHASSIS: 400,
  INVALID_VEHICLE_YEARS: 400,
  INVALID_CPF: 400,
  INVALID_CNH: 400,
  INVALID_DEPARTMENT: 400,
  INVALID_OWNER_ENTITY: 400,
  INVALID_USER: 400,
  DEPARTMENT_OUT_OF_SCOPE: 403,
  PLATE_ALREADY_REGISTERED: 409,
  RENAVAM_ALREADY_REGISTERED: 409,
  CPF_ALREADY_REGISTERED: 409,
  VEHICLE_IN_USE: 409,
  DRIVER_IN_USE: 409,
  PII_KEYS_MISSING: 503,
}

function scopeOf(request: FastifyRequest) {
  const user = request.user as { id?: string; organizationId?: string | null }
  return resolveFleetScope({
    organizationId: user?.organizationId,
    userId: user?.id,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  })
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Alguns campos não foram preenchidos corretamente. Confira os campos destacados.',
      issues: error.issues.map(i => ({ path: i.path, message: i.message, code: i.code })),
    })
  }
  if (error instanceof FleetError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    })
  }

  request.log.error(error, 'Falha ao processar requisição do Frotas')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível concluir a operação. Tente de novo; se persistir, informe o suporte com o horário.',
  })
}

export const fleetController = {
  // ─── Veículos ──────────────────────────────────────────────────────────────

  async listVehicles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = listVehiclesQuery.parse(request.query)
      return reply.send(await fleetVehicleService.list(await scopeOf(request), query))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async getVehicle(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      return reply.send(await fleetVehicleService.getById(await scopeOf(request), id))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async createVehicle(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = createVehicleBody.parse(request.body)
      return reply.code(201).send(await fleetVehicleService.create(await scopeOf(request), body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async updateVehicle(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      const body = updateVehicleBody.parse(request.body)
      return reply.send(await fleetVehicleService.update(await scopeOf(request), id, body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async deleteVehicle(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      await fleetVehicleService.remove(await scopeOf(request), id)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  // ─── Motoristas ────────────────────────────────────────────────────────────

  async listDrivers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = listDriversQuery.parse(request.query)
      return reply.send(await fleetDriverService.list(await scopeOf(request), query))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async getDriver(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      return reply.send(await fleetDriverService.getById(await scopeOf(request), id))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async createDriver(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = createDriverBody.parse(request.body)
      return reply.code(201).send(await fleetDriverService.create(await scopeOf(request), body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async updateDriver(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      const body = updateDriverBody.parse(request.body)
      return reply.send(await fleetDriverService.update(await scopeOf(request), id, body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async deleteDriver(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      await fleetDriverService.remove(await scopeOf(request), id)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
