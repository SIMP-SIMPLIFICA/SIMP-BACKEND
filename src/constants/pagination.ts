import { z } from 'zod'

/**
 * Limites de paginação compartilhados.
 *
 * Existiam antes como números soltos espalhados por 13 schemas, com valores
 * divergentes (100 na maioria, 200 em departments, 500 em finance) e alguns
 * endpoints sem limite algum. Centralizar deixa o teto auditável num lugar só.
 */

/** Teto de itens por página em qualquer listagem paginada. */
export const MAX_PAGE_SIZE = 100

/** Padrão quando o cliente não informa `limit`. */
export const DEFAULT_PAGE_SIZE = 20

/**
 * Teto absoluto para consultas que NÃO expõem paginação ao cliente (listas de
 * configuração, exportações internas).
 *
 * Não é paginação — é um freio de memória. Sem ele, uma tabela que cresce sem
 * limite (lançamentos financeiros de anos, eventos de calendário) acabaria
 * carregada inteira num único `findMany`, derrubando o processo muito antes de
 * qualquer rate limit ser atingido.
 */
export const HARD_QUERY_CAP = 500

/**
 * Schema de paginação padrão. Use em todo endpoint de listagem:
 *
 *   const { page, limit } = paginationSchema.parse(request.query)
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

/** Campos de paginação para compor com filtros próprios de cada endpoint. */
export const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
} as const

/**
 * Normaliza um `limit` opcional para um valor sempre finito, respeitando o teto.
 * Para endpoints legados onde `limit` é opcional e a ausência significava
 * "traga tudo".
 */
export function boundedTake(limit: number | undefined, cap: number = HARD_QUERY_CAP): number {
  if (!limit || limit < 1) return cap
  return Math.min(limit, cap)
}
