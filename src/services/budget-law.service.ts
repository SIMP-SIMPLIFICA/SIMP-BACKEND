import { type BudgetLawType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { departmentExistsInOrganization } from '@/utils/department-scope.util.js'

/**
 * Leis Orçamentárias — LOA, PPA e LDO (Épico 4, Fase 2).
 *
 * Um registro por setor, tipo e exercício: a LOA de 2026 da Secretaria de
 * Obras é UM cadastro, não uma lista. Suplementação ou emenda ATUALIZA esse
 * registro — não cria um segundo, que tornaria ambíguo qual é a lei vigente.
 *
 * Cadastro macro, não documento: ao contrário da diária, não há PDF nem hash
 * aqui. É o número da lei e a data de publicação que o Tribunal de Contas
 * confere ao auditar a peça orçamentária.
 */

export class BudgetLawError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_ORGANIZATION' | 'DUPLICATE' | 'INVALID_DEPARTMENT',
    message: string
  ) {
    super(message)
    this.name = 'BudgetLawError'
  }
}

export interface RequestScope {
  organizationId: string
  userId: string
}

export interface UpsertBudgetLawInput {
  departmentId: string
  type: BudgetLawType
  year: number
  lawNumber?: string | null
  publishedAt?: Date | null
  details?: string | null
}

export interface ListBudgetLawFilter {
  departmentId?: string
  year?: number
}

const INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
} satisfies Prisma.BudgetLawInclude

export const budgetLawService = {
  async list(filter: ListBudgetLawFilter, scope: RequestScope) {
    return prisma.budgetLaw.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.year ? { year: filter.year } : {}),
      },
      orderBy: [{ year: 'desc' }, { type: 'asc' }],
      include: INCLUDE,
    })
  },

  async getById(id: string, scope: RequestScope) {
    const record = await prisma.budgetLaw.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: INCLUDE,
    })

    if (!record) throw new BudgetLawError('NOT_FOUND', 'Lei orçamentária não encontrada.')
    return record
  },

  /**
   * Cria OU atualiza o registro do setor/tipo/exercício.
   *
   * UPSERT deliberado: a tela apresenta um card por tipo (LOA/PPA/LDO) e o
   * usuário só preenche ou corrige — não existe, do ponto de vista dele, um
   * passo separado de "criar" e outro de "editar" a mesma lei.
   */
  async upsert(input: UpsertBudgetLawInput, scope: RequestScope) {
    if (!(await departmentExistsInOrganization(input.departmentId, scope.organizationId))) {
      throw new BudgetLawError(
        'INVALID_DEPARTMENT',
        'O departamento informado não existe nesta organização.'
      )
    }

    return prisma.budgetLaw.upsert({
      where: {
        departmentId_type_year: {
          departmentId: input.departmentId,
          type: input.type,
          year: input.year,
        },
      },
      create: {
        organizationId: scope.organizationId,
        departmentId: input.departmentId,
        type: input.type,
        year: input.year,
        lawNumber: input.lawNumber ?? null,
        publishedAt: input.publishedAt ?? null,
        details: input.details ?? null,
      },
      update: {
        lawNumber: input.lawNumber ?? null,
        publishedAt: input.publishedAt ?? null,
        details: input.details ?? null,
      },
      include: INCLUDE,
    })
  },

  async remove(id: string, scope: RequestScope) {
    await this.getById(id, scope)
    await prisma.budgetLaw.delete({ where: { id } })
  },
}
