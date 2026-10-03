import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import {
  getDatabaseName,
  maskUrl,
  resolveMaintenanceUrl,
  resolveTestDatabaseUrl,
} from './e2e-database.js'

/**
 * Preparação única da suíte de integração (Vitest `globalSetup`).
 *
 * Roda UMA vez antes de todos os arquivos de teste:
 *   1. Cria o banco de teste, se ainda não existir.
 *   2. Aplica as MIGRATIONS reais (`prisma migrate deploy`), não `db push`:
 *      assim o e2e exercita exatamente o histórico que vai para produção,
 *      inclusive o SQL que o Prisma não expressa (índice parcial, trigger de
 *      auditoria imutável — ver prisma/migrations/0_baseline).
 *
 * O banco NÃO é destruído ao final de propósito: recriar a estrutura a cada
 * execução custa segundos em toda rodada, e o conteúdo é limpo antes de cada
 * teste de qualquer forma. Quem quiser começar do zero apaga o banco à mão —
 * nome sempre terminado em `_e2e`, portanto inconfundível.
 */
export async function setup() {
  const testUrl = resolveTestDatabaseUrl(process.env.DATABASE_URL)
  const databaseName = getDatabaseName(testUrl)

  console.info(`[e2e] banco de teste: ${maskUrl(testUrl)}`)

  await createDatabaseIfMissing(testUrl, databaseName)

  try {
    deployMigrations(databaseName, testUrl)
  } catch (error) {
    // P3005: o banco tem tabelas mas nenhum histórico de migrations — é um
    // banco de teste criado pelo antigo `db push`. Como é descartável (sufixo
    // _e2e validado), recria do zero e aplica as migrations de novo.
    if (!outputOf(error).includes('P3005')) throw error
    console.info(`[e2e] "${databaseName}" foi criado sem migrations (db push antigo): recriando`)
    await recreateDatabase(testUrl, databaseName)
    deployMigrations(databaseName, testUrl)
  }
}

async function createDatabaseIfMissing(testUrl: string, databaseName: string) {
  // Conecta ao banco administrativo: não é possível criar um banco estando
  // conectado a ele.
  const admin = new PrismaClient({ datasourceUrl: resolveMaintenanceUrl(testUrl) })

  try {
    const existing = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${databaseName}
    `

    if (existing.length > 0) {
      console.info(`[e2e] banco "${databaseName}" já existe`)
      return
    }

    // CREATE DATABASE não roda dentro de transação, por isso $executeRawUnsafe.
    // O nome vem da nossa própria derivação (nunca de entrada externa) e já
    // passou pela trava de sufixo.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    console.info(`[e2e] banco "${databaseName}" criado`)
  } finally {
    await admin.$disconnect()
  }
}

/**
 * Recria o banco de teste. Só chamada quando o banco não tem histórico de
 * migrations. A trava de sufixo é conferida DE NOVO aqui, imediatamente antes
 * do DROP, para que nenhum refactor futuro consiga apontar esta função para o
 * banco de desenvolvimento.
 */
async function recreateDatabase(testUrl: string, databaseName: string) {
  if (!databaseName.endsWith('_e2e')) {
    throw new Error(`ABORTADO: "${databaseName}" não é um banco de teste (_e2e). Nada foi apagado.`)
  }
  const admin = new PrismaClient({ datasourceUrl: resolveMaintenanceUrl(testUrl) })
  try {
    // Nome derivado internamente e validado acima — nunca entrada externa.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await admin.$disconnect()
  }
}

function deployMigrations(databaseName: string, testUrl: string) {
  console.info(`[e2e] aplicando migrations em "${databaseName}"...`)

  // `execSync` com string passa pelo shell, o que é necessário no Windows: o
  // `npx` de lá é um .cmd, e o Node recusa executá-lo diretamente (EINVAL). O
  // comando é uma constante deste arquivo e a URL viaja pelo AMBIENTE, nunca
  // pela linha de comando — então não há interpolação de entrada externa.
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  })

  console.info('[e2e] migrations aplicadas')
}

/** stdout + stderr de um erro do execSync, para inspecionar o código do Prisma. */
function outputOf(error: unknown): string {
  const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
  return [e.stdout, e.stderr, e.message].map(part => (part ?? '').toString()).join('\n')
}
