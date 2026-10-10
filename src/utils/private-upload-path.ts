/**
 * Escopos do storage que NUNCA saem pelo estático `/uploads`: o PDF da
 * autorização de abastecimento carrega o QR de uso único (vale ao portador) e a
 * foto do cupom é dado fiscal. Só as rotas autenticadas e auditadas do Frotas
 * os leem, com `readFile`.
 *
 * O `pathname` que o @fastify/static entrega já vem decodificado pelo
 * roteador, e o `send` serve exatamente essa string — então a checagem é feita
 * nela, sem decodificar de novo. Por segmento e aceitando `/` e `\` como
 * separador: no Windows o `send` normaliza `\` para separador, e um
 * `fleet-fuelings\arquivo.pdf` (`%5C` na URL) escaparia de um regex só com `/`.
 */
export function isPrivateUploadPath(pathname: string): boolean {
  return pathname.split(/[\\/]+/).some(segment => segment.toLowerCase().startsWith('fleet-'))
}
