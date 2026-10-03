import { FastifyReply, FastifyRequest } from 'fastify'
import { db } from '@/utils/database.js'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import { departmentExistsInOrganization } from '@/utils/department-scope.util.js'
import { z } from 'zod'
import { CovenantStatus, FinanceEntryType } from '@prisma/client'
import { BudgetError, budgetService } from '@/services/budget.service.js'

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const covenantCreateSchema = z.object({
  // Setor responsável pelo convênio (Épico 4). Opcional para não invalidar os
  // convênios já cadastrados sem setor; a tela é que exige na criação.
  departmentId:    z.string().min(1).nullable().optional(),
  number:          z.string().min(1),
  typeId:          z.string().uuid().optional(),
  proponentId:     z.string().uuid().optional(),
  convenenteId:    z.string().uuid().optional(),
  concedenteId:    z.string().uuid().optional(),
  processObject:   z.string().min(1),
  status:          z.nativeEnum(CovenantStatus).default('EM_ANALISE'),
  budgetaryAction:    z.string().optional(),
  /// Dotação orçamentária (Fase 3, 2026-09-24) — mesmo padrão de VirtualProcess.
  qddItemId:          z.string().optional(),
  executionStartDate: z.coerce.date().optional(),
  validityStartDate:  z.coerce.date().optional(),
  validityEndDate:    z.coerce.date().optional(),
  termDays:           z.coerce.number().int().positive().optional(),
  transferValue:      z.coerce.number().positive().optional(),
  counterpartValue:   z.coerce.number().nonnegative().optional(),
  bankName:    z.string().optional(),
  bankAgency:  z.string().optional(),
  bankAccount: z.string().optional(),
})

const covenantUpdateSchema = covenantCreateSchema.partial()

const entitySchema = z.object({
  name: z.string().min(1),
  cnpj: z.string().optional(),
})

const idParam = z.object({ id: z.string().uuid() })

type RequestUser = { user: { id: string; organizationId: string; isSuperAdmin: boolean } }

// ─── Covenant CRUD ────────────────────────────────────────────────────────────

export class CovenantController {
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const querySchema = z.object({
        page:   z.coerce.number().min(1).default(1),
        limit:  z.coerce.number().min(1).max(100).default(50),
        search: z.string().optional(),
        typeId: z.string().optional(),
        status: z.nativeEnum(CovenantStatus).optional(),
      })

      const query = querySchema.parse(request.query)
      const where: Record<string, unknown> = { ...orgFilter }

      if (query.search) {
        where.OR = [
          { number:        { contains: query.search, mode: 'insensitive' } },
          { processObject: { contains: query.search, mode: 'insensitive' } },
          { proponent:     { name: { contains: query.search, mode: 'insensitive' } } },
        ]
      }
      if (query.typeId) where.typeId = query.typeId
      if (query.status) where.status = query.status

