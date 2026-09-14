/**
 * Ordenador de Despesa do setor.
 *
 * É SEMPRE o chefe do departamento — o usuário apontado em `Department.manager`.
 * Antes existia um `chiefName` de texto livre, desvinculado do cadastro, e ele
 * inevitavelmente divergia: alguém trocava o secretário no organograma e o nome
 * impresso nos empenhos continuava o do antecessor. Derivar do gestor elimina
 * essa divergência pela raiz, porque só há um lugar para corrigir.
 *
 * O nome sai em texto plano nos documentos, e isso é deliberado: quem ordena
 * despesa pública o faz no exercício do cargo, e a ofuscação da LGPD recai
 * sobre quem EXPORTOU o arquivo, não sobre a autoridade do ato.
 */

export interface DepartmentManager {
  firstName?: string | null
  lastName?: string | null
}

/** Rótulo usado quando o setor ainda não tem chefe apontado. */
export const NO_CHIEF_LABEL = 'Não informado'

/**
 * Nome do ordenador, ou o rótulo de ausência.
 *
 * Nunca devolve string vazia: um campo em branco num documento oficial parece
 * falha de impressão, enquanto "Não informado" diz que o cadastro está
 * incompleto — e é isso que o setor precisa resolver.
 */
export function resolveChiefName(manager: DepartmentManager | null | undefined): string {
  const name = [manager?.firstName, manager?.lastName].filter(Boolean).join(' ').trim()
  return name || NO_CHIEF_LABEL
}
