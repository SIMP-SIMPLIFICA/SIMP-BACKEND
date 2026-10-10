import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { FleetError, type FleetErrorCode } from '@/services/fleet-error.js'
import { resolveFleetScope } from '@/services/fleet-scope.service.js'

/**
 * Peças HTTP comuns aos controllers autenticados do Frotas (/api/v1/fleet):
 * escopo SEMPRE do token, erro de domínio traduzido por STATUS_BY_CODE (D4) e
 * 500 genérico sem detalhe interno.
 */

export const STATUS_BY_CODE: Record<FleetErrorCode, number> = {
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
  ASSET_TAG_REQUIRED: 400,
  ASSET_TAG_ALREADY_REGISTERED: 409,
  REGISTRATION_REQUIRED: 400,
  REGISTRATION_ALREADY_REGISTERED: 409,
  EXPORT_TOO_LARGE: 422,
  VEHICLE_IN_USE: 409,
  DRIVER_IN_USE: 409,
  PII_KEYS_MISSING: 503,
  INVALID_CNPJ: 400,
  INVALID_DATES: 400,
  CONTRACT_ALREADY_REGISTERED: 409,
  CONTRACT_IN_USE: 409,
  CONTRACT_BELOW_COMMITTED: 422,
  INVALID_VEHICLE: 400,
  INVALID_DRIVER: 400,
  INVALID_CONTRACT: 400,
  INVALID_QDD_ITEM: 400,
  INVALID_LIMITS: 400,
  INVALID_VALIDITY: 400,
  VEHICLE_UNAVAILABLE: 422,
  DRIVER_NOT_ELIGIBLE: 422,
  FUEL_INCOMPATIBLE: 422,
  CONTRACT_REQUIRED: 422,
  CONTRACT_NOT_IN_FORCE: 422,
  CONTRACT_FUEL_MISMATCH: 422,
  UNIT_PRICE_ABOVE_CONTRACT: 422,
  CONTRACT_BALANCE_INSUFFICIENT: 422,
  QDD_ITEM_REQUIRED: 422,
  ALREADY_ISSUED: 409,
  NOT_ISSUED: 409,
  NOT_CANCELLABLE: 409,
  DRAFT_CHANGED: 409,
  PDF_RESTRICTED: 403,
}

export function scopeOf(request: FastifyRequest) {
  const user = request.user as { id?: string; organizationId?: string | null }
  return resolveFleetScope({
    organizationId: user?.organizationId,
    userId: user?.id,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  })
}

export function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
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

export interface PdfPayload {
  bytes: Uint8Array
  fileName: string
  publicId: string
}

/** PDF autenticado: download como anexo, sem cache (o conteúdo depende do escopo de quem pediu). */
export function sendPdf(reply: FastifyReply, result: PdfPayload) {
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${result.fileName}"`)
    .header('Cache-Control', 'no-store')
    .header('X-Document-Public-Id', result.publicId)
    .send(Buffer.from(result.bytes))
}
