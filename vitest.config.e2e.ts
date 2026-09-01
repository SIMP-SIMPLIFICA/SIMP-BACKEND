import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { maskUrl, resolveTestDatabaseUrl } from './src/tests/e2e-database.js'

/**
 * Configuração dos testes de INTEGRAÇÃO (E2E).
 *
 * Separada da configuração unitária de propósito: estes testes sobem o Fastify
 * de verdade e batem num Postgres real, então precisam de banco isolado, setup
 * próprio e execução sequencial. Misturar as duas suítes num só comando faria
 * `npm test` depender de banco no ar.
 *
 * CAMADA 1 DA TRAVA DE BANCO: a URL de teste é resolvida AQUI, antes de
 * qualquer módulo da aplicação ser carregado. É indispensável porque
 * `src/lib/prisma.ts` lê `DATABASE_URL` no momento do import — definir a
 * variável dentro de um teste já seria tarde demais.
 */

// Carrega o .env do projeto para conseguir derivar a URL de teste a partir dela.
loadEnv()

const testDatabaseUrl = resolveTestDatabaseUrl(process.env.DATABASE_URL)
console.info(`[e2e] DATABASE_URL dos testes: ${maskUrl(testDatabaseUrl)}`)

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.e2e.spec.ts'],

    // Injetada no ambiente ANTES de os módulos de teste carregarem — é o que
    // garante que o cliente Prisma nasça apontando para o banco de teste.
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
    },

    globalSetup: ['./src/tests/global-setup-e2e.ts'],
    setupFiles: ['./src/tests/setup-e2e.ts'],

    // Sequencial e num único processo: os testes compartilham UM banco e
    // truncam tabelas entre si. Em paralelo, um arquivo apagaria os dados que
    // outro acabou de inserir.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,

    // Banco real e boot completo do Fastify são mais lentos que teste unitário.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
})
