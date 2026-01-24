import { expect, test, describe } from 'vitest'
import { db } from '../utils/database'

describe('Database Auth Helpers', () => {
  test('deve retornar falso para uma sessão inexistente', async () => {
    const session = await db.findActiveSession('token-invalido')
    expect(session).toBeNull()
  })

  test('deve verificar permissões de um usuário inexistente como array vazio', async () => {
    const permissions = await db.getUserPermissions('id-que-nao-existe')
    expect(permissions).toEqual([])
  })
})