/**
 * Autor de cadastro/alteração no Frotas ("criado por", "alterado por").
 *
 * Só id e nome: e-mail, CPF e o resto do perfil do usuário não saem por aqui.
 */
export const USER_REF_SELECT = { id: true, firstName: true, lastName: true, fullName: true } as const

export interface FleetUserRef {
  id: string
  name: string
}

export function toUserRef(
  user: { id: string; firstName: string | null; lastName: string | null; fullName: string | null } | null
): FleetUserRef | null {
  if (!user) return null
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.fullName || 'Usuário sem nome'
  return { id: user.id, name }
}
