/**
 * Isolamento do banco de dados dos testes de integração.
 *
 * ⚠️ ESTE ARQUIVO É A TRAVA DE SEGURANÇA. Testes de integração truncam tabelas.
 * Se a URL apontar para o banco de desenvolvimento, o trabalho local do
 * desenvolvedor é apagado. Por isso a proteção tem TRÊS camadas independentes:
 *
 *   1. BANCO SEPARADO, não schema separado. Um schema errado ainda vive dentro
 *      do banco de desenvolvimento; um banco separado não tem como alcançá-lo.
 *   2. VERIFICAÇÃO DO NOME antes de qualquer conexão: a URL de teste precisa
 *      terminar em `_e2e` e ser diferente da URL de desenvolvimento.
 *   3. VERIFICAÇÃO EM TEMPO DE EXECUÇÃO contra o próprio Postgres
 *      (`SELECT current_database()`) antes de truncar qualquer coisa. Mesmo que
 *      as duas primeiras falhem, esta pergunta ao servidor "em que banco eu
 *      estou de fato?" impede a destruição.
 *
 * NÃO importa o cliente Prisma da aplicação: ele lê DATABASE_URL no momento do
 * import, e este módulo precisa rodar ANTES disso para poder decidir qual URL
 * será usada.
 */

/** Sufixo obrigatório do banco de teste. É o que a camada 2 verifica. */
const REQUIRED_SUFFIX = '_e2e'

/**
 * Deriva a URL do banco de teste a partir da URL de desenvolvimento,
 * trocando apenas o NOME DO BANCO e preservando host, porta e credenciais.
 *
 * `E2E_DATABASE_URL` sobrescreve, para quem quiser apontar para outro servidor.
 * A trava vale igualmente para o valor sobrescrito.
 */
export function resolveTestDatabaseUrl(sourceUrl: string | undefined): string {
  const override = process.env.E2E_DATABASE_URL
  if (override) return assertIsTestDatabaseUrl(override, sourceUrl)

  if (!sourceUrl) {
    throw new Error(
      'DATABASE_URL não definida. Os testes de integração precisam dela para derivar o banco de teste.'
    )
  }

  const url = new URL(sourceUrl)
  const databaseName = url.pathname.replace(/^\//, '')

  if (!databaseName) {
    throw new Error(`Não foi possível identificar o nome do banco em: ${maskUrl(sourceUrl)}`)
  }

  // IDEMPOTENTE: dentro do processo de teste, DATABASE_URL JÁ é a de teste.
  // Sem esta guarda, derivar de novo produziria "..._e2e_e2e" e apontaria para
  // um banco que não existe.
  if (databaseName.endsWith(REQUIRED_SUFFIX)) {
    return assertIsTestDatabaseUrl(sourceUrl)
  }

  url.pathname = `/${databaseName}${REQUIRED_SUFFIX}`
  return assertIsTestDatabaseUrl(url.toString(), sourceUrl)
}

/** Nome do banco contido numa URL de conexão. */
export function getDatabaseName(connectionUrl: string): string {
  return new URL(connectionUrl).pathname.replace(/^\//, '')
}

/**
 * CAMADA 2 — recusa qualquer URL que não seja inequivocamente de teste.
 * Lança em vez de avisar: um teste que não roda é um problema; um teste que
 * apaga o banco de desenvolvimento é um desastre.
 */
export function assertIsTestDatabaseUrl(testUrl: string, sourceUrl?: string): string {
  const testDatabase = getDatabaseName(testUrl)

  if (!testDatabase.endsWith(REQUIRED_SUFFIX)) {
    throw new Error(
      `RECUSADO: o banco de teste precisa terminar em "${REQUIRED_SUFFIX}", mas veio "${testDatabase}". ` +
      'Isto existe para impedir que os testes apaguem o banco de desenvolvimento.'
    )
  }

  if (sourceUrl) {
    const sourceDatabase = getDatabaseName(sourceUrl)
    if (sourceDatabase === testDatabase) {
      throw new Error(
        `RECUSADO: banco de teste e de desenvolvimento são o MESMO ("${testDatabase}").`
      )
    }
  }

  return testUrl
}

/**
 * URL de conexão com o banco administrativo `postgres`, no mesmo servidor.
 * Usada só para criar o banco de teste — não dá para criar um banco estando
 * conectado a ele.
 */
export function resolveMaintenanceUrl(testUrl: string): string {
  const url = new URL(testUrl)
  url.pathname = '/postgres'
  return url.toString()
}

/** Esconde a senha ao imprimir uma URL em log ou mensagem de erro. */
export function maskUrl(connectionUrl: string): string {
  try {
    const url = new URL(connectionUrl)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '(url inválida)'
  }
}
