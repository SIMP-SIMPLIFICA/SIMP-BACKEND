import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { auditLedgerService } from '@/services/audit-ledger.service.js'

/**
 * Painel de Auditoria — consulta da trilha imutável (Épico 2, Task 2.1).
 *
 * Somente leitura por construção: não existe endpoint de alteração ou remoção
 * de registro de auditoria em nenhum lugar do sistema.
 */

const filterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  userId: z.string().uuid().optional(),
  organizationId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  d => !d.startDate || !d.endDate || d.startDate <= d.endDate,
  { message: 'A data inicial não pode ser posterior à data final.', path: ['startDate'] }
)

export const auditController = {
  /** GET /api/v1/audit — histórico paginado. */
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      // z.infer resolve o tipo de SAÍDA (com os defaults já aplicados); sem isso
      // o TS trata page/limit como opcionais por causa do .refine().
      const filter: z.infer<typeof filterSchema> = filterSchema.parse(request.query)
      const user = request.user as { isSuperAdmin?: boolean; organizationId?: string | null }

      // Isolamento multi-tenant: só o super admin enxerga a trilha de todas as
      // organizações. Um admin comum fica restrito à própria, e o filtro de
      // organização vindo da query é ignorado para ele — senão bastaria trocar
      // o parâmetro na URL para ler auditoria alheia.
      const organizationId = user.isSuperAdmin
        ? filter.organizationId
        : (user.organizationId ?? undefined)

      if (!user.isSuperAdmin && !organizationId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Usuário sem organização não pode consultar a auditoria.',
        })
      }

      const result = await auditLedgerService.query({
        page: filter.page ?? 1,
        limit: filter.limit ?? 50,
        userId: filter.userId,
        action: filter.action,
        resource: filter.resource,
        startDate: filter.startDate,
        endDate: filter.endDate,
        organizationId,
      })
      return reply.send(result)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      }
      request.log.error(error, 'Falha ao consultar auditoria')
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Não foi possível consultar a trilha de auditoria.',
      })
    }
  },
}
