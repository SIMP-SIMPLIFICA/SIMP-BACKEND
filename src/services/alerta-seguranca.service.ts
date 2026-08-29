import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import { redis } from '@/utils/redis.js'
import { safeFetch } from '@/utils/url-security.js'
import { auditoriaService } from '@/services/auditoria.service.js'
import type { Prisma } from '@prisma/client'

/**
 * Alertas de anomalia comportamental (Épico 2, Task 2.3).
 *
 * Avalia cada login em busca de sinais de acesso indevido e notifica o Super
 * Admin por webhook (futuramente ligado ao WhatsApp/Telegram).
 *
 * PRINCÍPIO — ALERTA NUNCA DERRUBA LOGIN:
 *   Todo o fluxo é fire-and-forget. Se o Redis estiver fora, se o webhook
 *   demorar ou responder erro, o login do usuário segue normalmente e a falha
 *   vira log. Uma proteção que impede o servidor da prefeitura de autenticar
 *   quando um serviço externo cai é pior que a ameaça que ela combate.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TipoAnomalia = 'LOGIN_MADRUGADA' | 'DESLOCAMENTO_IMPOSSIVEL'

export interface ContextoLogin {
  usuarioId: string
  email: string
  ip: string
  agenteUsuario?: string | null
  organizacaoId?: string | null
  /** Injetável para testes; default é o instante atual. */
  quando?: Date
}

export interface Anomalia {
  tipo: TipoAnomalia
  descricao: string
  detalhes: Record<string, unknown>
}

/** Último acesso registrado por usuário, guardado no Redis. */
interface UltimoAcesso {
  ip: string
  quandoISO: string
}

const PREFIXO_ULTIMO_ACESSO = 'seguranca:ultimo-acesso:'
/** 30 dias: tempo suficiente para comparar logins esparsos sem inchar o Redis. */
const TTL_ULTIMO_ACESSO_SEG = 30 * 24 * 60 * 60

// ─── Regras de detecção ───────────────────────────────────────────────────────

/**
 * Login em horário atípico (madrugada).
 *
 * A comparação usa a hora LOCAL do servidor de propósito: "madrugada" é um
 * conceito do fuso de quem opera o sistema, não do UTC. Um servidor rodando em
 * UTC classificaria 22h de Brasília como 01h e alertaria em pleno expediente.
 */
export function detectarLoginMadrugada(quando: Date): Anomalia | null {
  const hora = quando.getHours()
  const inicio = config.alertas.horaInicioMadrugada
  const fim = config.alertas.horaFimMadrugada

  // Suporta janelas que cruzam a meia-noite (ex.: 23h–05h).
  const dentroDaJanela = inicio <= fim
    ? hora >= inicio && hora <= fim
    : hora >= inicio || hora <= fim

  if (!dentroDaJanela) return null

  return {
    tipo: 'LOGIN_MADRUGADA',
    descricao: `Login realizado as ${String(hora).padStart(2, '0')}h, dentro da janela de madrugada (${inicio}h-${fim}h).`,
    detalhes: { hora, janelaInicio: inicio, janelaFim: fim },
  }
}

/**
 * Deslocamento impossível — troca de IP em intervalo curto demais.
 *
 * LIMITAÇÃO ASSUMIDA: sem base de geolocalização offline, não há como medir
 * distância real nem comparar ASN. A aproximação viável é olhar o IP anterior:
 * se mudou dentro da janela configurada, alerta. Isso gera falso positivo
 * legítimo (trocar de Wi-Fi para 4G, por exemplo) — e é justamente por isso que
 * o resultado é ALERTA e nunca bloqueio. Com geolocalização disponível, esta
 * função é o único ponto a evoluir.
 */
export function detectarDeslocamentoImpossivel(
  ipAtual: string,
  anterior: UltimoAcesso | null,
  agora: Date,
): Anomalia | null {
  if (!anterior || anterior.ip === ipAtual) return null

  const minutosDesdeUltimo = (agora.getTime() - new Date(anterior.quandoISO).getTime()) / 60000
  if (minutosDesdeUltimo > config.alertas.janelaViagemMinutos) return null

  return {
    tipo: 'DESLOCAMENTO_IMPOSSIVEL',
    descricao:
      `Login de um IP diferente ${Math.round(minutosDesdeUltimo)} minuto(s) apos o acesso anterior - ` +
      'intervalo curto demais para um deslocamento fisico real.',
    detalhes: {
      ipAnterior: anterior.ip,
      ipAtual,
      minutosDesdeUltimoAcesso: Math.round(minutosDesdeUltimo),
      janelaConfiguradaMinutos: config.alertas.janelaViagemMinutos,
    },
  }
}

// ─── Envio do alerta ──────────────────────────────────────────────────────────

