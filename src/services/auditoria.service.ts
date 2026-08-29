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
 *   2. No banco, UPDATE e DELETE são revogados na tabela de auditoria
 *      (ver prisma/sql/002-auditoria-imutavel.sql). Sem essa segunda camada,
 *      "imutável" seria apenas uma convenção de código: qualquer acesso direto
 *      ao Postgres reescreveria o histórico.
 *
 * NOTA DE ARQUITETURA: persiste na tabela `audit_logs`, que já existe e já é
 * alimentada por 44 pontos do sistema (suspensão de organização, alteração de
 * vigência, upload de atas, etc.). Criar uma tabela paralela racharia a trilha
 * em duas e o Painel do Super Admin mostraria um histórico incompleto — o
 * oposto do objetivo de compliance.
 */

// ─── Contratos ────────────────────────────────────────────────────────────────

/** Dados de uma ação a ser registrada na trilha de auditoria. */
export interface RegistroAuditoria {
  /** Autor da ação. Nulo para ações do próprio sistema (jobs, seeds). */
  usuarioId?: string | null
  /** Verbo da ação, em caixa alta: 'SUSPENDEU_ORGANIZACAO', 'ANEXOU_ATA'. */
  acao: string
  /** Endereço IP de origem. 'SISTEMA' quando não há requisição HTTP. */
  ip?: string
  /** Recurso afetado: 'ORGANIZATION', 'VIRTUAL_PROCESS'… */
  recurso: string
  /** Identificador do recurso afetado. */
  recursoId?: string | null
  /** Organização dona do registro — preserva o isolamento multi-tenant. */
  organizacaoId?: string | null
  /** Navegador/cliente de origem. */
  agenteUsuario?: string | null
  /** Contexto livre da ação (valores antigos/novos, motivo, etc.). */
  detalhes?: Prisma.InputJsonValue
  /** A ação foi concluída com sucesso? Falhas também são auditáveis. */
  sucesso?: boolean
  /** Mensagem de erro, quando a ação falhou. */
  mensagemErro?: string | null
}

export interface FiltroConsultaAuditoria {
  pagina: number
  limite: number
  usuarioId?: string
  organizacaoId?: string
  acao?: string
  recurso?: string
  dataInicio?: Date
  dataFim?: Date
}

/**
 * Contrato do ledger. Note que existem apenas escrita e leitura:
 * a ausência de `atualizar`/`remover` é intencional e é a primeira
 * camada da garantia de imutabilidade.
 */
interface AdaptadorLedger {
  readonly nome: 'local' | 'qldb'
  registrar(dados: RegistroAuditoria): Promise<void>
  consultar(filtro: FiltroConsultaAuditoria): Promise<{ registros: unknown[]; total: number }>
}

// ─── Adaptador local (PostgreSQL) ─────────────────────────────────────────────

const adaptadorLocal: AdaptadorLedger = {
  nome: 'local',

  async registrar(dados) {
    await prisma.auditLog.create({
      data: {
        userId: dados.usuarioId ?? null,
        action: dados.acao,
        resource: dados.recurso,
        resourceId: dados.recursoId ?? null,
        ipAddress: dados.ip ?? 'SISTEMA',
        userAgent: dados.agenteUsuario ?? null,
        organizationId: dados.organizacaoId ?? null,
        metadata: dados.detalhes,
        success: dados.sucesso ?? true,
        errorMessage: dados.mensagemErro ?? null,
      },
    })
  },

  async consultar(filtro) {
    const where: Prisma.AuditLogWhereInput = {}

    if (filtro.usuarioId) where.userId = filtro.usuarioId
    if (filtro.organizacaoId) where.organizationId = filtro.organizacaoId
    if (filtro.acao) where.action = { contains: filtro.acao, mode: 'insensitive' }
    if (filtro.recurso) where.resource = filtro.recurso

    if (filtro.dataInicio || filtro.dataFim) {
      where.createdAt = {}
      if (filtro.dataInicio) where.createdAt.gte = filtro.dataInicio
      if (filtro.dataFim) where.createdAt.lte = filtro.dataFim
    }

    const [registros, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtro.pagina - 1) * filtro.limite,
        take: filtro.limite,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          organization: { select: { id: true, name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ])

    return { registros, total }
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
const adaptadorQldb: AdaptadorLedger = {
  nome: 'qldb',

  async registrar(dados) {
    throw new Error(
      `Adaptador QLDB ainda não implementado (ledger "${config.auditoria.qldb.nomeLedger}"). ` +
      `Ação "${dados.acao}" NÃO foi registrada. Use LEDGER_DRIVER=local até a migração para a AWS.`
    )
  },

  async consultar() {
    throw new Error(
      'Consulta ao QLDB ainda não implementada. Use LEDGER_DRIVER=local até a migração para a AWS.'
    )
  },
}

// ─── Seleção do adaptador ─────────────────────────────────────────────────────

const adaptadores: Record<'local' | 'qldb', AdaptadorLedger> = {
  local: adaptadorLocal,
  qldb: adaptadorQldb,
}

const adaptadorAtivo = adaptadores[config.auditoria.driver]

export const auditoriaService = {
  /** Driver em uso — exposto para diagnóstico e para os testes. */
  get driver() {
    return adaptadorAtivo.nome
  },

  /**
   * Registra uma ação na trilha de auditoria.
   *
   * Nunca lança para o chamador: auditoria é efeito colateral e uma falha ao
   * registrar não pode derrubar a operação de negócio que o usuário pediu. A
   * falha é logada em nível de erro para ser capturada pela observabilidade.
   */
  async registrar(dados: RegistroAuditoria): Promise<void> {
    try {
      await adaptadorAtivo.registrar(dados)
    } catch (erro) {
      logger.error(
        { erro, acao: dados.acao, recurso: dados.recurso, driver: adaptadorAtivo.nome },
        'Falha ao registrar auditoria'
      )
    }
  },

  /** Consulta paginada da trilha — usada pelo Painel do Super Admin. */
  async consultar(filtro: FiltroConsultaAuditoria) {
    const { registros, total } = await adaptadorAtivo.consultar(filtro)

    return {
      dados: registros,
      meta: {
        total,
        pagina: filtro.pagina,
        limite: filtro.limite,
        totalPaginas: Math.ceil(total / filtro.limite),
      },
    }
  },
}
