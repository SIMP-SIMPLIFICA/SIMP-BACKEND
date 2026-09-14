import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { maskCpf, normalizeCpf } from '@/utils/cpf.util.js'

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
    readonly code:
      | 'NOT_FOUND'
      | 'NO_ORGANIZATION'
      | 'INVALID_NAME'
      | 'INVALID_CPF'
      | 'DUPLICATE_CPF'
      | 'CPF_MISMATCH',
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

/** Campos devolvidos ao cliente. O CPF sai SEMPRE mascarado — ver `toPublic`. */
const SELECT = { id: true, name: true, cpf: true, createdAt: true } as const

/**
 * Forma de saída do beneficiário.
 *
 * O CPF vai mascarado mesmo para quem tem permissão de leitura. O número
 * completo serve para BUSCA EXATA, não para exibição: uma vez devolvido pela
 * API, ele está no `devtools`, no cache do navegador e em qualquer tela que
 * consuma a rota. Mascarar na borda é o que torna a promessa de FR-019
 * verdadeira em vez de uma convenção de tela que o próximo componente esquece.
 */
function toPublic(record: { id: string; name: string; cpf: string | null; createdAt: Date }) {
  return { ...record, cpf: record.cpf ? maskCpf(record.cpf) : null }
}

export const beneficiaryService = {
  /** Lista os beneficiários da organização, em ordem alfabética. */
  async list(scope: RequestScope, search?: string, cpf?: string) {
    const where: Prisma.BeneficiaryWhereInput = { organizationId: scope.organizationId }

    if (search?.trim()) {
      // `insensitive` porque o usuário digita em minúsculas enquanto o banco
      // guarda em caixa alta.
      where.name = { contains: search.trim(), mode: 'insensitive' }
    }

    // CPF é casamento EXATO, nunca parcial: busca parcial por CPF transformaria
    // a rota num oráculo de "este número existe aqui?", varrível por tentativa.
    const exactCpf = normalizeCpf(cpf)
    if (exactCpf) where.cpf = exactCpf
    // CPF informado porém malformado não pode virar "sem filtro" — devolveria a
    // lista inteira para quem pediu uma pessoa só.
    else if (cpf?.trim()) return []

    const records = await prisma.beneficiary.findMany({
      where,
      orderBy: { name: 'asc' },
      select: SELECT,
    })

    return records.map(toPublic)
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
  async create(name: string, scope: RequestScope, rawCpf?: string | null) {
    const normalized = normalizeBeneficiaryName(name)

    if (!normalized) {
      throw new BeneficiaryError('INVALID_NAME', 'Informe o nome do beneficiário.')
    }

    // Campo em branco é "não informou"; preenchido e inválido é erro do usuário,
    // e engolir isso gravaria meio CPF que nunca casaria numa busca exata.
    const cpf = rawCpf?.trim() ? normalizeCpf(rawCpf) : null
    if (rawCpf?.trim() && !cpf) {
      throw new BeneficiaryError('INVALID_CPF', 'Informe um CPF válido, com 11 dígitos.')
    }

    try {
      const created = await prisma.beneficiary.create({
        data: { name: normalized, cpf, organizationId: scope.organizationId },
        select: SELECT,
      })
      return { beneficiary: toPublic(created), created: true }
    } catch (error) {
      // Estreita o tipo de fato, em vez de guardar um booleano: é isso que dá
      // acesso seguro a `error.meta` logo abaixo.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error
      }

      // Há DUAS restrições de unicidade — nome e CPF —, e cada uma pede uma
      // resposta diferente. Sem olhar qual delas estourou, um CPF repetido cairia
      // na busca por nome, não acharia nada e viraria um 404 sem sentido.
      const target = String(error.meta?.target ?? '')

      if (cpf && target.includes('cpf')) {
        throw new BeneficiaryError(
          'DUPLICATE_CPF',
          'Este CPF já está cadastrado para outro beneficiário nesta organização.'
        )
      }

      const existing = await prisma.beneficiary.findFirst({
        where: { name: normalized, organizationId: scope.organizationId },
        select: SELECT,
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

      // Nome já cadastrado COM outro CPF: quase sempre erro de digitação, e
      // sobrescrever em silêncio trocaria o CPF de uma pessoa sem ninguém notar.
      if (cpf && existing.cpf && existing.cpf !== cpf) {
        throw new BeneficiaryError(
          'CPF_MISMATCH',
          `"${existing.name}" já está cadastrado com outro CPF. Confira o número informado.`
        )
      }

      // Nome já cadastrado SEM CPF, e agora veio um: completa o cadastro. É o
      // fluxo normal da criação rápida — o nome entra primeiro, o CPF depois.
      if (cpf && !existing.cpf) {
        const completed = await prisma.beneficiary.update({
          where: { id: existing.id },
          data: { cpf },
          select: SELECT,
        })
        return { beneficiary: toPublic(completed), created: false }
      }

      return { beneficiary: toPublic(existing), created: false }
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
