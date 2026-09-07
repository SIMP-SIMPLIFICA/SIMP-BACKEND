import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'

/**
 * Cadastro de beneficiários de diárias.
 *
 * Existe para AUTOCOMPLETAR o nome de quem viaja. Não é a fonte de verdade do
 * documento emitido: a diária grava o nome como texto, para que excluir ou
 * renomear um beneficiário aqui jamais altere um recibo já entregue.
 *
 * Isolamento multi-tenant: toda consulta e escrita passa pelo `organizationId`
 * do token. Duas prefeituras podem ter servidores homônimos, e nenhuma enxerga
 * a lista da outra.
 */

export class BeneficiaryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_ORGANIZATION' | 'INVALID_NAME',
    message: string
  ) {
    super(message)
    this.name = 'BeneficiaryError'
  }
}

export interface RequestScope {
  organizationId: string
  userId: string
}

/**
 * Normaliza o nome antes de gravar.
 *
 * CAIXA ALTA é exigência do cliente, mas sozinha não basta: sem colapsar os
 * espaços internos, "JOÃO  SILVA" e "JOÃO SILVA" passariam pela restrição de
 * unicidade como pessoas diferentes, que é exatamente o que ela deveria
 * impedir.
 */
export function normalizeBeneficiaryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase()
}

export const beneficiaryService = {
  /** Lista os beneficiários da organização, em ordem alfabética. */
  async list(scope: RequestScope, search?: string) {
    const where: Prisma.BeneficiaryWhereInput = { organizationId: scope.organizationId }

    if (search?.trim()) {
      // `insensitive` porque o usuário digita em minúsculas enquanto o banco
      // guarda em caixa alta.
      where.name = { contains: search.trim(), mode: 'insensitive' }
    }

    return prisma.beneficiary.findMany({
      where,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, createdAt: true },
    })
  },

  /**
   * Cria o beneficiário, ou devolve o existente quando o nome já está cadastrado.
   *
   * IDEMPOTENTE DE PROPÓSITO: a interface tenta criar o nome sempre que o campo
   * perde o foco, e não tem como saber se ele já existe sem uma consulta extra.
   * Tratar a violação de unicidade (P2002) como sucesso evita um erro que não
   * significa nada para o usuário — ele queria que o nome estivesse na lista, e
   * está.
   *
   * Devolve `created` para o controller escolher entre 201 e 200 sem precisar
   * de uma consulta extra só para descobrir se o registro já existia.
   */
  async create(name: string, scope: RequestScope) {
    const normalized = normalizeBeneficiaryName(name)

    if (!normalized) {
      throw new BeneficiaryError('INVALID_NAME', 'Informe o nome do beneficiário.')
    }

    try {
      const created = await prisma.beneficiary.create({
        data: { name: normalized, organizationId: scope.organizationId },
        select: { id: true, name: true, createdAt: true },
      })
      return { beneficiary: created, created: true }
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'

      if (!isDuplicate) throw error

      const existing = await prisma.beneficiary.findFirst({
        where: { name: normalized, organizationId: scope.organizationId },
        select: { id: true, name: true, createdAt: true },
      })

      // A corrida é teoricamente possível: dois pedidos simultâneos com o mesmo
      // nome, e o registro sumindo entre o erro e esta busca. Nesse caso o
      // chamador merece saber, em vez de receber null disfarçado de sucesso.
      if (!existing) {
        throw new BeneficiaryError(
          'NOT_FOUND',
          'Não foi possível recuperar o beneficiário já existente.'
        )
      }
      return { beneficiary: existing, created: false }
    }
  },

  /**
   * Remove um beneficiário do cadastro.
   *
   * Não afeta diárias já registradas: elas guardam o nome como texto, então o
   * histórico permanece íntegro.
   */
  async remove(id: string, scope: RequestScope) {
    const existing = await prisma.beneficiary.findFirst({
      where: { id, organizationId: scope.organizationId },
      select: { id: true },
    })

    if (!existing) {
      throw new BeneficiaryError('NOT_FOUND', 'Beneficiário não encontrado.')
    }

    await prisma.beneficiary.delete({ where: { id } })
  },
}
