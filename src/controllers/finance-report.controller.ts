import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { financeReportService } from '@/services/finance-report.service.js'

const querySchema = z.object({
  type:          z.enum(['INCOME', 'EXPENSE']).optional(),
  search:        z.string().optional(),
  categoryNames: z.string().optional(), // vírgula-separado: "Educação,Saúde"
  startDate:     z.string().optional(), // ISO date string
  endDate:       z.string().optional(), // ISO date string
})

export class FinanceReportController {
  async generatePdf(request: FastifyRequest, reply: FastifyReply) {
    const organizationId = request.user.organizationId
    const userId = request.user.id

    if (!organizationId) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso negado.' })
    }

    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    }

    const { type, search, categoryNames, startDate, endDate } = parsed.data

    const filter = {
      type,
      search: search?.trim() || undefined,
      categoryNames: categoryNames
        ? categoryNames.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate:   endDate   ? new Date(endDate)   : undefined,
    }

    const { bytes, publicId } = await financeReportService.generate(filter, organizationId, userId)

    const filename = `SIMP_Relatorio_Financeiro_${publicId}.pdf`

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Document-Public-Id', publicId)
      .send(Buffer.from(bytes))
  }
}
