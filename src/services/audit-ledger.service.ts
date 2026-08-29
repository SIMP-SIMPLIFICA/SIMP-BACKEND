import { prisma } from '@/lib/prisma.js'
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import type { Prisma } from '@prisma/client'

/**
 * Serviço de Auditoria — registro imutável de ações (Épico 2, Task 2.1).
 *
 * Padrão Adapter: a aplicação registra e consulta sempre por esta interface,
 * sem saber onde o dado é persistido. Hoje o destino é o PostgreSQL local
 * (`LEDGER_DRIVER=local`); em produção na AWS, passa a ser o Amazon QLDB
 * (`LEDGER_DRIVER=qldb`) sem que nenhum chamador precise mudar.
 *
 * IMUTABILIDADE — a garantia acontece em duas camadas:
 *   1. Nesta interface não existe método de alteração ou remoção. Não há como
 *      um controller apagar histórico sem antes editar este arquivo.
 *   2. No banco, UPDATE e DELETE são bloqueados por trigger na tabela de
 *      auditoria (ver prisma/sql/002-immutable-audit.sql). Sem essa segunda
 *      camada, "imutável" seria apenas uma convenção de código: qualquer acesso
 *      direto ao Postgres reescreveria o histórico.
 *
 * NOTA DE ARQUITETURA: persiste na tabela `audit_logs`, que já existe e já é
 * alimentada por 44 pontos do sistema (suspensão de organização, alteração de
 * vigência, upload de atas, etc.). Criar uma tabela paralela racharia a trilha
 * em duas e o Painel do Super Admin mostraria um histórico incompleto — o
 * oposto do objetivo de compliance.
 *
 * NOME DO ARQUIVO: `audit-ledger` e não `audit` porque já existe um
 * `audit.service.ts` legado (hoje sem nenhum chamador) que escreve na mesma
 * tabela. Usar o mesmo nome sobrescreveria aquele arquivo.
 */

// ─── Contratos ────────────────────────────────────────────────────────────────

/** Dados de uma ação a ser registrada na trilha de auditoria. */
export interface AuditRecord {
  /** Autor da ação. Nulo para ações do próprio sistema (jobs, seeds). */
  userId?: string | null
  /** Verbo da ação, em caixa alta: 'ORGANIZATION_SUSPENDED', 'MINUTES_ATTACHED'. */
  action: string
  /** Endereço IP de origem. 'SYSTEM' quando não há requisição HTTP. */
  ip?: string
  /** Recurso afetado: 'ORGANIZATION', 'VIRTUAL_PROCESS'… */
  resource: string
  /** Identificador do recurso afetado. */
  resourceId?: string | null
  /** Organização dona do registro — preserva o isolamento multi-tenant. */
  organizationId?: string | null
  /** Navegador/cliente de origem. */
  userAgent?: string | null
  /** Contexto livre da ação (valores antigos/novos, motivo, etc.). */
  details?: Prisma.InputJsonValue
  /** A ação foi concluída com sucesso? Falhas também são auditáveis. */
  success?: boolean
  /** Mensagem de erro, quando a ação falhou. */
  errorMessage?: string | null
}

export interface AuditQueryFilter {
  page: number
  limit: number
  userId?: string
  organizationId?: string
  action?: string
  resource?: string
  startDate?: Date
  endDate?: Date
}

/**
 * Contrato do ledger. Note que existem apenas escrita e leitura:
 * a ausência de `update`/`delete` é intencional e é a primeira
 * camada da garantia de imutabilidade.
 */
interface LedgerAdapter {
  readonly name: 'local' | 'qldb'
  record(data: AuditRecord): Promise<void>
  query(filter: AuditQueryFilter): Promise<{ records: unknown[]; total: number }>
}

// ─── Adaptador local (PostgreSQL) ─────────────────────────────────────────────

const localAdapter: LedgerAdapter = {
  name: 'local',

  async record(data) {
    await prisma.auditLog.create({
      data: {
        userId: data.userId ?? null,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ip ?? 'SYSTEM',
        userAgent: data.userAgent ?? null,
        organizationId: data.organizationId ?? null,
        metadata: data.details,
        success: data.success ?? true,
        errorMessage: data.errorMessage ?? null,
      },
    })
  },

  async query(filter) {
    const where: Prisma.AuditLogWhereInput = {}

    if (filter.userId) where.userId = filter.userId
    if (filter.organizationId) where.organizationId = filter.organizationId
    if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' }
    if (filter.resource) where.resource = filter.resource

    if (filter.startDate || filter.endDate) {
      where.createdAt = {}
      if (filter.startDate) where.createdAt.gte = filter.startDate
      if (filter.endDate) where.createdAt.lte = filter.endDate
    }

    const [records, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          organization: { select: { id: true, name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ])

    return { records, total }
  },
}

// ─── Adaptador QLDB (Amazon) ──────────────────────────────────────────────────

/**
 * Estrutura pronta para o Amazon QLDB, ainda não ativada.
 *
 * O SDK (`@aws-sdk/client-qldb-session` / `amazon-qldb-driver-nodejs`) NÃO é
 * dependência do projeto hoje, de propósito: instalá-lo agora traria um SDK de
 * nuvem para um sistema que roda offline, contrariando o Princípio I da
 * Constituição. A troca para produção envolve instalar o driver e preencher os
 * dois métodos abaixo — nenhum chamador muda.
 *
 * O adaptador falha de forma explícita ao ser selecionado sem implementação,
 * em vez de descartar registros em silêncio: perder trilha de auditoria sem
 * ninguém perceber é pior que uma falha visível.
 */
const qldbAdapter: LedgerAdapter = {
  name: 'qldb',

  async record(data) {
    throw new Error(
      `Adaptador QLDB ainda não implementado (ledger "${config.audit.qldb.ledgerName}"). ` +
      `Ação "${data.action}" NÃO foi registrada. Use LEDGER_DRIVER=local até a migração para a AWS.`
    )
  },

  async query() {
    throw new Error(
      'Consulta ao QLDB ainda não implementada. Use LEDGER_DRIVER=local até a migração para a AWS.'
    )
  },
}

// ─── Seleção do adaptador ─────────────────────────────────────────────────────

const adapters: Record<'local' | 'qldb', LedgerAdapter> = {
  local: localAdapter,
  qldb: qldbAdapter,
}

const activeAdapter = adapters[config.audit.driver]

export const auditLedgerService = {
  /** Driver em uso — exposto para diagnóstico e para os testes. */
  get driver() {
    return activeAdapter.name
  },

  /**
   * Registra uma ação na trilha de auditoria.
   *
   * Nunca lança para o chamador: auditoria é efeito colateral e uma falha ao
   * registrar não pode derrubar a operação de negócio que o usuário pediu. A
   * falha é logada em nível de erro para ser capturada pela observabilidade.
   */
  async record(data: AuditRecord): Promise<void> {
    try {
      await activeAdapter.record(data)
    } catch (error) {
      logger.error(
        { error, action: data.action, resource: data.resource, driver: activeAdapter.name },
        'Falha ao registrar auditoria'
      )
    }
  },

  /** Consulta paginada da trilha — usada pelo Painel do Super Admin. */
  async query(filter: AuditQueryFilter) {
    const { records, total } = await activeAdapter.query(filter)

    return {
      data: records,
      meta: {
        total,
        page: filter.page,
        limit: filter.limit,
        totalPages: Math.ceil(total / filter.limit),
      },
    }
  },
}