      const total     = await prisma.covenant.count({ where })
      const covenants = await prisma.covenant.findMany({
        where,
        skip:    (query.page - 1) * query.limit,
        take:    query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          covenantType: { select: { id: true, name: true } },
          proponent:    { select: { id: true, name: true, cnpj: true } },
          convenente:   { select: { id: true, name: true, cnpj: true } },
          concedente:   { select: { id: true, name: true, cnpj: true } },
          _count: { select: { virtualProcesses: true, libraryDocuments: true } },
        },
      })

      return reply.send(db.paginate(covenants, query.page, query.limit, total))
    } catch (error: unknown) {
      logger.error(error, 'Failed to list covenants')
      return reply.code(500).send({ error: 'Fetch Failed', message: (error as Error).message })
    }
  }

  async getOne(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)

      const covenant = await prisma.covenant.findFirst({
        where: { id, organizationId },
        include: {
          covenantType: { select: { id: true, name: true } },
          proponent:    { select: { id: true, name: true, cnpj: true } },
          convenente:   { select: { id: true, name: true, cnpj: true } },
          concedente:   { select: { id: true, name: true, cnpj: true } },
          qddItem: {
            select: { id: true, ficha: true, fonte: true, naturezaDespesa: true, year: true, valorOrcado: true },
          },
          virtualProcesses: {
            select: {
              // secretaria compõe o cabeçalho dos blocos da aba Documentos
              // ("Processo nº X — Secretaria — Objeto").
              id: true, processNumber: true, status: true, subject: true, secretaria: true,
              documents: {
                select: {
                  id: true, tag: true, description: true,
                  fileName: true, fileUrl: true, fileSize: true, uploadedAt: true,
                  uploader: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
          libraryDocuments: {
            where: { deletedAt: null },
            select: {
              id: true, title: true, fileName: true, fileSize: true,
              mimeType: true, accessLevel: true, createdAt: true,
              uploader: { select: { id: true, firstName: true, lastName: true, avatar: true } },
              category: { select: { id: true, name: true } },
            },
          },
        },
      })

      if (!covenant) return reply.code(404).send({ error: 'Not Found', message: 'Convênio não encontrado' })
      return reply.send(covenant)
    } catch (error: unknown) {
      logger.error(error, 'Failed to get covenant')
      return reply.code(500).send({ error: 'Fetch Failed', message: (error as Error).message })
    }
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId } = (request as unknown as RequestUser).user
      const data = covenantCreateSchema.parse(request.body)

      if (data.departmentId && !(await departmentExistsInOrganization(data.departmentId, organizationId))) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'O departamento informado não existe nesta organização.',
        })
      }

      // Dotação do QDD que lastreia o convênio (Fase 3, 2026-09-24) — mesmo
      // padrão de VirtualProcess: valida o vínculo E tira uma cópia TEXTUAL da
      // ficha, para o convênio não mudar de dotação retroativamente só porque
      // o cadastro do QDD mudou depois.
      let qddSnapshot: {
        qddFichaSnapshot: string
        qddFonteSnapshot: string
        qddNaturezaSnapshot: string
      } | null = null

      if (data.qddItemId) {
        await budgetService.assertQddItemBelongsToOrganization(data.qddItemId, organizationId)
        const qddItem = await prisma.qddItem.findUniqueOrThrow({ where: { id: data.qddItemId } })
        qddSnapshot = {
          qddFichaSnapshot: qddItem.ficha,
          qddFonteSnapshot: qddItem.fonte,
          qddNaturezaSnapshot: qddItem.naturezaDespesa,
        }
      }

      // Automação de Conta Bancária (Fase 3, CRÍTICO): "preencher a seção
      // Dados Bancários" = informar QUALQUER um dos três campos. BankAccount
      // exige departmentId (FR-015, não-nulo no schema) — sem setor, não há
      // pra qual departamento criar a conta, então é erro de validação, não
      // uma falha silenciosa que criasse o convênio sem a conta prometida.
      const hasBankInfo = Boolean(data.bankName || data.bankAgency || data.bankAccount)
      if (hasBankInfo && !data.departmentId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Informe a Secretaria/Departamento para gerar a conta bancária automaticamente com os Dados Bancários preenchidos.',
        })
      }

      const covenant = await prisma.$transaction(async tx => {
        const created = await tx.covenant.create({
          data: {
            // Forma de RELAÇÃO, não escalar: este `create` já usa `connect` para a
            // organização, e o Prisma não aceita os dois estilos no mesmo objeto.
            ...(data.departmentId && { department: { connect: { id: data.departmentId } } }),
            number:        data.number,
            processObject: data.processObject,
            status:        data.status,
            organization:  { connect: { id: organizationId } },
            ...(data.typeId       && { covenantType: { connect: { id: data.typeId } } }),
            ...(data.proponentId  && { proponent:    { connect: { id: data.proponentId } } }),
            ...(data.convenenteId && { convenente:   { connect: { id: data.convenenteId } } }),
            ...(data.concedenteId && { concedente:   { connect: { id: data.concedenteId } } }),
            budgetaryAction:    data.budgetaryAction,
            ...(data.qddItemId && { qddItem: { connect: { id: data.qddItemId } } }),
            ...qddSnapshot,
            executionStartDate: data.executionStartDate,
            validityStartDate:  data.validityStartDate,
            validityEndDate:    data.validityEndDate,
            termDays:           data.termDays,
            transferValue:      data.transferValue,
            counterpartValue:   data.counterpartValue,
            bankName:    data.bankName,
            bankAgency:  data.bankAgency,
            bankAccount: data.bankAccount,
          },
        })

        // ── Automação de Conta Bancária + Lançamento inicial ──────────────────
        //
        // De/Para (Fase 3): departmentId do convênio → Conta; banco/agência/
        // conta → campos respectivos; Número do Convênio → Nome da Conta.
        //
        // REGRA DO SALDO (FR-016, Épico 8): a conta SEMPRE nasce com saldo 0 —
        // essa regra é travada no schema/no controller de contas e não é
        // reaberta aqui. O "saldo inicial" pedido entra como um FinanceEntry
        // de RECEITA, não como `initialBalanceCents` — mesmo extrato final,
        // sem violar a garantia de que nenhum saldo inicial vem da API
        // (reservado à futura integração bancária real).
        if (hasBankInfo && data.departmentId) {
          const bankAccount = await tx.bankAccount.create({
            data: {
              organizationId,
              departmentId: data.departmentId,
              name: data.number,
              agency: data.bankAgency,
              accountNumber: data.bankAccount,
            },
          })

          if (data.transferValue && data.transferValue > 0) {
            await tx.financeEntry.create({
              data: {
                organizationId,
                accountId: bankAccount.id,
                type: FinanceEntryType.INCOME,
                amountCents: Math.round(data.transferValue * 100),
                occurredAt: data.executionStartDate ?? new Date(),
                description: `Recebimento inicial do Convênio nº ${data.number}`,
                createdById: userId,
              },
            })
          }
        }

        return created
      })

      return reply.code(201).send(covenant)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      }
      // Dotação do QDD inexistente ou de outra organização (Épico 8) — erro de
      // domínio, não falha interna.
      if (error instanceof BudgetError) {
        return reply.code(400).send({ error: error.code, message: error.message })
      }
      logger.error(error, 'Failed to create covenant')
      return reply.code(500).send({ error: 'Create Failed', message: (error as Error).message })
    }
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)
      const data = covenantUpdateSchema.parse(request.body)

      const existing = await prisma.covenant.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Convênio não encontrado' })

      if (data.departmentId && !(await departmentExistsInOrganization(data.departmentId, organizationId))) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'O departamento informado não existe nesta organização.',
        })
      }

      // Troca de dotação recalcula o snapshot; desvincular (`qddItemId: null`
      // explícito) limpa o snapshot junto — mesmo padrão de
      // VirtualProcess.updateBudget (Épico 8, FR-011).
      const isChangingQddItem = data.qddItemId !== undefined
      let qddSnapshot: {
        qddFichaSnapshot: string | null
        qddFonteSnapshot: string | null
        qddNaturezaSnapshot: string | null
      } | null = null

      if (isChangingQddItem && data.qddItemId) {
        await budgetService.assertQddItemBelongsToOrganization(data.qddItemId, organizationId)
        const qddItem = await prisma.qddItem.findUniqueOrThrow({ where: { id: data.qddItemId } })
        qddSnapshot = {
          qddFichaSnapshot: qddItem.ficha,
          qddFonteSnapshot: qddItem.fonte,
          qddNaturezaSnapshot: qddItem.naturezaDespesa,
        }
      } else if (isChangingQddItem) {
        qddSnapshot = { qddFichaSnapshot: null, qddFonteSnapshot: null, qddNaturezaSnapshot: null }
      }

      const updated = await prisma.covenant.update({
        where: { id },
        data: {
          // `null` explícito desvincula o setor; `undefined` não mexe no campo.
          ...(data.departmentId !== undefined && {
            department: data.departmentId
              ? { connect: { id: data.departmentId } }
              : { disconnect: true },
          }),
          ...(data.number        !== undefined && { number: data.number }),
          ...(data.processObject !== undefined && { processObject: data.processObject }),
          ...(data.status        !== undefined && { status: data.status }),
          ...(data.typeId        !== undefined && {
            covenantType: data.typeId ? { connect: { id: data.typeId } } : { disconnect: true },
          }),
          ...(data.proponentId !== undefined && {
            proponent: data.proponentId ? { connect: { id: data.proponentId } } : { disconnect: true },
          }),
          ...(data.convenenteId !== undefined && {
            convenente: data.convenenteId ? { connect: { id: data.convenenteId } } : { disconnect: true },
          }),
          ...(data.concedenteId !== undefined && {
            concedente: data.concedenteId ? { connect: { id: data.concedenteId } } : { disconnect: true },
          }),
          budgetaryAction:    data.budgetaryAction,
          ...(isChangingQddItem && {
            qddItem: data.qddItemId ? { connect: { id: data.qddItemId } } : { disconnect: true },
            ...qddSnapshot,
          }),
          executionStartDate: data.executionStartDate,
          validityStartDate:  data.validityStartDate,
          validityEndDate:    data.validityEndDate,
          termDays:           data.termDays,
          transferValue:      data.transferValue,
          counterpartValue:   data.counterpartValue,
          bankName:    data.bankName,
          bankAgency:  data.bankAgency,
          bankAccount: data.bankAccount,
        },
      })

      return reply.send(updated)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      }
      if (error instanceof BudgetError) {
        return reply.code(400).send({ error: error.code, message: error.message })
      }
      logger.error(error, 'Failed to update covenant')
      return reply.code(500).send({ error: 'Update Failed', message: (error as Error).message })
    }
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)

      const existing = await prisma.covenant.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Convênio não encontrado' })

      await prisma.covenant.delete({ where: { id } })
      return reply.code(204).send()
    } catch (error: unknown) {
      logger.error(error, 'Failed to delete covenant')
      return reply.code(500).send({ error: 'Delete Failed', message: (error as Error).message })
    }
  }
}

