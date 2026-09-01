import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { UnsupportedFileTypeError } from '@/services/file-validation.service.js'
import { BrandingError, organizationBrandingService } from '@/services/organization-branding.service.js'

/**
 * Identidade visual por tenant — white-label (Épico 3, Task 3.4).
 *
 * Restrito ao Super Admin: a logo é o que carimba a autoria de um documento
 * oficial. Deixar o admin da própria prefeitura trocá-la à vontade permitiria
 * mudar a aparência de documento público sem trilha de aprovação.
 */

const paramsSchema = z.object({ id: z.string().min(1, 'Identificador inválido.') })

const STATUS_BY_CODE: Record<BrandingError['code'], number> = {
  ORGANIZATION_NOT_FOUND: 404,
  NO_FILE: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
}

/** Guard local: mesmo critério do admin.controller.ts. */
function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as { isSuperAdmin?: boolean } | undefined

  if (!user?.isSuperAdmin) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito a Super Admins.' })
    return false
  }
  return true
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof BrandingError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }
  // Erro do validador de assinatura binária: o arquivo não é o que dizia ser.
  if (error instanceof UnsupportedFileTypeError) {
    return reply.code(415).send({ error: 'UNSUPPORTED_FORMAT', message: error.message })
  }

  request.log.error(error, 'Falha ao processar a logo da organização')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a logo da organização.',
  })
}

export const organizationBrandingController = {
  /** POST /api/v1/admin/organizations/:id/logo (multipart) */
  async uploadLogo(request: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireSuperAdmin(request, reply)) return

      const { id } = paramsSchema.parse(request.params)

      const file = await request.file()
      if (!file) {
        return reply.code(400).send({ error: 'NO_FILE', message: 'Nenhum arquivo enviado.' })
      }

      const buffer = await file.toBuffer()

      const result = await organizationBrandingService.uploadLogo(
        id,
        buffer,
        file.mimetype,
        file.filename ?? 'logo'
      )
      return reply.send(result)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** DELETE /api/v1/admin/organizations/:id/logo */
  async removeLogo(request: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireSuperAdmin(request, reply)) return

      const { id } = paramsSchema.parse(request.params)
      return reply.send(await organizationBrandingService.removeLogo(id))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
