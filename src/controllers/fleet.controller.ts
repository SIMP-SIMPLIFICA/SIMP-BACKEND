import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  createDriverBody,
  createVehicleBody,
  emptyBody,
  exportDriversBody,
  exportVehiclesBody,
  idParams,
  listDriversQuery,
  listVehiclesQuery,
  lookupDriverBody,
  searchDriversByRegistrationBody,
  updateDriverBody,
  updateVehicleBody,
} from '@/schemas/fleet.schemas.js'
import { handleError, scopeOf, sendPdf } from '@/controllers/fleet-http.js'
import { fleetDriverService } from '@/services/fleet-driver.service.js'
import { fleetExportService } from '@/services/fleet-export.service.js'
import { fleetVehicleService } from '@/services/fleet-vehicle.service.js'

/**
 * Rotas autenticadas do Simplifica Frotas (/api/v1/fleet): cadastros e exportações.
 * Escopo, mapa de erro e envio de PDF em fleet-http.ts.
 */

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

  async exportVehicles(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = exportVehiclesBody.parse(request.body ?? {})
      return sendPdf(reply, await fleetExportService.vehicleList(await scopeOf(request), body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async exportVehicleSheet(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      emptyBody.parse(request.body ?? {})
      return sendPdf(reply, await fleetExportService.vehicleSheet(await scopeOf(request), id))
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

  async lookupDriver(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { cpf } = lookupDriverBody.parse(request.body)
      return reply.send(await fleetDriverService.lookupByCpf(await scopeOf(request), cpf))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async searchDriversByRegistration(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { registration } = searchDriversByRegistrationBody.parse(request.body)
      return reply.send(await fleetDriverService.searchByRegistration(await scopeOf(request), registration))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async exportDrivers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = exportDriversBody.parse(request.body ?? {})
      return sendPdf(reply, await fleetExportService.driverList(await scopeOf(request), body))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async exportDriverSheet(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = idParams.parse(request.params)
      emptyBody.parse(request.body ?? {})
      return sendPdf(reply, await fleetExportService.driverSheet(await scopeOf(request), id))
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
