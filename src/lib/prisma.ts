import { PrismaClient } from '@prisma/client'

// ── Connection architecture ──────────────────────────────────────────────────
// PRIMARY  → DATABASE_URL        → Supavisor pooler (port 6543, pgbouncer=true)
//            Handles ALL writes and transactions.
// REPLICA  → DATABASE_REPLICA_URL → Same pooler on Free tier (fake replica).
//            Swap for a real read-replica URL on Pro tier.

const isProduction = process.env.NODE_ENV === 'production'

function createPrismaClient(url: string | undefined, label: string): PrismaClient {
  if (!url) {
    throw new Error(`[prisma:${label}] Missing database URL — check your .env file`)
  }

  const client = new PrismaClient({
    datasourceUrl: url,
    log: isProduction
      ? ['error']
      : [{ emit: 'event', level: 'query' }, 'error', 'warn'],
  })

  if (!isProduction) {
    client.$on('query' as never, (e: { query: string; duration: number }) => {
      if (e.duration > 150) {
        console.warn(`[prisma:${label}] slow ${e.duration}ms — ${e.query.slice(0, 100)}`)
      }
    })
  }

  return client
}

// Singleton: prevents new connections on hot-reload in development.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaRead?: PrismaClient
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient(process.env.DATABASE_URL, 'write')

export const prismaRead: PrismaClient =
  globalForPrisma.prismaRead ??
  (process.env.DATABASE_REPLICA_URL
    ? createPrismaClient(process.env.DATABASE_REPLICA_URL, 'read')
    : prisma)

if (!isProduction) {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaRead = prismaRead
}

// Warm up: verify the write connection at startup and log clearly on failure.
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`
    console.info('[prisma:write] ✅ Database connection verified')
  } catch (err) {
    console.error('[prisma:write] ❌ Cannot reach database:', err)
    console.error('[prisma:write] Check DATABASE_URL in .env — Supavisor pooler at port 6543')
    throw err
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect()
  if (prismaRead !== prisma) await prismaRead.$disconnect()
}
