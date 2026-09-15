import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  type CreateQddItemInput,
  QddItemError,
  type RequestScope,
  type UpdateQddItemInput,
  qddItemService,
} from '@/services/qdd-item.service.js'

/**
 * QDD — Quadro de Detalhamento da Despesa (Épico 4, Fase 2).
 *
 * Códigos de erro em inglês (contrato de máquina), mensagens em pt-BR.
 */

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Exercício plausível.
 *
 * O limite superior não é zelo excessivo: a tabela é editável em linha, e um
 * "20266" digitado por engano criaria uma dotação invisível para sempre, já que
 * nenhuma tela filtra aquele exercício.
 */
const yearField = z.coerce
  .number()
  .int()
  .min(2000, 'Exercício inválido.')
  .max(2100, 'Exercício inválido.')

const createSchema = z.object({
  departmentId: z.string().min(1, 'Selecione o departamento.'),
  year: yearField,
  ficha: z.string().trim().min(1, 'Informe a ficha.').max(20),
  fonte: z.string().trim().min(1, 'Informe a fonte de recurso.').max(50),
  projetoAtividade: z.string().trim().min(1, 'Informe o projeto/atividade.').max(255),
  naturezaDespesa: z.string().trim().min(1, 'Informe a natureza da despesa.').max(50),
  // Positivo: dotação zerada ou negativa não existe, e mascararia erro de
  // digitação num valor que baliza alerta de estouro.
  valorOrcado: z.coerce.number().positive('O valor orçado deve ser maior que zero.'),
})

/** O departamento não muda no update: mover a ficha de setor reescreveria o
 *  lastro de despesas já imputadas. Para trocar, exclua e recadastre. */
const updateSchema = createSchema.omit({ departmentId: true }).partial().extend({
  // Obrigatório apenas quando `valorOrcado` muda de fato — o serviço decide
  // isso comparando com o valor atual; o schema só garante o formato do texto
  // quando o campo vier preenchido (Épico 8, FR-013).
  reason: z.string().trim().min(3, 'Descreva o motivo em pelo menos 3 caracteres.').max(500).optional(),
})

const listSchema = z.object({
  departmentId: z.string().min(1).optional(),
  year: yearField.optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

// ─── Escopo ───────────────────────────────────────────────────────────────────

function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new QddItemError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar dotações.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<QddItemError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  DUPLICATE_FICHA: 409,
  IN_USE: 409,
  INVALID_DEPARTMENT: 400,
  REASON_REQUIRED: 400,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof QddItemError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar dotação do QDD')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a dotação.',
  })
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const qddItemController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter = listSchema.parse(request.query)
      return reply.send(await qddItemService.list(filter, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async getById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await qddItemService.getById(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      // zod 3: um schema com `z.coerce.*` é inferido com TODAS as chaves
      // opcionais; o parse já garantiu a presença em tempo de execução.
      const input = createSchema.parse(request.body) as CreateQddItemInput
      return reply.code(201).send(await qddItemService.create(input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body) as UpdateQddItemInput
      return reply.send(await qddItemService.update(id, input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await qddItemService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /:id/history — histórico de suplementação/redução do valor orçado. */
  async getHistory(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await qddItemService.getHistory(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
