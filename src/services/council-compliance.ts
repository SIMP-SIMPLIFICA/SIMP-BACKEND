/**
 * Trava de compliance de reuniões de conselho.
 *
 * Ata de conselho municipal é documento de fé pública: passadas 72 horas da
 * reunião, o registro congela e nenhuma mutação é aceita — nem na reunião, nem
 * na pauta, nem na presença, nem nos documentos.
 *
 * NÃO existe mecanismo de desbloqueio por decisão de produto. Reabrir um registro
 * congelado exigiria funcionalidade própria, com regra de quem pode e auditoria
 * própria (ex: determinação judicial).
 */

/** Janela de edição após a reunião. */
export const MEETING_EDIT_WINDOW_HOURS = 72

const WINDOW_MS = MEETING_EDIT_WINDOW_HOURS * 60 * 60 * 1000

export const MEETING_FROZEN_ERROR = 'MEETING_FROZEN'
export const MEETING_FROZEN_MESSAGE =
  'Registro oficial congelado. O prazo de 72h após a reunião foi encerrado.'

/** Instante a partir do qual a reunião deixa de ser editável. */
export function getMeetingFreezeAt(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() + WINDOW_MS)
}

/**
 * Uma reunião está congelada quando já se passaram mais de 72h da sua data.
 *
 * A comparação é de INSTANTES (epoch em UTC), nunca de componentes locais de
 * data. Dois motivos:
 *  - o prazo é literalmente "72 horas", não "3 dias de calendário": arredondar
 *    para dia daria a alguém até ~24h a mais ou a menos conforme o horário da
 *    reunião;
 *  - `Date.getTime()` é sempre UTC, então servidor e banco chegam ao mesmo
 *    resultado sem o fuso entrar de contrabando (o que aconteceria ao usar
 *    getHours/setHours).
 *
 * Reunião futura ou de agora nunca congela — a diferença é negativa.
 */
export function isMeetingFrozen(scheduledAt: Date | null | undefined): boolean {
  if (!scheduledAt) return false
  const time = scheduledAt.getTime()
  if (Number.isNaN(time)) return false
  return Date.now() > time + WINDOW_MS
}

/**
 * Resultado da checagem para uso nos controllers.
 * `frozen: true` deve virar um 403 com MEETING_FROZEN_ERROR.
 */
export function checkMeetingEditable(scheduledAt: Date | null | undefined): {
  frozen: boolean
  freezeAt: Date | null
} {
  if (!scheduledAt) return { frozen: false, freezeAt: null }
  return {
    frozen: isMeetingFrozen(scheduledAt),
    freezeAt: getMeetingFreezeAt(scheduledAt),
  }
}
