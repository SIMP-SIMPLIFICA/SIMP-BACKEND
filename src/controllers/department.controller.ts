import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { MAX_PAGE_SIZE } from '@/constants/pagination.js'
import { isValidCnpj, normalizeCnpj } from '@/utils/cnpj.util.js'
import {
  DOSSIER_SECTIONS,
  DepartmentDossierError,
  type DossierSection,
  departmentDossierService,
} from '@/services/department-dossier.service.js'

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * CNPJ opcional, normalizado para dígitos e conferido pelo verificador.
 *
 * String vazia vira `null`: o formulário manda `""` quando o usuário limpa o
 * campo, e gravar isso criaria um CNPJ "em branco" diferente de ausente.
 */
const cnpjField = z
  .string()
  .trim()
  .transform(value => (value === '' ? null : normalizeCnpj(value)))
  .refine(value => value === null || isValidCnpj(value), 'CNPJ inválido.')
  .nullable()
  .optional()

/** Ordenador de despesa — nome de quem assina, não usuário do sistema. */
const chiefNameField = z.string().trim().max(150).nullable().optional()

const createSchema = z.object({
  name:        z.string().min(1).max(150).trim(),
  code:        z.string().min(1).max(20).trim().toUpperCase(),
  description: z.string().max(500).trim().optional(),
  cnpj:        cnpjField,
  chiefName:   chiefNameField,
})

const updateSchema = z.object({
  name:        z.string().min(1).max(150).trim().optional(),
  code:        z.string().min(1).max(20).trim().toUpperCase().optional(),
  description: z.string().max(500).trim().nullable().optional(),
  isActive:    z.boolean().optional(),
  managerId:   z.string().nullable().optional(),
  cnpj:        cnpjField,
  chiefName:   chiefNameField,
})

const listSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(20),
  search: z.string().optional(),
})

const addMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
})

/**
 * Seções do dossiê, em lista separada por vírgula.
 *
 * Nome desconhecido é DESCARTADO em silêncio, não recusado: o parâmetro vem de
 * um link que alguém pode ter guardado, e derrubar a exportação inteira porque
 * uma seção mudou de nome seria pior que exportar o que ainda existe. A ausência
 * de seções válidas é tratada adiante, pelo serviço.
 */
