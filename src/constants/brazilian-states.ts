/**
 * Unidades da Federação — nome por extenso e artigo, para o texto padrão do
 * Recibo ("Estado do Tocantins", "Estado de São Paulo").
 *
 * O artigo não é uniforme em português ("do" Tocantins, "de" São Paulo, "da"
 * Bahia) — por isso o mapa carrega o artigo junto, em vez de uma regra
 * genérica que erraria a metade dos estados.
 */

export interface BrazilianState {
  name: string
  /** Artigo que antecede o nome: "Estado DO Tocantins", "Estado DE São Paulo". */
  article: string
}

export const BRAZILIAN_STATES: Record<string, BrazilianState> = {
  AC: { name: 'Acre', article: 'do' },
  AL: { name: 'Alagoas', article: 'de' },
  AP: { name: 'Amapá', article: 'do' },
  AM: { name: 'Amazonas', article: 'do' },
  BA: { name: 'Bahia', article: 'da' },
  CE: { name: 'Ceará', article: 'do' },
  DF: { name: 'Distrito Federal', article: 'do' },
  ES: { name: 'Espírito Santo', article: 'do' },
  GO: { name: 'Goiás', article: 'de' },
  MA: { name: 'Maranhão', article: 'do' },
  MT: { name: 'Mato Grosso', article: 'do' },
  MS: { name: 'Mato Grosso do Sul', article: 'do' },
  MG: { name: 'Minas Gerais', article: 'de' },
  PA: { name: 'Pará', article: 'do' },
  PB: { name: 'Paraíba', article: 'da' },
  PR: { name: 'Paraná', article: 'do' },
  PE: { name: 'Pernambuco', article: 'de' },
  PI: { name: 'Piauí', article: 'do' },
  RJ: { name: 'Rio de Janeiro', article: 'do' },
  RN: { name: 'Rio Grande do Norte', article: 'do' },
  RS: { name: 'Rio Grande do Sul', article: 'do' },
  RO: { name: 'Rondônia', article: 'de' },
  RR: { name: 'Roraima', article: 'de' },
  SC: { name: 'Santa Catarina', article: 'de' },
  SP: { name: 'São Paulo', article: 'de' },
  SE: { name: 'Sergipe', article: 'de' },
  TO: { name: 'Tocantins', article: 'do' },
}

/** "Estado do Tocantins", ou string vazia quando a UF não é reconhecida. */
export function formatStateLong(uf: string | null | undefined): string {
  const state = uf ? BRAZILIAN_STATES[uf.toUpperCase()] : undefined
  return state ? `Estado ${state.article} ${state.name}` : ''
}