// ─── CovenantType sub-resource ────────────────────────────────────────────────

export const covenantTypeController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
    const orgFilter = isSuperAdmin ? {} : { organizationId }
    const types = await prisma.covenantType.findMany({ where: orgFilter, orderBy: { name: 'asc' } })
    return reply.send(types)
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
      const type = await prisma.covenantType.create({ data: { organizationId, name } })

      // Sync: new covenant type → virtual process source (unidirectional)
      const existingSource = await prisma.virtualProcessSource.findFirst({
        where: { organizationId, name },
      })
      if (!existingSource) {
        await prisma.virtualProcessSource.create({ data: { organizationId, name } })
      }

      return reply.code(201).send(type)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (error as Error).message })
    }
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)
      const existing = await prisma.covenantType.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })
      await prisma.covenantType.delete({ where: { id } })
      return reply.code(204).send()
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Delete Failed', message: (error as Error).message })
    }
  },
}

// ─── Convenente sub-resource ──────────────────────────────────────────────────

export const convenenteController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
    const orgFilter = isSuperAdmin ? {} : { organizationId }
    const items = await prisma.convenente.findMany({ where: orgFilter, orderBy: { name: 'asc' } })
    return reply.send(items)
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const data = entitySchema.parse(request.body)
      const item = await prisma.convenente.create({ data: { organizationId, name: data.name, cnpj: data.cnpj } })
      return reply.code(201).send(item)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (error as Error).message })
    }
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)
      const existing = await prisma.convenente.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })
      await prisma.convenente.delete({ where: { id } })
      return reply.code(204).send()
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Delete Failed', message: (error as Error).message })
    }
  },
}