const dossierQuerySchema = z.object({
  sections: z
    .string()
    .optional()
    .transform(value =>
      value === undefined
        ? undefined
        : value
            .split(',')
            .map(part => part.trim())
            .filter((part): part is DossierSection =>
              (DOSSIER_SECTIONS as readonly string[]).includes(part)
            )
    ),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function orgId(request: FastifyRequest): string {
  return (request.user as { organizationId: string }).organizationId
}

const deptSelect = { _count: { select: { members: true } } } as const

/**
 * Confere que o setor existe NESTA organização antes de listar seus vínculos.
 *
 * As três rotas de vínculo precisam exatamente da mesma checagem. Sem ela,
 * `departmentId` de outra prefeitura devolveria lista vazia com 200 — e "vazio"
 * é indistinguível de "setor sem convênios", escondendo um erro de escopo.
 */
async function withDepartment<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  load: (id: string, organizationId: string) => Promise<T>
) {
  try {
    const organizationId = orgId(request)
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

    const exists = await prisma.department.findFirst({
      where: { id, organizationId },
      select: { id: true },
    })
    if (!exists) return reply.code(404).send({ error: 'Not Found', message: 'Departamento não encontrado.' })

    return reply.send(await load(id, organizationId))
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
    return reply.code(500).send({ error: 'List Failed', message: (err as Error).message })
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const departmentController = {

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = request.user as { organizationId: string | null, isSuperAdmin: boolean }
      const query = listSchema.parse(request.query)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const where = {
        ...orgFilter,
        ...(query.search ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { code: { contains: query.search, mode: 'insensitive' as const } },
          ],
        } : {}),
      }

      const [data, total] = await Promise.all([
        prisma.department.findMany({
          where,
          orderBy: { name: 'asc' },
          skip:  (query.page - 1) * query.limit,
          take:  query.limit,
          include: {
            ...deptSelect,
            manager: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        prisma.department.count({ where }),
      ])

      return reply.send({
        data,
        meta: {
          total,
          page:       query.page,
          limit:      query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Failed', message: (err as Error).message })
    }
  },

  /**
   * GET /:id — um setor, com o que a página de detalhe precisa no cabeçalho.
   *
   * As contagens vêm juntas para que a tela saiba quais abas têm conteúdo sem
   * disparar quatro requisições só para descobrir que três estão vazias.
   */
  async getById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

      const department = await prisma.department.findFirst({
        // O filtro por organização é o que impede ler o setor de outra
        // prefeitura conhecendo o id: 404, nunca 403, para não confirmar que
        // aquele identificador existe em algum lugar.
        where: { id, organizationId },
        include: {
          manager: { select: { id: true, firstName: true, lastName: true } },
          _count: {
            select: {
              members: true,
              councils: true,
              covenants: true,
              virtualProcesses: true,
              qddItems: true,
            },
          },
        },
      })

      if (!department) return reply.code(404).send({ error: 'Not Found', message: 'Departamento não encontrado.' })

      return reply.send(department)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Get Failed', message: (err as Error).message })
    }
  },

  /** GET /:id/councils — conselhos vinculados ao setor (N:N). */
  async listCouncils(request: FastifyRequest, reply: FastifyReply) {
    return withDepartment(request, reply, async (id, organizationId) => {
      const links = await prisma.councilDepartment.findMany({
        where: { departmentId: id, organizationId },
        include: {
          council: {
            select: { id: true, name: true, acronym: true, legalBasis: true, isActive: true },
          },
        },
        orderBy: { council: { name: 'asc' } },
      })

      // Devolve o CONSELHO, não o vínculo: a tela lista conselhos, e o id da
      // tabela de ligação não serve para navegar até lugar nenhum.
      return links.map(link => link.council)
    })
  },

  /** GET /:id/covenants — convênios imputados ao setor. */
  async listCovenants(request: FastifyRequest, reply: FastifyReply) {
    return withDepartment(request, reply, (id, organizationId) =>
      prisma.covenant.findMany({
        where: { departmentId: id, organizationId },
        select: {
          id: true,
          number: true,
          processObject: true,
          transferValue: true,
          validityStartDate: true,
          validityEndDate: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    )
  },

  /** GET /:id/virtual-processes — processos virtuais do setor. */
  async listVirtualProcesses(request: FastifyRequest, reply: FastifyReply) {
    return withDepartment(request, reply, (id, organizationId) =>
      prisma.virtualProcess.findMany({
        where: { departmentId: id, organizationId },
        select: {
          id: true,
          processNumber: true,
          secretaria: true,
          companyName: true,
          startDate: true,
          endDate: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    )
  },

  /**
   * GET /:id/dossier — PDF com o retrato dos vínculos do setor.
   *
   * As seções vêm em `?sections=members,cnpj,...`. Omitir o parâmetro traz
   * todas: quem chama sem escolher quer o dossiê completo, não um PDF vazio.
   */
  async dossier(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const userId = (request.user as { id: string }).id
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
      const { sections } = dossierQuerySchema.parse(request.query)

      const { bytes, publicId, departmentCode } = await departmentDossierService.generate(
        id,
        sections ?? [...DOSSIER_SECTIONS],
        { organizationId, userId }
      )

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="dossie-${departmentCode}-${publicId}.pdf"`)
        .send(Buffer.from(bytes))
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      if (err instanceof DepartmentDossierError) {
        return reply
          .code(err.code === 'NOT_FOUND' ? 404 : 400)
          .send({ error: err.code, message: err.message })
      }
      request.log.error(err, 'Falha ao gerar dossiê do setor')
      return reply.code(500).send({ error: 'Dossier Failed', message: 'Não foi possível gerar o dossiê.' })
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const body = createSchema.parse(request.body)

      if (body.code === 'CENTRAL') {
        return reply.code(422).send({ error: 'Unprocessable', message: 'O código "CENTRAL" é reservado pelo sistema para numeração de atos normativos. Escolha outro código.' })
      }

      const existing = await prisma.department.findFirst({
        where: { organizationId, code: body.code },
      })
      if (existing) {
        return reply.code(409).send({ error: 'Conflict', message: `Já existe um departamento com o código "${body.code}" nesta organização.` })
      }

      const department = await prisma.department.create({
        data: {
          organizationId,
          name:        body.name,
          code:        body.code,
          description: body.description ?? null,
          cnpj:        body.cnpj ?? null,
          chiefName:   body.chiefName ?? null,
          isActive:    true,
        },
        include: { ...deptSelect, manager: { select: { id: true, firstName: true, lastName: true } } },
      })

      return reply.code(201).send(department)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (err as Error).message })
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
      const body = updateSchema.parse(request.body)

      const existing = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      if (body.code && body.code !== existing.code) {
        if (body.code === 'CENTRAL') {
          return reply.code(422).send({ error: 'Unprocessable', message: 'O código "CENTRAL" é reservado pelo sistema para numeração de atos normativos.' })
        }
        const conflict = await prisma.department.findFirst({ where: { organizationId, code: body.code } })
        if (conflict) {
          return reply.code(409).send({ error: 'Conflict', message: `Já existe um departamento com o código "${body.code}".` })
        }
      }

      // Validar managerId: se fornecido, o usuário deve pertencer à org
      if (body.managerId) {
        const managerUser = await prisma.user.findFirst({
          where: { id: body.managerId, organizationId },
        })
        if (!managerUser) {
          return reply.code(400).send({ error: 'Bad Request', message: 'Usuário não encontrado nesta organização.' })
        }
      }

      const updated = await prisma.department.update({
        where: { id },
        data: {
          ...(body.name        !== undefined ? { name:        body.name }        : {}),
          ...(body.code        !== undefined ? { code:        body.code }        : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive    !== undefined ? { isActive:    body.isActive }    : {}),
          ...(body.managerId   !== undefined ? { managerId:   body.managerId }   : {}),
          ...(body.cnpj        !== undefined ? { cnpj:        body.cnpj }        : {}),
          ...(body.chiefName   !== undefined ? { chiefName:   body.chiefName }   : {}),
        },
        include: { ...deptSelect, manager: { select: { id: true, firstName: true, lastName: true } } },
      })

      return reply.send(updated)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

      const existing = await prisma.department.findFirst({
        where: { id, organizationId },
        include: { _count: { select: { members: true } } },
      })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })

      if (existing._count.members > 0) {
        return reply.code(409).send({
          error:   'Conflict',
          message: `Este departamento possui ${existing._count.members} usuário(s) vinculado(s). Desvincule-os antes de excluir.`,
        })
      }

      const protocolCount = await prisma.officialDocument.count({
        where: { organizationId, sector: existing.code },
      })
      if (protocolCount > 0) {
        return reply.code(409).send({
          error:   'Conflict',
          message: `Este departamento possui ${protocolCount} protocolo(s) emitido(s) com este código de setor. Não é possível excluí-lo.`,
        })
      }

      await prisma.department.delete({ where: { id } })
      return reply.send({ message: 'Departamento excluído com sucesso.' })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Delete Failed', message: (err as Error).message })
    }
  },

  // ─── Member endpoints ────────────────────────────────────────────────────────

  async listMembers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      const members = await prisma.user.findMany({
        where:   { departments: { some: { id } }, organizationId },
        select:  { id: true, firstName: true, lastName: true, email: true, avatar: true, username: true },
        orderBy: { firstName: 'asc' },
      })

      return reply.send(members)
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Members Failed', message: (err as Error).message })
    }
  },

  async addMembers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
      const { userIds } = addMembersSchema.parse(request.body)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      const validUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, organizationId },
        select: { id: true },
      })
      await prisma.department.update({
        where: { id },
        data:  { members: { connect: validUsers.map(u => ({ id: u.id })) } },
      })

      return reply.send({ updated: validUsers.length })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Add Members Failed', message: (err as Error).message })
    }
  },

  async removeMember(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = orgId(request)
      const { id, userId } = z.object({ id: z.string().min(1), userId: z.string().min(1) }).parse(request.params)

      const dept = await prisma.department.findFirst({ where: { id, organizationId } })
      if (!dept) return reply.code(404).send({ error: 'Not Found' })

      await prisma.department.update({
        where: { id },
        data:  { members: { disconnect: { id: userId } } },
      })

      if (dept.managerId === userId) {
        await prisma.department.update({ where: { id }, data: { managerId: null } })
      }

      return reply.send({ message: 'Membro removido do departamento.' })
    } catch (err: unknown) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Member Failed', message: (err as Error).message })
    }
  },
}
