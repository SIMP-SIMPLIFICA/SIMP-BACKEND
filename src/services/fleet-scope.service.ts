import { prisma } from '@/lib/prisma.js'
import { userHasPermission } from '@/services/rbac.service.js'
import { FleetError } from '@/services/fleet-error.js'

/**
 * Escopo de quem chama uma rota do Frotas.
 *
 * `organizationId` e `userId` vêm SEMPRE do token (nunca do corpo, da query ou da
 * URL). O escopo por departamento segue a spec (TASK 1): sem `fleet:all_departments`
 * o usuário só enxerga os departamentos de que é membro ou gestor. Registro sem
 * departamento é a "frota geral" da organização e fica visível a todos com
 * `fleet:read`.
 */
export interface FleetScope {
  organizationId: string
  userId: string
  allDepartments: boolean
  /** Departamentos (da própria organização) de que o usuário é membro ou gestor. */
  departmentIds: string[]
  ip?: string
  userAgent?: string | null
}

export async function resolveFleetScope(input: {
  organizationId: string | null | undefined
  userId: string | undefined
  ip?: string
  userAgent?: string | null
}): Promise<FleetScope> {
  const { organizationId, userId } = input
  if (!organizationId || !userId) {
    throw new FleetError(
      'NO_ORGANIZATION',
      'Seu usuário não está vinculado a uma organização. O módulo Frota só funciona dentro de uma prefeitura.'
    )
  }

  const [allDepartments, user] = await Promise.all([
    userHasPermission(userId, 'fleet:all_departments'),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        departments: { where: { organizationId }, select: { id: true } },
        managedDepartments: { where: { organizationId }, select: { id: true } },
      },
    }),
  ])

  const departmentIds = [
    ...new Set([...(user?.departments ?? []), ...(user?.managedDepartments ?? [])].map(d => d.id)),
  ]

  return { organizationId, userId, allDepartments, departmentIds, ip: input.ip, userAgent: input.userAgent }
}

/** Filtro Prisma de departamento para listagens e buscas por id. */
export function departmentWhere(scope: FleetScope) {
  if (scope.allDepartments) return {}
  return { OR: [{ departmentId: null }, { departmentId: { in: scope.departmentIds } }] }
}

/**
 * Confere um departamento informado no corpo: precisa existir NA organização do
 * token e estar no escopo do usuário. Departamento de outra organização recebe a
 * mesma resposta de "não existe" — nunca confirma a existência.
 */
export async function assertDepartmentAllowed(scope: FleetScope, departmentId: string | null | undefined) {
  if (!departmentId) return

  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId: scope.organizationId },
    select: { id: true },
  })
  if (!department) {
    throw new FleetError('INVALID_DEPARTMENT', 'O departamento informado não existe nesta organização. Escolha um departamento da lista.')
  }
  if (!scope.allDepartments && !scope.departmentIds.includes(departmentId)) {
    throw new FleetError(
      'DEPARTMENT_OUT_OF_SCOPE',
      'Você só pode cadastrar na frota dos departamentos de que faz parte. Peça ao gestor de frota a permissão para todos os departamentos.'
    )
  }
}
