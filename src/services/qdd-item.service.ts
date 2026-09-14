import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { departmentExistsInOrganization } from '@/utils/department-scope.util.js'

/**
 * QDD — Quadro de Detalhamento da Despesa (Épico 4, Fase 2).
 *
 * É o catálogo de dotações que lastreiam as despesas do setor. Os nomes dos
 * campos ficam em português (`ficha`, `fonte`, `valorOrcado`) porque são termos
 * do domínio orçamentário público, sem tradução corrente — mesmo precedente de
 * `empenho` e `liquidação`, previsto no Princípio III.
 *
 * A ficha é catálogo, não documento: ela PODE ser corrigida depois de criada.
 * O que não muda é o documento já emitido, porque a diária carimba um snapshot
 * textual da dotação no instante da emissão (ver `daily-allowance.service.ts`).
 */

// ─── Erros de domínio ─────────────────────────────────────────────────────────

export class QddItemError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_ORGANIZATION' | 'DUPLICATE_FICHA' | 'IN_USE' | 'INVALID_DEPARTMENT',
    message: string
  ) {
    super(message)
    this.name = 'QddItemError'
  }
}

// ─── Contratos ────────────────────────────────────────────────────────────────

export interface RequestScope {
  organizationId: string
  userId: string
}

export interface CreateQddItemInput {
  departmentId: string
  year: number
  ficha: string
  fonte: string
  projetoAtividade: string
  naturezaDespesa: string
  valorOrcado: number
}

export type UpdateQddItemInput = Partial<Omit<CreateQddItemInput, 'departmentId'>>

export interface ListQddItemFilter {
  departmentId?: string
  year?: number
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const qddItemService = {
  /**
   * Fichas do exercício, ordenadas como o contador as lê.
   *
   * Sem paginação de propósito: um setor tem dezenas de fichas por exercício, e
   * a tela é uma tabela editável onde paginar atrapalharia mais que ajudaria.
   */
  async list(filter: ListQddItemFilter, scope: RequestScope) {
    return prisma.qddItem.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.year ? { year: filter.year } : {}),
      },
      orderBy: [{ year: 'desc' }, { ficha: 'asc' }],
      include: { department: { select: { id: true, name: true, code: true } } },
    })
  },

  async getById(id: string, scope: RequestScope) {
    const record = await prisma.qddItem.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: { department: { select: { id: true, name: true, code: true } } },
    })

    if (!record) throw new QddItemError('NOT_FOUND', 'Dotação não encontrada.')
    return record
  },

  async create(input: CreateQddItemInput, scope: RequestScope) {
    await assertDepartmentBelongsToOrganization(input.departmentId, scope.organizationId)

    try {
      return await prisma.qddItem.create({
        data: {
          organizationId: scope.organizationId,
          departmentId: input.departmentId,
          year: input.year,
          ficha: input.ficha,
          fonte: input.fonte,
          projetoAtividade: input.projetoAtividade,
          naturezaDespesa: input.naturezaDespesa,
          valorOrcado: new Prisma.Decimal(input.valorOrcado),
        },
        include: { department: { select: { id: true, name: true, code: true } } },
      })
    } catch (error) {
      throw translateDuplicate(error, input.ficha, input.year)
    }
  },

  async update(id: string, input: UpdateQddItemInput, scope: RequestScope) {
    // Confere o escopo ANTES de atualizar: `update` por id puro alcançaria a
    // dotação de outra organização.
    await this.getById(id, scope)

    try {
      return await prisma.qddItem.update({
        where: { id },
        data: {
          ...(input.year !== undefined ? { year: input.year } : {}),
          ...(input.ficha !== undefined ? { ficha: input.ficha } : {}),
          ...(input.fonte !== undefined ? { fonte: input.fonte } : {}),
          ...(input.projetoAtividade !== undefined
            ? { projetoAtividade: input.projetoAtividade }
            : {}),
          ...(input.naturezaDespesa !== undefined
            ? { naturezaDespesa: input.naturezaDespesa }
            : {}),
          ...(input.valorOrcado !== undefined
            ? { valorOrcado: new Prisma.Decimal(input.valorOrcado) }
            : {}),
        },
        include: { department: { select: { id: true, name: true, code: true } } },
      })
    } catch (error) {
      throw translateDuplicate(error, input.ficha, input.year)
    }
  },

  /**
   * Exclui a ficha, desde que nenhuma diária EMITIDA a tenha usado.
   *
   * A checagem é explícita em vez de esperar o `Restrict` do banco: o erro de
   * chave estrangeira do Postgres não diz ao usuário o que fazer, e aqui a
   * mensagem explica que existe despesa documentada lastreada nessa dotação.
   *
   * Rascunhos NÃO impedem: eles ainda podem trocar de ficha, e travar a
   * exclusão por causa de um rascunho esquecido seria arbitrário. O
   * `onDelete: Restrict` do schema continua sendo a rede de segurança final.
   */
  async remove(id: string, scope: RequestScope) {
    await this.getById(id, scope)

    const issuedCount = await prisma.dailyAllowance.count({
      where: { qddItemId: id, status: { in: ['ISSUED', 'ACCOUNTED'] } },
    })

    if (issuedCount > 0) {
      throw new QddItemError(
        'IN_USE',
        `Esta dotação lastreia ${issuedCount} diária(s) já emitida(s) e não pode ser excluída. ` +
          'O vínculo faz parte da prestação de contas.'
      )
    }

    await prisma.qddItem.delete({ where: { id } })
  },
}

// ─── Apoio ────────────────────────────────────────────────────────────────────

async function assertDepartmentBelongsToOrganization(departmentId: string, organizationId: string) {
  if (!(await departmentExistsInOrganization(departmentId, organizationId))) {
    throw new QddItemError(
      'INVALID_DEPARTMENT',
      'O departamento informado não existe nesta organização.'
    )
  }
}

/**
 * Converte a violação de unicidade do Prisma em erro de domínio.
 *
 * P2002 em `[departmentId, year, ficha]` significa ficha repetida no mesmo setor
 * e exercício — o que tornaria ambíguo a qual dotação a despesa foi imputada.
 * Qualquer outro erro segue subindo intacto.
 */
function translateDuplicate(error: unknown, ficha?: string, year?: number): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const suffix = ficha ? ` "${ficha}"${year ? ` no exercício de ${year}` : ''}` : ''
    return new QddItemError(
      'DUPLICATE_FICHA',
      `Já existe a ficha${suffix} neste departamento. Use outra ficha ou edite a existente.`
    )
  }
  return error
}
