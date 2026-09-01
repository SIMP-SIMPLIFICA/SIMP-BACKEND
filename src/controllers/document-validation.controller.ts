import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { documentValidationService } from '@/services/document-validation.service.js'

/**
 * Portal de Validação Pública (Épico 3, Task 3.3).
 *
 * Rota aberta, sem autenticação: é o cidadão ou o fiscal apontando a câmera
 * para o QR Code do documento.
 */

const paramsSchema = z.object({
  uuid: z.string().uuid(),
})

export const documentValidationController = {
  /** GET /api/v1/public/documents/validate/:uuid */
  async validate(request: FastifyRequest, reply: FastifyReply) {
    try {
      const parsed = paramsSchema.safeParse(request.params)

      // Um uuid malformado recebe a MESMA resposta de um documento inexistente,
      // e não um 400 de validação. Para quem confere um papel, "esse código não
      // corresponde a documento nenhum" é a informação útil — e responder
      // diferente para formato inválido entregaria a um curioso um oráculo para
      // descobrir como os identificadores são formados.
      if (!parsed.success) {
        return reply.code(404).send({
          valid: false,
          error: 'DOCUMENT_NOT_FOUND',
          message: 'Documento não encontrado. Verifique o código informado.',
        })
      }

      const document = await documentValidationService.validate(parsed.data.uuid)

      if (!document) {
        return reply.code(404).send({
          valid: false,
          error: 'DOCUMENT_NOT_FOUND',
          message: 'Documento não encontrado. Verifique o código informado.',
        })
      }

      return reply.send({ valid: true, document })
    } catch (error) {
      request.log.error(error, 'Falha ao validar documento público')
      return reply.code(500).send({
        valid: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível validar o documento no momento. Tente novamente.',
      })
    }
  },
}
