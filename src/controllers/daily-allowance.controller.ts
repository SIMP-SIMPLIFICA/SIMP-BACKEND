import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  type AccountForInput,
  type CreateDailyAllowanceInput,
  DailyAllowanceError,
  type ReportDailyAllowanceFilter,
  type RequestScope,
  type UpdateDailyAllowanceInput,
  dailyAllowanceService,
} from '@/services/daily-allowance.service.js'
import { dailyAllowanceReportService } from '@/services/daily-allowance-report.service.js'

/**
 * Diárias de servidor (Épico 3, Task 3.1).
 *
 * As mensagens de erro vão em pt-BR porque chegam ao servidor da prefeitura;
 * os códigos de erro seguem em inglês, por serem contrato de máquina.
 */

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * CPF opcional, mas se vier tem que ser um CPF de verdade — 11 dígitos, com
 * ou sem máscara. Recusar aqui, e não silenciar no serviço, é o que impede um
 * número mal digitado de virar um Anexo I com o campo 8 em branco sem que
 * ninguém percebesse a tempo.
 */
const beneficiaryCpfField = z
  .string()
  .trim()
  .optional()
  .transform(v => (v ? v.replace(/\D/g, '') : undefined))
  .refine(v => v === undefined || v.length === 11, 'Informe um CPF completo, com 11 dígitos.')

const createSchema = z.object({
  // Recusado no SERVIDOR, não apenas na tela: despesa sem setor identificado
  // não tem ordenador responsável.
  departmentId: z.string().min(1, 'Selecione o departamento.'),
  qddItemId: z.string().uuid().optional(),
  beneficiaryName: z.string().trim().min(1, 'Informe o nome do beneficiário.').max(200),
  destination: z.string().min(1, 'Informe o destino.').max(255),
  purpose: z.string().min(1, 'Informe o motivo do deslocamento.'),
  departureDate: z.coerce.date(),
  returnDate: z.coerce.date(),
  // Positivo: diária com valor zero ou negativo não existe e mascararia erro de
  // digitação num documento de prestação de contas.
  dailyRate: z.coerce.number().positive('O valor da diária deve ser maior que zero.'),
  dayCount: z.coerce.number().positive('A quantidade de diárias deve ser maior que zero.'),

  // Anexo I (Épico 4) — dados de registro do beneficiário, capturados na
  // criação. Todos opcionais: o rascunho pode nascer incompleto e ser
  // corrigido antes da emissão.
  beneficiaryCpf: beneficiaryCpfField,
  beneficiaryRegistrationNumber: z.string().trim().max(30).optional(),
  beneficiaryRg: z.string().trim().max(40).optional(),
  // Órgão emissor do RG — campo da cartilha oficial de prestação de contas
  // (Épico 8), capturado já na criação, junto do resto da identificação.
  beneficiaryRgIssuer: z.string().trim().max(60).optional(),
  beneficiaryJobTitle: z.string().trim().max(150).optional(),
  beneficiaryLotacao: z.string().trim().max(150).optional(),
  beneficiaryBankName: z.string().trim().max(80).optional(),
  beneficiaryBankAgency: z.string().trim().max(20).optional(),
  beneficiaryBankAccount: z.string().trim().max(30).optional(),

  departureTime: z.string().trim().max(30).optional(),
  arrivalTime: z.string().trim().max(30).optional(),
  transportMeans: z.enum(['RODOVIARIO', 'AEREO', 'VEICULO_OFICIAL', 'OUTRO']).optional(),
  fundingSource: z.enum(['PROPRIO', 'CONVENIO']).optional(),
  // Justificativa legal do TCE para diária em fim de semana/feriado (Épico 8,
  // FR-022) — opcional no rascunho; a EXIGÊNCIA é aplicada no servidor, em
  // `issue()`, quando o período de fato tocar um desses dias.
  weekendHolidayJustification: z.string().trim().min(10, 'Descreva a justificativa em pelo menos 10 caracteres.').max(1000).optional(),
})

