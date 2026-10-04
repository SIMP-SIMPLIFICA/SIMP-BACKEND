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

// ─── Simplifica Frotas (TASK 1): consumo da ficha QDD ───────────────────────
// Autorização de abastecimento EMITIDA e ainda aberta RESERVA o valor máximo;
// usada ou fechada CONSOME o valor real do cupom (ou o máximo, se o cupom ainda
// não tem valor); expirada, bloqueada ou cancelada libera a reserva.
// OS aprovada, em execução ou concluída consome o total da OS.
const FLEET_RESERVING_LIFECYCLES = ['OPEN', 'IN_USE', 'AWAITING_REVIEW'] as const
const FLEET_CONSUMED_LIFECYCLES = ['USED', 'CLOSED'] as const
const FLEET_COMMITTED_SERVICE_ORDER_STATUSES = ['APROVADA', 'EM_EXECUCAO', 'CONCLUIDA'] as const

/**
 * Soma, por ficha, o que o Frotas compromete. `client` é o prisma global (leitura)
 * ou o `tx` da transação (detecção de estouro), para que a soma inclua o
 * registro recém-gravado.
 */
async function fleetUsageByItem(
  client: Prisma.TransactionClient,
  qddItemIds: string[]
): Promise<Map<string, Prisma.Decimal>> {
  const [reserved, consumed, serviceOrders] = await Promise.all([
    client.fleetFueling.groupBy({
      by: ['qddItemId'],
      where: {
        qddItemId: { in: qddItemIds },
        status: 'ISSUED',
        deletedAt: null,
        lifecycle: { in: [...FLEET_RESERVING_LIFECYCLES] },
      },
      orderBy: { qddItemId: 'asc' },
      _sum: { maxAmount: true },
    }),
    client.fleetFueling.findMany({
      where: {
        qddItemId: { in: qddItemIds },
        status: 'ISSUED',
        deletedAt: null,
        lifecycle: { in: [...FLEET_CONSUMED_LIFECYCLES] },
      },
      select: { qddItemId: true, maxAmount: true, redemption: { select: { totalAmount: true } } },
    }),
    client.fleetServiceOrder.groupBy({
      by: ['qddItemId'],
      where: {
        qddItemId: { in: qddItemIds },
        deletedAt: null,
        status: { in: [...FLEET_COMMITTED_SERVICE_ORDER_STATUSES] },
      },
      orderBy: { qddItemId: 'asc' },
      _sum: { totalAmount: true },
    }),
  ])

  const usage = new Map<string, Prisma.Decimal>()
  const add = (qddItemId: string | null, amount: Prisma.Decimal | null | undefined) => {
    if (!qddItemId || !amount) return
    usage.set(qddItemId, (usage.get(qddItemId) ?? new Prisma.Decimal(0)).plus(amount))
  }
  for (const row of reserved) add(row.qddItemId, row._sum.maxAmount)
  for (const row of consumed) add(row.qddItemId, row.redemption?.totalAmount ?? row.maxAmount)
  for (const row of serviceOrders) add(row.qddItemId, row._sum.totalAmount)
  return usage
}

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

    const [items, dailyAllowanceSums, virtualProcessSums, covenantSums, fleetUsage] = await Promise.all([
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
      // Convênios (Fase 3, 2026-09-24): mesma ideia de VirtualProcess — o
      // valor de transferência já vinculado a uma ficha É o consumo, sem
      // distinção de fase/status do convênio.
      prisma.covenant.groupBy({
        by: ['qddItemId'],
        where: { organizationId, qddItemId: { in: qddItemIds } },
        orderBy: { qddItemId: 'asc' },
        _sum: { transferValue: true },
      }),
      // Simplifica Frotas: autorizações de abastecimento e OS (ver fleetUsageByItem).
      fleetUsageByItem(prisma, qddItemIds),
    ])

    const usedByItem = new Map<string, Prisma.Decimal>()
    const add = (qddItemId: string | null, amount: Prisma.Decimal | null) => {
      if (!qddItemId || !amount) return
      usedByItem.set(qddItemId, (usedByItem.get(qddItemId) ?? ZERO).plus(amount))
    }
    for (const row of dailyAllowanceSums) add(row.qddItemId, row._sum.totalAmount)
    for (const row of virtualProcessSums) add(row.qddItemId, row._sum.totalValue)
    for (const row of covenantSums) add(row.qddItemId, row._sum.transferValue)
    for (const [qddItemId, amount] of fleetUsage) add(qddItemId, amount)

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
    const [qddItem, dailySum, processSum, covenantSum, fleetUsage] = await Promise.all([
      tx.qddItem.findUnique({ where: { id: qddItemId }, select: { valorOrcado: true } }),
      tx.dailyAllowance.aggregate({
        where: { qddItemId, status: { in: COMMITTED_DAILY_ALLOWANCE_STATUSES } },
        _sum: { totalAmount: true },
      }),
      tx.virtualProcess.aggregate({
        where: { qddItemId },
        _sum: { totalValue: true },
      }),
      // Convênios (Fase 3, 2026-09-24) — mesmo tratamento de VirtualProcess.
      tx.covenant.aggregate({
        where: { qddItemId },
        _sum: { transferValue: true },
      }),
      fleetUsageByItem(tx, [qddItemId]),
    ])

    if (!qddItem) return false

    const total = (dailySum._sum.totalAmount ?? ZERO)
      .plus(processSum._sum.totalValue ?? ZERO)
      .plus(covenantSum._sum.transferValue ?? ZERO)
      .plus(fleetUsage.get(qddItemId) ?? ZERO)
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
