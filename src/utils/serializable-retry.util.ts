import { Prisma } from '@prisma/client'

/**
 * Retenta uma operação sob isolamento Serializable até `maxAttempts` vezes
 * quando o Postgres rejeita por conflito de serialização (Prisma P2034) —
 * cenário esperado sob concorrência real (duas requisições calculando o
 * próximo número/saldo ao mesmo tempo), não um erro de programação.
 *
 * Extraído de `protocol.controller.ts` (numeração de `OfficialDocument`) para
 * ser reaproveitado pela numeração de `DailyAllowance` (Épico 8, FR-002) sem
 * duplicar a lógica de retry.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isSerializationConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
      if (!isSerializationConflict || attempt === maxAttempts) throw err
    }
  }
  // Inalcançável: o loop sempre retorna ou lança na última tentativa.
  throw new Error('withSerializableRetry: falha inesperada')
}
