import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { auditoriaService } from '@/services/auditoria.service.js'

/**
 * Painel de Auditoria — consulta da trilha imutável (Épico 2, Task 2.1).
 *
 * Somente leitura por construção: não existe endpoint de alteração ou remoção
 * de registro de auditoria em nenhum lugar do sistema.
 */

const filtroSchema = z.object({
  pagina: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().positive().max(100).default(50),
  usuarioId: z.string().uuid().optional(),
  organizacaoId: z.string().min(1).optional(),
  acao: z.string().min(1).optional(),
  recurso: z.string().min(1).optional(),
  dataInicio: z.coerce.date().optional(),
  dataFim: z.coerce.date().optional(),
}).refine(
  d => !d.dataInicio || !d.dataFim || d.dataInicio <= d.dataFim,
  { message: 'A data inicial não pode ser posterior à data final.', path: ['dataInicio'] }
)

export const auditoriaController = {
  /** GET /api/v1/auditoria — histórico paginado. */
  async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      // z.infer resolve o tipo de SAÍDA (com os defaults já aplicados); sem isso
      // o TS trata pagina/limite como opcionais por causa do .refine().
      const filtro: z.infer<typeof filtroSchema> = filtroSchema.parse(request.query)
      const usuario = request.user as { isSuperAdmin?: boolean; organizationId?: string | null }

      // Isolamento multi-tenant: só o super admin enxerga a trilha de todas as
      // organizações. Um admin comum fica restrito à própria, e o filtro de
      // organização vindo da query é ignorado para ele — senão bastaria trocar
      // o parâmetro na URL para ler auditoria alheia.
      const organizacaoId = usuario.isSuperAdmin
        ? filtro.organizacaoId
        : (usuario.organizationId ?? undefined)

      if (!usuario.isSuperAdmin && !organizacaoId) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Usuário sem organização não pode consultar a auditoria.',
        })
      }

      const resultado = await auditoriaService.consultar({
        pagina: filtro.pagina ?? 1,
        limite: filtro.limite ?? 50,
        usuarioId: filtro.usuarioId,
        acao: filtro.acao,
        recurso: filtro.recurso,
        dataInicio: filtro.dataInicio,
        dataFim: filtro.dataFim,
        organizacaoId,
      })
      return reply.send(resultado)
    } catch (erro) {
      if (erro instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', issues: erro.issues })
      }
      request.log.error(erro, 'Falha ao consultar auditoria')
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Não foi possível consultar a trilha de auditoria.',
      })
    }
  },
}
