import { type DailyAllowanceStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'

/**
 * Motor Orçamentário Dinâmico (Épico 8).
 *
 * REGRA CENTRAL — "VALOR UTILIZADO" E "SALDO RESTANTE" NUNCA SÃO PERSISTIDOS:
 *   os dois são calculados NA LEITURA, agregando `DailyAllowance` e
 *   `VirtualProcess` vinculados a cada ficha. Persistir exigiria recalcular e
 *   reconciliar a cada vínculo, edição ou exclusão — com risco real de
 *   dessincronia sob concorrência (duas emissões simultâneas na mesma ficha).
 *   `QddItem.valorOrcado` continua sendo o único campo gravado (Achado A da
 *   spec do Épico 8).
 *
 * O que conta como "utilizado": diárias EMITIDAS (`ISSUED`/`ACCOUNTED`) — um
 * rascunho `PENDING` não gerou despesa — e todo `VirtualProcess` vinculado,
 * sem distinção de fase: o próprio ato de vincular um processo a uma ficha É
 * o consumo (não existe, para processo, um estado de "rascunho" análogo ao da
 * diária).
 */

/**
 * Estados de diária que representam despesa efetivamente comprometida.
 *
 * Tipado como array MUTÁVEL (não `as const`) de propósito: o filtro `status:
 * { in: ... }` do Prisma exige `DailyAllowanceStatus[]`, e uma tupla readonly
 * não satisfaz esse tipo mesmo contendo os mesmos valores.
 */
const COMMITTED_DAILY_ALLOWANCE_STATUSES: DailyAllowanceStatus[] = ['ISSUED', 'ACCOUNTED']

export class BudgetError extends Error {
  constructor(
    readonly code: 'INVALID_QDD_ITEM',
    message: string
  ) {
    super(message)
    this.name = 'BudgetError'
  }
}

export interface QddItemBalance {
  valorUtilizado: Prisma.Decimal
  saldoRestante: Prisma.Decimal
}

const ZERO = new Prisma.Decimal(0)

export const budgetService = {
  /** Saldo de uma única ficha. Prefira `getBalancesForItems` ao exibir uma lista. */
  async getQddItemBalance(qddItemId: string, organizationId: string): Promise<QddItemBalance> {
    const balances = await this.getBalancesForItems([qddItemId], organizationId)
    return balances.get(qddItemId) ?? { valorUtilizado: ZERO, saldoRestante: ZERO }
  },

  /**
   * Mesmo cálculo, em lote — usada pela listagem do QDD para não disparar duas
   * consultas agregadas (diária + processo) POR FICHA exibida.
   */
  async getBalancesForItems(
    qddItemIds: string[],
    organizationId: string
  ): Promise<Map<string, QddItemBalance>> {
    if (qddItemIds.length === 0) return new Map()

    const [items, dailyAllowanceSums, virtualProcessSums] = await Promise.all([
      prisma.qddItem.findMany({
        where: { id: { in: qddItemIds }, organizationId },
        select: { id: true, valorOrcado: true },
      }),
      prisma.dailyAllowance.groupBy({
        by: ['qddItemId'],
        where: {
          organizationId,
          qddItemId: { in: qddItemIds },
          status: { in: COMMITTED_DAILY_ALLOWANCE_STATUSES },
        },
        // `orderBy` nos mesmos campos de `by`: sem ele, o TypeScript do Prisma
        // 6 resolve o tipo de `where` como uma referência circular (erro
        // TS2615) neste `groupBy` — exigência de tipagem, não de runtime.
        orderBy: { qddItemId: 'asc' },
        _sum: { totalAmount: true },
      }),
      prisma.virtualProcess.groupBy({
        by: ['qddItemId'],
        where: { organizationId, qddItemId: { in: qddItemIds } },
        orderBy: { qddItemId: 'asc' },
        _sum: { totalValue: true },
      }),
    ])

    const usedByItem = new Map<string, Prisma.Decimal>()
    const add = (qddItemId: string | null, amount: Prisma.Decimal | null) => {
      if (!qddItemId || !amount) return
      usedByItem.set(qddItemId, (usedByItem.get(qddItemId) ?? ZERO).plus(amount))
    }
    for (const row of dailyAllowanceSums) add(row.qddItemId, row._sum.totalAmount)
    for (const row of virtualProcessSums) add(row.qddItemId, row._sum.totalValue)

    const result = new Map<string, QddItemBalance>()
    for (const item of items) {
      const valorUtilizado = usedByItem.get(item.id) ?? ZERO
      result.set(item.id, { valorUtilizado, saldoRestante: item.valorOrcado.minus(valorUtilizado) })
    }
    return result
  },

  /**
   * O comprometido na ficha já passa do orçado, incluindo o registro recém
   * gravado?
   *
   * Chamada DENTRO da mesma transação que gravou o novo vínculo/emissão, para
   * que a soma já o inclua e nenhuma operação concorrente escape da conta.
   * NÃO bloqueia — suplementação e remanejamento são rotina na administração
   * pública; quem chama decide o que fazer com o resultado (tipicamente,
   * gravar a flag `budgetOverrun` para auditoria).
   *
   * Toda a aritmética em Decimal, nunca em Number: uma diferença de centavo
   * no ponto flutuante decidiria errado se houve estouro.
   */
  async detectOverrun(tx: Prisma.TransactionClient, qddItemId: string): Promise<boolean> {
    const [qddItem, dailySum, processSum] = await Promise.all([
      tx.qddItem.findUnique({ where: { id: qddItemId }, select: { valorOrcado: true } }),
      tx.dailyAllowance.aggregate({
        where: { qddItemId, status: { in: COMMITTED_DAILY_ALLOWANCE_STATUSES } },
        _sum: { totalAmount: true },
      }),
      tx.virtualProcess.aggregate({
        where: { qddItemId },
        _sum: { totalValue: true },
      }),
    ])

    if (!qddItem) return false

    const total = (dailySum._sum.totalAmount ?? ZERO).plus(processSum._sum.totalValue ?? ZERO)
    return total.greaterThan(qddItem.valorOrcado)
  },

  /**
   * A dotação existe e pertence à MESMA organização?
   *
   * Sem esta conferência, um `qddItemId` copiado de outro tenant lastrearia a
   * despesa na dotação de outra prefeitura — a chave estrangeira aceitaria,
   * porque ela não sabe nada sobre organizações. Compartilhada por
   * `DailyAllowance` e `VirtualProcess`: os dois consomem QDD da mesma forma.
   */
  async assertQddItemBelongsToOrganization(qddItemId: string, organizationId: string) {
    const exists = await prisma.qddItem.findFirst({
      where: { id: qddItemId, organizationId },
      select: { id: true },
    })

    if (!exists) {
      throw new BudgetError(
        'INVALID_QDD_ITEM',
        'A dotação orçamentária informada não existe nesta organização.'
      )
    }
  },
}
