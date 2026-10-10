import type { FastifyReply, FastifyRequest } from 'fastify'
import { handleError, scopeOf, sendPdf } from '@/controllers/fleet-http.js'
import { emptyBody, idParams } from '@/schemas/fleet.schemas.js'
import {
  cancelFuelingBody,
  createContractBody,
  createFuelingBody,
  fuelingOptionsQuery,
  fuelingSuggestionsQuery,
  listContractsQuery,
  listFuelingsQuery,
  updateContractBody,
  updateFuelingBody,
} from '@/schemas/fleet-fueling.schemas.js'
import { fleetContractService } from '@/services/fleet-contract.service.js'
import { fleetFuelingService } from '@/services/fleet-fueling.service.js'

const emptyQuery = emptyBody

/**
 * Contratos de combustível e autorização de abastecimento (TASK 3A) sob
 * /api/v1/fleet. Mesmo padrão do controller de cadastros (fleet-http.ts).
 */

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

function wrap(fn: Handler): Handler {
  return async (request, reply) => {
    try {
      return await fn(request, reply)
    } catch (error) {
      return handleError(error, request, reply)
    }
  }
}

export const fleetFuelingController = {
  // ─── Contratos ─────────────────────────────────────────────────────────────

  listContracts: wrap(async (request, reply) => {
    const query = listContractsQuery.parse(request.query)
    return reply.send(await fleetContractService.list(await scopeOf(request), query))
  }),

  getContract: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    return reply.send(await fleetContractService.getById(await scopeOf(request), id))
  }),

  createContract: wrap(async (request, reply) => {
    const body = createContractBody.parse(request.body)
    return reply.code(201).send(await fleetContractService.create(await scopeOf(request), body))
  }),

  updateContract: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const body = updateContractBody.parse(request.body)
    return reply.send(await fleetContractService.update(await scopeOf(request), id, body))
  }),

  deleteContract: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    await fleetContractService.remove(await scopeOf(request), id)
    return reply.code(204).send()
  }),

  // ─── Autorizações ──────────────────────────────────────────────────────────

  listFuelings: wrap(async (request, reply) => {
    const query = listFuelingsQuery.parse(request.query)
    return reply.send(await fleetFuelingService.list(await scopeOf(request), query))
  }),

  fuelingDepartments: wrap(async (request, reply) => {
    emptyQuery.parse(request.query ?? {})
    return reply.send(await fleetFuelingService.departments(await scopeOf(request)))
  }),

  fuelingOptions: wrap(async (request, reply) => {
    const { departmentId } = fuelingOptionsQuery.parse(request.query)
    return reply.send(await fleetFuelingService.options(await scopeOf(request), departmentId))
  }),

  fuelingSuggestions: wrap(async (request, reply) => {
    const { departmentId, vehicleId } = fuelingSuggestionsQuery.parse(request.query)
    return reply.send(await fleetFuelingService.suggestions(await scopeOf(request), departmentId, vehicleId))
  }),

  getFueling: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    return reply.send(await fleetFuelingService.getById(await scopeOf(request), id))
  }),

  createFueling: wrap(async (request, reply) => {
    const body = createFuelingBody.parse(request.body)
    return reply.code(201).send(await fleetFuelingService.create(await scopeOf(request), body))
  }),

  updateFueling: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const body = updateFuelingBody.parse(request.body)
    return reply.send(await fleetFuelingService.update(await scopeOf(request), id, body))
  }),

  deleteFueling: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    await fleetFuelingService.remove(await scopeOf(request), id)
    return reply.code(204).send()
  }),

  issueFueling: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    emptyBody.parse(request.body ?? {})
    return reply.send(await fleetFuelingService.issue(await scopeOf(request), id))
  }),

  cancelFueling: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const { reason } = cancelFuelingBody.parse(request.body)
    return reply.send(await fleetFuelingService.cancel(await scopeOf(request), id, reason))
  }),

  downloadFuelingPdf: wrap(async (request, reply) => {
    const { id } = idParams.parse(request.params)
    return sendPdf(reply, await fleetFuelingService.getPdf(await scopeOf(request), id))
  }),
}
