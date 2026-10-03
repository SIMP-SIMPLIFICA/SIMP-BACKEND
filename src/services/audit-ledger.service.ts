import { prisma } from '@/lib/prisma.js'
import { config } from '@/config/config.js'
import { Sentry } from '@/config/sentry.js'
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
 *
 * `tx`, quando presente, é o cliente da transação Prisma do chamador: o
 * registro passa a fazer parte da mesma unidade atômica da operação auditada.
 */
interface LedgerAdapter {
  readonly name: 'local' | 'qldb'
  record(data: AuditRecord, tx?: Prisma.TransactionClient): Promise<void>
  query(filter: AuditQueryFilter): Promise<{ records: unknown[]; total: number }>
}

// ─── Adaptador local (PostgreSQL) ─────────────────────────────────────────────

const localAdapter: LedgerAdapter = {
  name: 'local',

  async record(data, tx) {
    await (tx ?? prisma).auditLog.create({
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

  async record(data, tx) {
    // O QLDB é outro sistema: não participa de uma transação do PostgreSQL.
    // Aceitar o `tx` daria uma atomicidade falsa — a operação no Postgres
    // poderia ser desfeita depois de o QLDB já ter registrado a ação. Quando
    // este adaptador for implementado, a auditoria transacional (Frotas)
    // precisará de outra estratégia (ex.: outbox no Postgres).
    if (tx) {
      throw new Error(
        `O adaptador QLDB não aceita registro dentro de uma transação do PostgreSQL. ` +
        `Ação "${data.action}" NÃO foi registrada. Use LEDGER_DRIVER=local para auditoria transacional.`
      )
    }

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

/**
 * Decisão D8: com o kill switch desligado, uma operação que pediu auditoria
 * transacional (Frotas) é confirmada SEM trilha. O kill switch prevalece, mas
 * isso não pode passar despercebido — um operador que desligou a flag para
 * outro fim estaria suspendendo a prova de auditoria do Frotas sem saber.
 *
 * Só ação e recurso saem daqui: nenhum `details`, `userId`, `ip`,
 * `resourceId` ou `organizationId` vai para log ou Sentry (LGPD). O
 * fingerprint agrupa os eventos por ação e recurso no Sentry, para que um
 * ambiente com a flag desligada gere uma issue por tipo de ação, não uma
 * por requisição.
 */
function warnTransactionalAuditSkipped(data: AuditRecord) {
  const context = { action: data.action, resource: data.resource }

  logger.warn(context, 'Auditoria transacional NÃO registrada: ENABLE_AUDIT_LOGS está desligado')

  Sentry.captureMessage('Auditoria transacional não registrada: kill switch ENABLE_AUDIT_LOGS desligado', {
    level: 'warning',
    tags: context,
    fingerprint: ['audit-kill-switch-transactional', data.action, data.resource],
  })
}

export const auditLedgerService = {
  /** Driver em uso — exposto para diagnóstico e para os testes. */
  get driver() {
    return activeAdapter.name
  },

  /**
   * Registra uma ação na trilha de auditoria.
   *
   * SEM `tx` (módulos existentes): nunca lança para o chamador — auditoria é
   * efeito colateral e uma falha ao registrar não pode derrubar a operação de
   * negócio que o usuário pediu. A falha é logada em nível de erro para ser
   * capturada pela observabilidade.
   *
   * COM `tx` (Frotas, decisão D3): o registro é gravado pelo cliente da
   * transação do chamador e a falha É PROPAGADA, para que o `$transaction`
   * desfaça a operação inteira. Ali a trilha é prova (o controle interno
   * precisa provar quem fez o quê), então ação sem trilha não pode acontecer.
   * Chame depois da escrita auditada, dentro do mesmo `$transaction`.
   *
   * `ENABLE_AUDIT_LOGS=false` desliga a trilha por inteiro — kill switch de
   * operação, único e válido para QUALQUER chamador desta interface, com ou
   * sem `tx` (decisão D8: prevalece sobre a garantia transacional da D3).
   * Antes ele só valia para os escritores legados (`db.createAuditLog`);
   * migrá-los para cá sem trazer o flag junto teria religado a trilha por
   * engano em qualquer ambiente que a tivesse desativado de propósito.
   * Com `tx`, a operação segue sem trilha, mas nunca em silêncio: ver
   * `warnTransactionalAuditSkipped`.
   */
  async record(data: AuditRecord, tx?: Prisma.TransactionClient): Promise<void> {
    if (!config.features.auditLogs) {
      if (tx) warnTransactionalAuditSkipped(data)
      return
    }

    if (tx) {
      try {
        await activeAdapter.record(data, tx)
      } catch (error) {
        logger.error(
          { error, action: data.action, resource: data.resource, driver: activeAdapter.name },
          'Falha ao registrar auditoria transacional — a operação será desfeita'
        )
        throw error
      }
      return
    }

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
