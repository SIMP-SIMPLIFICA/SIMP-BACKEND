import { prisma } from '@/lib/prisma.js'

/**
 * O setor existe e pertence a ESTA organização?
 *
 * A chave estrangeira do banco não responde isso: ela só garante que o
 * `departmentId` aponta para ALGUM departamento, não que ele seja da mesma
 * prefeitura. Sem esta conferência, um identificador copiado de outro tenant
 * vincularia o convênio, o processo ou a dotação ao setor alheio — e a listagem
 * de lá passaria a exibir um registro que não é dela.
 *
 * Devolve booleano em vez de lançar: cada módulo tem seu próprio erro de
 * domínio e seu próprio código HTTP.
 */
export async function departmentExistsInOrganization(
  departmentId: string,
  organizationId: string
): Promise<boolean> {
  const found = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
    select: { id: true },
  })

  return found !== null
}