// ─── Concedente sub-resource ──────────────────────────────────────────────────

export const concedenteController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
    const orgFilter = isSuperAdmin ? {} : { organizationId }
    const items = await prisma.concedente.findMany({ where: orgFilter, orderBy: { name: 'asc' } })
    return reply.send(items)
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const data = entitySchema.parse(request.body)
      const item = await prisma.concedente.create({ data: { organizationId, name: data.name, cnpj: data.cnpj } })
      return reply.code(201).send(item)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: error.issues })
      return reply.code(500).send({ error: 'Create Failed', message: (error as Error).message })
    }
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)
      const existing = await prisma.concedente.findFirst({ where: { id, organizationId } })
      if (!existing) return reply.code(404).send({ error: 'Not Found' })
      await prisma.concedente.delete({ where: { id } })
      return reply.code(204).send()
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Delete Failed', message: (error as Error).message })
    }
  },
}

export const covenantController = new CovenantController()

// ─── Process link/unlink ──────────────────────────────────────────────────────

export const covenantProcessController = {
  async link(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id } = idParam.parse(request.params)
      const { processId } = z.object({ processId: z.string() }).parse(request.body)

      const covenant = await prisma.covenant.findFirst({ where: { id, organizationId } })
      if (!covenant) return reply.code(404).send({ error: 'Not Found', message: 'Convênio não encontrado' })

      await prisma.covenant.update({
        where: { id },
        data: { virtualProcesses: { connect: { id: processId } } },
      })
      return reply.send({ message: 'Processo vinculado com sucesso.' })
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Link Failed', message: (error as Error).message })
    }
  },

  async unlink(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { id, processId } = z.object({ id: z.string(), processId: z.string() }).parse(request.params)

      const covenant = await prisma.covenant.findFirst({ where: { id, organizationId } })
      if (!covenant) return reply.code(404).send({ error: 'Not Found', message: 'Convênio não encontrado' })

      await prisma.covenant.update({
        where: { id },
        data: { virtualProcesses: { disconnect: { id: processId } } },
      })
      return reply.code(204).send()
    } catch (error: unknown) {
      return reply.code(500).send({ error: 'Unlink Failed', message: (error as Error).message })
    }
  },
}
