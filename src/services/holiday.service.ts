import { type HolidayScope, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'

/**
 * Feriados cadastráveis por organização (Épico 8, FR-020).
 *
 * Existe porque a regra do TCE sobre diária em fim de semana/feriado
 * (FR-021/FR-022) na prática aciona mais por feriado MUNICIPAL (padroeiro,
 * aniversário da cidade) do que nacional — e nenhuma biblioteca genérica de
 * feriados cobre isso. Cada organização mantém seu próprio calendário.
 */

export class HolidayError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'DUPLICATE_DATE',
    message: string
  ) {
    super(message)
    this.name = 'HolidayError'
  }
}

export interface RequestScope {
  organizationId: string
  userId: string
}

export interface CreateHolidayInput {
  date: Date
  name: string
  scope?: HolidayScope
}

export interface ListHolidayFilter {
  year?: number
}

export const holidayService = {
  async list(filter: ListHolidayFilter, scope: RequestScope) {
    return prisma.holiday.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(filter.year
          ? {
              date: {
                gte: new Date(Date.UTC(filter.year, 0, 1)),
                lte: new Date(Date.UTC(filter.year, 11, 31, 23, 59, 59)),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    })
  },

  async create(input: CreateHolidayInput, scope: RequestScope) {
    try {
      return await prisma.holiday.create({
        data: {
          organizationId: scope.organizationId,
          date: input.date,
          name: input.name,
          scope: input.scope ?? 'MUNICIPAL',
        },
      })
    } catch (error) {
      throw translateDuplicate(error)
    }
  },

  async remove(id: string, scope: RequestScope) {
    const existing = await prisma.holiday.findFirst({
      where: { id, organizationId: scope.organizationId },
    })
    if (!existing) throw new HolidayError('NOT_FOUND', 'Feriado não encontrado.')

    await prisma.holiday.delete({ where: { id } })
  },

  /**
   * Feriados cadastrados dentro de `[start, end]`, inclusive — usada pela
   * checagem de fim de semana/feriado da Diária (Épico 8, FR-021), NUNCA
   * chamada diretamente por uma rota: é apoio de outro domínio.
   */
  async getHolidaysInRange(organizationId: string, start: Date, end: Date) {
    return prisma.holiday.findMany({
      where: { organizationId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    })
  },
}

/**
 * P2002 em `(organizationId, date)` significa feriado repetido na mesma
 * data — o cadastro não precisa (nem deveria) aceitar duas entradas para o
 * mesmo dia, mesmo com nomes diferentes.
 */
function translateDuplicate(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new HolidayError('DUPLICATE_DATE', 'Já existe um feriado cadastrado nesta data.')
  }
  return error
}
