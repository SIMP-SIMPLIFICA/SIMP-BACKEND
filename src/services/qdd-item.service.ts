import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { departmentExistsInOrganization } from '@/utils/department-scope.util.js'
import { budgetService } from '@/services/budget.service.js'

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
    readonly code:
      | 'NOT_FOUND'
      | 'NO_ORGANIZATION'
      | 'DUPLICATE_FICHA'
      | 'IN_USE'
      | 'INVALID_DEPARTMENT'
      | 'REASON_REQUIRED',
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

export type UpdateQddItemInput = Partial<Omit<CreateQddItemInput, 'departmentId'>> & {
  /**
   * Motivo da alteração — obrigatório SOMENTE quando `valorOrcado` muda
   * (Épico 8, FR-013). Editar ficha/fonte/natureza sem mexer no valor não
   * exige motivo: não é suplementação, é correção de cadastro.
   */
  reason?: string
}

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
    const items = await prisma.qddItem.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.year ? { year: filter.year } : {}),
      },
      orderBy: [{ year: 'desc' }, { ficha: 'asc' }],
      include: { department: { select: { id: true, name: true, code: true } } },
    })

    // "Valor Utilizado"/"Saldo Restante" calculados NA LEITURA (Épico 8,
    // FR-008), em lote para não disparar duas agregações por ficha exibida.
    const balances = await budgetService.getBalancesForItems(
      items.map(item => item.id),
      scope.organizationId
    )

    return items.map(item => ({
      ...item,
      ...(balances.get(item.id) ?? {
        valorUtilizado: new Prisma.Decimal(0),
        saldoRestante: item.valorOrcado,
      }),
    }))
  },

  async getById(id: string, scope: RequestScope) {
    const record = await prisma.qddItem.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: { department: { select: { id: true, name: true, code: true } } },
    })

    if (!record) throw new QddItemError('NOT_FOUND', 'Dotação não encontrada.')

    const balance = await budgetService.getQddItemBalance(id, scope.organizationId)
    return { ...record, ...balance }
  },

  /** Histórico de suplementação/redução do valor orçado, mais recente primeiro. */
  async getHistory(id: string, scope: RequestScope) {
    // Garante escopo + existência antes de expor histórico de outra organização.
    await this.getById(id, scope)

    return prisma.budgetHistory.findMany({
      where: { qddItemId: id, organizationId: scope.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
    })
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
    // dotação de outra organização. `current` também dá o valor ANTERIOR, para
    // o histórico de suplementação abaixo.
    const current = await this.getById(id, scope)

    const isChangingValue =
      input.valorOrcado !== undefined &&
      !new Prisma.Decimal(input.valorOrcado).equals(current.valorOrcado)

    // Motivo obrigatório SÓ quando o valor muda de fato (Épico 8, FR-013) —
    // reenviar o mesmo valor, ou editar só ficha/fonte/natureza, não é
    // suplementação e não deveria exigir justificativa.
    if (isChangingValue && !input.reason?.trim()) {
      throw new QddItemError(
        'REASON_REQUIRED',
        'Informe o motivo da alteração do valor orçado — toda suplementação ou redução precisa ficar registrada.'
      )
    }

    try {
      return await prisma.$transaction(async tx => {
        const updated = await tx.qddItem.update({
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

        // Rastro de suplementação (Épico 8, FR-013), gravado na MESMA
        // transação que o novo valor: um valor alterado sem histórico, ou um
        // histórico sem a alteração correspondente, são os dois lados da
        // mesma inconsistência que o Princípio VIII não admite em nenhum
        // domínio deste sistema.
        if (isChangingValue) {
          const previousValue = current.valorOrcado
          const newValue = updated.valorOrcado
          // Nulo quando a dotação partia de zero: percentual sobre base zero
          // não tem significado (nem "infinito" nem "0%" descrevem o fato).
          const changePercent = previousValue.isZero()
            ? null
            : newValue.minus(previousValue).dividedBy(previousValue).times(100)

          await tx.budgetHistory.create({
            data: {
              organizationId: scope.organizationId,
              qddItemId: id,
              previousValue,
              newValue,
              changePercent,
              reason: input.reason.trim(),
              changedById: scope.userId,
            },
          })
        }

        return updated
      })
    } catch (error) {
      throw translateDuplicate(error, input.ficha, input.year)
    }
  },

  /**
   * Exclui a ficha, desde que nenhuma diária EMITIDA nem processo vinculado a
   * tenha usado (Épico 8, FR-012 — mesma regra de `DailyAllowance`, estendida
   * a `VirtualProcess`).
   *
   * A checagem é explícita em vez de esperar o `Restrict` do banco: o erro de
   * chave estrangeira do Postgres não diz ao usuário o que fazer, e aqui a
   * mensagem explica que existe despesa documentada lastreada nessa dotação.
   *
   * Diária rascunho (`PENDING`) NÃO impede: ela ainda pode trocar de ficha, e
   * travar a exclusão por causa de um rascunho esquecido seria arbitrário. Já
   * um `VirtualProcess` vinculado impede sempre — não existe, para processo,
   * um estado de rascunho equivalente (o vínculo em si já é o consumo). O
   * `onDelete: Restrict` do schema continua sendo a rede de segurança final.
   */
  async remove(id: string, scope: RequestScope) {
    await this.getById(id, scope)

    const [issuedDailyAllowanceCount, linkedProcessCount] = await Promise.all([
      prisma.dailyAllowance.count({
        where: { qddItemId: id, status: { in: ['ISSUED', 'ACCOUNTED'] } },
      }),
      prisma.virtualProcess.count({ where: { qddItemId: id } }),
    ])

    if (issuedDailyAllowanceCount > 0) {
      throw new QddItemError(
        'IN_USE',
        `Esta dotação lastreia ${issuedDailyAllowanceCount} diária(s) já emitida(s) e não pode ser excluída. ` +
          'O vínculo faz parte da prestação de contas.'
      )
    }

    if (linkedProcessCount > 0) {
      throw new QddItemError(
        'IN_USE',
        `Esta dotação lastreia ${linkedProcessCount} processo(s) vinculado(s) e não pode ser excluída. ` +
          'O vínculo faz parte do controle orçamentário do processo.'
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
