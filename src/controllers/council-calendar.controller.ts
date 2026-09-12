import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CouncilCalendarError,
  councilCalendarReportService,
} from '@/services/council-calendar-report.service.js'

/**
 * Exportação do Calendário Anual de Reuniões (validação universal).
 *
 * Responde com o binário do PDF. O registro para validação pública acontece no
 * serviço, então o arquivo entregue já é conferível pelo QR Code do rodapé.
 */

const paramsSchema = z.object({
  councilId: z.string().min(1, 'Identificador do conselho inválido.'),
  // Faixa ampla de propósito: calendários retroativos são consultados em
  // auditoria, e exercícios futuros já são planejados.
  year: z.coerce.number().int().min(2000).max(2100),
})

export const councilCalendarController = {
  /** GET /councils/:councilId/calendar/:year/pdf */
  async exportPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const user = request.user as { id?: string; organizationId?: string | null }

      if (!user?.organizationId || !user.id) {
        return reply.code(403).send({
          error: 'NO_ORGANIZATION',
          message: 'Usuário sem organização não pode exportar o calendário.',
        })
      }

      const { councilId, year } = paramsSchema.parse(request.params)

      const { bytes, publicId } = await councilCalendarReportService.generate(councilId, year, {
        organizationId: user.organizationId,
        userId: user.id,
      })

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="calendario-${year}-${publicId}.pdf"`)
        .send(Buffer.from(bytes))
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
      }
      if (error instanceof CouncilCalendarError) {
        return reply
          .code(error.code === 'NOT_FOUND' ? 404 : 403)
          .send({ error: error.code, message: error.message })
      }

      request.log.error(error, 'Falha ao exportar o calendário do conselho')
      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível gerar o calendário.',
      })
    }
  },
}
