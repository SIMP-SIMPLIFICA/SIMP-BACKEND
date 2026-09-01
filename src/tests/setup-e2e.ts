import { afterAll, beforeAll, beforeEach } from 'vitest'
import type { AppServer } from '@/types/server'
import { prisma } from '@/lib/prisma.js'
import { buildApp } from '@/app.js'
import { assertIsTestDatabaseUrl, getDatabaseName } from './e2e-database.js'

/**
 * Setup por arquivo de teste de integração.
 *
 * Sobe a instância REAL do Fastify (mesma função usada em produção) e a expõe
 * para `app.inject()`. Nenhuma porta é aberta: `inject` percorre a árvore de
 * rotas em memória, o que torna os testes rápidos e sem conflito de porta.
 */

let app: AppServer

/** Instância do Fastify para os testes. Disponível a partir do `beforeAll`. */
export function getApp(): AppServer {
  if (!app) {
    throw new Error('A aplicação ainda não foi construída. Use dentro de um teste.')
  }
  return app
}

export { prisma }

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL ausente no ambiente de teste. Rode via "npm run test:e2e".')
  }
  return url
}

/**
 * CAMADA 3 DA TRAVA — a mais importante.
 *
 * Pergunta ao próprio Postgres em qual banco a conexão caiu, em vez de confiar
 * na variável de ambiente. Se a resposta não for o banco de teste, aborta antes
 * de qualquer escrita. É o que protege contra a URL certa na configuração e a
 * conexão errada na prática (cache de módulo, singleton reaproveitado, variável
 * sobrescrita depois).
 */
async function assertConnectedToTestDatabase(): Promise<string> {
  // A URL já chega pronta pelo `env` do vitest.config.e2e.ts. Aqui ela é
  // apenas RECONFERIDA — se não for um banco de teste, aborta antes de escrever.
  const expected = getDatabaseName(assertIsTestDatabaseUrl(requireDatabaseUrl()))

  const [{ current_database: actual }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`

  if (actual !== expected) {
    throw new Error(
      `ABORTADO: conectado ao banco "${actual}", mas os testes de integração exigem "${expected}". ` +
      'Nenhuma tabela foi tocada. Verifique DATABASE_URL no ambiente de teste.'
    )
  }

  return actual
}

/**
 * Esvazia todas as tabelas do banco de teste.
 *
 * A lista de tabelas vem do `information_schema` do banco em que estamos, e não
 * de uma lista fixa no código: assim uma tabela nova nasce já sendo limpa, sem
 * ninguém precisar lembrar de atualizar este arquivo. `_prisma_migrations` é
 * preservada para não desfazer o trabalho do globalSetup.
 *
 * TRUNCATE ... CASCADE resolve a ordem das chaves estrangeiras sozinho —
 * apagar tabela a tabela exigiria respeitar a topologia de dependências.
 */
export async function resetDatabase(): Promise<void> {
  await assertConnectedToTestDatabase()

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `

  if (tables.length === 0) return

  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

beforeAll(async () => {
  const database = await assertConnectedToTestDatabase()
  console.info(`[e2e] conectado ao banco de teste "${database}"`)

  app = await buildApp()
  await app.ready()
})

// Cada teste começa com o banco vazio: um teste nunca deve depender do que
// outro deixou para trás.
beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})
