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
 *   2. Aplica o schema do Prisma nele.
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
  pushSchema(testUrl, databaseName)
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

function pushSchema(testUrl: string, databaseName: string) {
  console.info(`[e2e] aplicando schema em "${databaseName}"...`)

  // `--accept-data-loss` é seguro AQUI e somente aqui: o alvo é o banco
  // dedicado de teste, cujo nome já foi validado pela trava de sufixo.
  // `shell: true` é necessário no Windows: o `npx` de lá é um .cmd, e o Node
  // recusa executá-lo diretamente (EINVAL). O comando é uma constante deste
  // arquivo e a URL viaja pelo AMBIENTE, nunca pela linha de comando — então
  // não há interpolação de entrada externa no shell.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  })

  console.info('[e2e] schema aplicado')
}
