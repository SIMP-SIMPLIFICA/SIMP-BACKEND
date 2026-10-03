import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'

/**
 * Regra de visibilidade dos protocolos oficiais.
 *
 * EXTRAÍDA PARA UM LUGAR SÓ de propósito. A regra estava embutida no `list` do
 * controller, e o relatório precisa exatamente dela: uma segunda implementação
 * que divergisse com o tempo viraria vazamento de documento entre setores — o
 * relatório mostrando o que a listagem esconde.
 *
 * Quem é admin (ou super admin) vê tudo da organização. Os demais veem a caixa
 * compartilhada do próprio departamento, incluindo documentos legados que não
 * têm `departmentId` e são identificados pelo `sector` gravado na época.
 */

export interface ProtocolAccessScope {
  organizationId?: string | null
  userId: string
  isSuperAdmin?: boolean
  permissions?: string[]
}

export function hasProtocolAdminAccess(scope: ProtocolAccessScope): boolean {
  return Boolean(scope.isSuperAdmin || scope.permissions?.includes('protocols:admin'))
}

/**
 * Monta o filtro Prisma que delimita o que o usuário pode ver.
 *
 * Consulta o departamento do usuário quando ele não é admin — por isso é
 * assíncrona.
 */
export async function buildProtocolVisibilityFilter(
  scope: ProtocolAccessScope
): Promise<Prisma.OfficialDocumentWhereInput> {
  // Super admin atravessa organizações (diagnóstico de plataforma); os demais
  // ficam presos à própria.
  const where: Prisma.OfficialDocumentWhereInput = scope.isSuperAdmin
    ? {}
    : { organizationId: scope.organizationId ?? undefined }

  if (hasProtocolAdminAccess(scope)) return where

  const userRecord = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: { departments: { take: 1, select: { id: true, code: true } } },
  })

  const department = userRecord?.departments[0]

  if (department) {
    where.OR = [
      { departmentId: department.id },
      // Legado: antes do vínculo por id, o setor era um texto no documento.
      { departmentId: null, sector: department.code.toUpperCase() },
    ]
  } else {
    // Sem departamento, o usuário só alcança o que ele mesmo criou.
    where.creatorId = scope.userId
  }

  return where
}