const updateSchema = createSchema.partial()

/**
 * Filtros compartilhados pela listagem e pelos relatórios.
 *
 * Um schema só para os três: se o PDF aceitasse um filtro que a tela não aceita,
 * o relatório mostraria um recorte que o usuário não consegue conferir em tela.
 */
const filterSchema = z.object({
  beneficiaryName: z.string().min(1).optional(),
  // Busca única (Épico 8, FR-006): nome, CPF ou "Número da Diária" num só
  // campo — os filtros estruturados abaixo continuam existindo à parte, para
  // quem prefere refinar por situação/departamento/período.
  search: z.string().trim().min(1).max(100).optional(),
  // Aceita com ou sem máscara e normaliza para dígitos: a tela envia
  // "123.456.789-00", o banco guarda "12345678900".
  cpf: z
    .string()
    .optional()
    .transform(v => (v ? v.replace(/\D/g, '') : undefined))
    .refine(v => v === undefined || v.length === 11, 'Informe um CPF completo, com 11 dígitos.'),
  destination: z.string().min(1).optional(),
  status: z.enum(['PENDING', 'ISSUED', 'ACCOUNTED']).optional(),
  departmentId: z.string().min(1).optional(),
  issued: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

const listSchema = filterSchema.extend({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

/** Uma nota fiscal ou documento comprobatório (Épico 8, FR-003). */
const receiptSchema = z.object({
  receiptNumber: z.string().trim().min(1, 'Informe o número da nota fiscal.').max(50),
  payeeName: z.string().trim().min(1, 'Informe o favorecido.').max(200),
  issuedAt: z.coerce.date(),
  // Positivo: nota fiscal de valor zero ou negativo não existe e mascararia
  // erro de digitação num documento que soma para a prestação de contas.
  amount: z.coerce.number().positive('O valor da nota fiscal deve ser maior que zero.'),
})

const accountForSchema = z.object({
  accountabilityDate: z.coerce.date(),
  activityReport: z
    .string()
    .trim()
    .min(10, 'Descreva a atividade desempenhada em pelo menos 10 caracteres.')
    .max(5000),
  // Campos da cartilha oficial anexada pelo cliente (Épico 8, FR-003), todos
  // opcionais: nem toda viagem tem bilhete, evento com endereço próprio ou
  // contato registrado.
  ticketNumber: z.string().trim().max(60).optional(),
  eventAddress: z.string().trim().max(500).optional(),
  contactsInfo: z.string().trim().max(500).optional(),
  receipts: z.array(receiptSchema).max(50).optional(),
})

const paramsSchema = z.object({ id: z.string().uuid('Identificador inválido.') })

// ─── Escopo ───────────────────────────────────────────────────────────────────

/**
 * Extrai organização e usuário do token.
 *
 * Nunca do corpo da requisição: aceitar `organizationId` do cliente permitiria
 * criar diárias no nome de outra prefeitura.
 */
function getScope(request: FastifyRequest): RequestScope {
  const user = request.user as { id?: string; organizationId?: string | null }

  if (!user?.organizationId || !user.id) {
    throw new DailyAllowanceError(
      'NO_ORGANIZATION',
      'Usuário sem organização não pode gerenciar diárias.'
    )
  }
  return { organizationId: user.organizationId, userId: user.id }
}

const STATUS_BY_CODE: Record<DailyAllowanceError['code'], number> = {
  NOT_FOUND: 404,
  NO_ORGANIZATION: 403,
  ALREADY_ISSUED: 409,
  NOT_ISSUED: 409,
  ALREADY_ACCOUNTED: 409,
  INVALID_PERIOD: 400,
  INVALID_QDD_ITEM: 400,
  TOO_EARLY: 409,
  WEEKEND_JUSTIFICATION_REQUIRED: 409,
}

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
  }
  if (error instanceof DailyAllowanceError) {
    return reply.code(STATUS_BY_CODE[error.code]).send({
      error: error.code,
      message: error.message,
    })
  }

  request.log.error(error, 'Falha ao processar diária')
  return reply.code(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Não foi possível processar a diária.',
  })
}

/**
 * Extrai apenas os campos de filtro, descartando paginação.
 *
 * zod 3: um schema que contenha `z.coerce.*` é inferido com TODAS as chaves
 * opcionais (ver o comentário em `create`), então o tipo de saída já é
 * compatível com o filtro do relatório.
 */
function toReportFilter(parsed: z.infer<typeof filterSchema>): ReportDailyAllowanceFilter {
  return {
    beneficiaryName: parsed.beneficiaryName,
    search: parsed.search,
    cpf: parsed.cpf,
    destination: parsed.destination,
    status: parsed.status,
    departmentId: parsed.departmentId,
    issued: parsed.issued,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const dailyAllowanceController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      // zod 3: um schema que contenha z.coerce.* é inferido com TODAS as chaves
      // opcionais — o tipo de ENTRADA do coerce aceita undefined e contamina a
      // inferência de saída. O parse já garantiu a presença em tempo de execução;
      // o cast apenas devolve ao TypeScript o que o zod assegura.
      const input = createSchema.parse(request.body) as CreateDailyAllowanceInput
      const record = await dailyAllowanceService.create(input, scope)
      return reply.code(201).send(record)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter: z.infer<typeof listSchema> = listSchema.parse(request.query)

      const result = await dailyAllowanceService.list(
        { ...toReportFilter(filter), page: filter.page ?? 1, limit: filter.limit ?? 20 },
        scope
      )
      return reply.send(result)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async getById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await dailyAllowanceService.getById(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body) as UpdateDailyAllowanceInput
      return reply.send(await dailyAllowanceService.update(id, input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      await dailyAllowanceService.remove(id, scope)
      return reply.code(204).send()
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** POST /:id/issue — gera o PDF oficial e congela o registro. */
  async issue(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(await dailyAllowanceService.issue(id, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /:id/pdf — baixa o documento já emitido. */
  async downloadPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const { bytes, publicId } = await dailyAllowanceService.getPdf(id, scope)

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="diaria-${publicId}.pdf"`)
        .send(bytes)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** POST /:id/account-for — registra a prestação de contas e emite o Anexo II. */
  async accountFor(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      // Mesmo cast de `create`: o `z.coerce.date` torna todas as chaves
      // opcionais na inferência, embora o parse já as garanta em execução.
      const input = accountForSchema.parse(request.body) as AccountForInput

      return reply.send(await dailyAllowanceService.accountFor(id, input, scope))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /:id/accountability/pdf — baixa o Anexo II já emitido. */
  async downloadAccountabilityPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const { id } = paramsSchema.parse(request.params)
      const { bytes, publicId } = await dailyAllowanceService.getAccountabilityPdf(id, scope)

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="prestacao-contas-${publicId}.pdf"`)
        .send(bytes)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /report/pdf — relatório tabular com os mesmos filtros da listagem. */
  async reportPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter = toReportFilter(filterSchema.parse(request.query))
      const { bytes, publicId } = await dailyAllowanceReportService.generatePdf(filter, scope)

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="relatorio-diarias-${publicId}.pdf"`)
        .send(Buffer.from(bytes))
    } catch (error) {
      return handleError(error, request, reply)
    }
  },

  /** GET /report/excel — ZIP com a planilha e o PDF-Manifesto que a atesta. */
  async reportExcel(request: FastifyRequest, reply: FastifyReply) {
    try {
      const scope = getScope(request)
      const filter = toReportFilter(filterSchema.parse(request.query))
      const { bytes, publicId } = await dailyAllowanceReportService.generateExcelPackage(
        filter,
        scope
      )

      // `attachment`, não `inline`: o navegador não sabe exibir um ZIP, e um
      // pacote aberto na aba perderia o manifesto que viaja junto da planilha.
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="relatorio-diarias-${publicId}.zip"`)
        .send(bytes)
    } catch (error) {
      return handleError(error, request, reply)
    }
  },
}