/**
 * Dispara o webhook.
 *
 * safeFetch (e não fetch cru) é obrigatório: a URL vem de variável de ambiente e
 * um POST para destino configurável é exatamente o padrão de SSRF que o CodeQL
 * apontou no túnel do Sentry. Sem essa guarda, um webhook mal configurado
 * apontando para a rede interna transformaria o alerta num scanner da rede da
 * prefeitura — e a resposta de cada tentativa revelaria o que existe lá dentro.
 */
async function enviarWebhook(anomalias: Anomalia[], contexto: ContextoLogin): Promise<void> {
  const url = config.alertas.webhookUrl
  if (!url) return // alertas desligados

  const corpo = {
    evento: 'ACESSO_SUSPEITO',
    ocorridoEm: (contexto.quando ?? new Date()).toISOString(),
    usuario: { id: contexto.usuarioId, email: contexto.email },
    organizacaoId: contexto.organizacaoId ?? null,
    origem: { ip: contexto.ip, agenteUsuario: contexto.agenteUsuario ?? null },
    anomalias: anomalias.map(a => ({
      tipo: a.tipo,
      descricao: a.descricao,
      detalhes: a.detalhes,
    })),
  }

  // Timeout curto: o alerta não pode segurar recurso do servidor esperando um
  // destino lento. Sem redirecionamento — um webhook legítimo não redireciona,
  // e seguir 30x seria mais uma porta para SSRF.
  await safeFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    },
    { timeoutMs: 3000, maxRedirects: 0 },
  )
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

export const alertaSegurancaService = {
  /**
   * Avalia um login e dispara alerta se houver anomalia.
   *
   * NÃO deve ser aguardado pelo fluxo de login (fire-and-forget): nunca lança e
   * nunca bloqueia. Qualquer falha interna vira log em pt-BR.
   */
  async avaliarLogin(contexto: ContextoLogin): Promise<void> {
    try {
      const agora = contexto.quando ?? new Date()
      const chave = `${PREFIXO_ULTIMO_ACESSO}${contexto.usuarioId}`

      // Falha do Redis não pode impedir a regra de horário, que não depende dele.
      let anterior: UltimoAcesso | null = null
      try {
        anterior = await redis.getJSON<UltimoAcesso>(chave)
      } catch (erro) {
        logger.warn({ erro }, 'Nao foi possivel ler o ultimo acesso no Redis; seguindo sem a regra de deslocamento')
      }

      const anomalias = [
        detectarLoginMadrugada(agora),
        detectarDeslocamentoImpossivel(contexto.ip, anterior, agora),
      ].filter((a): a is Anomalia => a !== null)

      // Registra o acesso atual mesmo sem anomalia — é a base de comparação do
      // próximo login.
      try {
        await redis.setJSON(
          chave,
          { ip: contexto.ip, quandoISO: agora.toISOString() } satisfies UltimoAcesso,
          TTL_ULTIMO_ACESSO_SEG,
        )
      } catch (erro) {
        logger.warn({ erro }, 'Nao foi possivel registrar o ultimo acesso no Redis')
      }

      if (anomalias.length === 0) return

      logger.warn(
        {
          usuarioId: contexto.usuarioId,
          email: contexto.email,
          ip: contexto.ip,
          anomalias: anomalias.map(a => a.tipo),
        },
        'Acesso suspeito detectado',
      )

      // A trilha de auditoria guarda o alerta mesmo que o webhook falhe — o
      // registro imutável é a fonte de verdade, o webhook é só a notificação.
      await auditoriaService.registrar({
        usuarioId: contexto.usuarioId,
        acao: 'ACESSO_SUSPEITO_DETECTADO',
        recurso: 'SEGURANCA',
        recursoId: contexto.usuarioId,
        ip: contexto.ip,
        organizacaoId: contexto.organizacaoId ?? null,
        agenteUsuario: contexto.agenteUsuario ?? null,
        // JSON.parse(JSON.stringify(...)) normaliza para o InputJsonValue do
        // Prisma, que não aceita tipos estruturais diretamente.
        detalhes: JSON.parse(JSON.stringify({ anomalias })) as Prisma.InputJsonValue,
      })

      try {
        await enviarWebhook(anomalias, contexto)
      } catch (erro) {
        // Webhook fora do ar, lento ou apontando para rede interna (recusado
        // pelo safeFetch): nada disso pode afetar o login já concluído.
        logger.error(
          { erro, usuarioId: contexto.usuarioId },
          'Falha ao enviar alerta de seguranca para o webhook',
        )
      }
    } catch (erro) {
      // Rede de segurança final: nenhuma exceção escapa deste serviço.
      logger.error({ erro }, 'Falha inesperada ao avaliar anomalias de login')
    }
  },
}
