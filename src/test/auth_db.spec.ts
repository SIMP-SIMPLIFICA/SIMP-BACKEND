import { expect, test, describe } from 'vitest'
import { db } from '../utils/database.js'

describe('Database Auth Helpers', () => {
  test('deve retornar falso para uma sessão inexistente', async () => {
    const session = await db.findActiveSession('token-invalido')
    expect(session).toBeNull()
  })

  test('deve verificar permissões de um usuário inexistente como array vazio', async () => {
    // UUID sintaticamente válido mas inexistente: User.id é @db.Uuid, então uma
    // string arbitrária faz o Postgres rejeitar a query antes de responder "não
    // encontrado" — o que testaria o driver, não a nossa regra.
    const permissions = await db.getUserPermissions('00000000-0000-4000-8000-000000000000')
    expect(permissions).toEqual([])
  })
})