import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  MEETING_EDIT_WINDOW_HOURS,
  checkMeetingEditable,
  getMeetingFreezeAt,
  isMeetingFrozen,
} from '../services/council-compliance.js'

const HOUR = 60 * 60 * 1000

/** Data a N horas do "agora" fixado nos testes (negativo = passado). */
function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * HOUR)
}

describe('Trava de compliance de 72h — reuniões de conselho', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('a janela configurada é de 72 horas', () => {
    expect(MEETING_EDIT_WINDOW_HOURS).toBe(72)
  })

  describe('dentro do prazo — permanece editável', () => {
    test('reunião futura não congela', () => {
      expect(isMeetingFrozen(hoursFromNow(48))).toBe(false)
    })

    test('reunião de agora não congela', () => {
      expect(isMeetingFrozen(new Date())).toBe(false)
    })

    test('reunião de 1 hora atrás não congela', () => {
      expect(isMeetingFrozen(hoursFromNow(-1))).toBe(false)
    })

    test('reunião de 71 horas atrás ainda não congela', () => {
      expect(isMeetingFrozen(hoursFromNow(-71))).toBe(false)
    })

    test('exatamente 72 horas ainda NÃO congela (o corte é > 72h, não >=)', () => {
      vi.useFakeTimers()
      const scheduledAt = new Date('2026-08-01T12:00:00.000Z')
      vi.setSystemTime(new Date(scheduledAt.getTime() + 72 * HOUR))

      expect(isMeetingFrozen(scheduledAt)).toBe(false)
    })
  })

  describe('fora do prazo — congela', () => {
    test('1 minuto após as 72 horas congela', () => {
      vi.useFakeTimers()
      const scheduledAt = new Date('2026-08-01T12:00:00.000Z')
      vi.setSystemTime(new Date(scheduledAt.getTime() + 72 * HOUR + 60_000))

      expect(isMeetingFrozen(scheduledAt)).toBe(true)
    })

    test('reunião de 73 horas atrás congela', () => {
      expect(isMeetingFrozen(hoursFromNow(-73))).toBe(true)
    })

    test('reunião de vários dias atrás congela', () => {
      expect(isMeetingFrozen(hoursFromNow(-24 * 30))).toBe(true)
    })
  })

  describe('robustez de entrada', () => {
    test('data nula não congela (não há prazo a contar)', () => {
      expect(isMeetingFrozen(null)).toBe(false)
      expect(isMeetingFrozen(undefined)).toBe(false)
    })

    test('data inválida não congela — não pode travar registro por dado corrompido', () => {
      expect(isMeetingFrozen(new Date('data-invalida'))).toBe(false)
    })
  })

  describe('independência de fuso horário', () => {
    // A conta é de INSTANTES (epoch UTC), nunca de componentes locais de data.
    // Duas datas que representam o mesmo instante em fusos diferentes precisam
    // produzir exatamente o mesmo veredito.
    test('mesmo instante escrito em fusos diferentes gera o mesmo resultado', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'))

      const emUtc     = new Date('2026-08-01T12:00:00.000Z')
      const emBrasil  = new Date('2026-08-01T09:00:00.000-03:00') // mesmo instante
      const emToquio  = new Date('2026-08-01T21:00:00.000+09:00') // mesmo instante

      expect(emUtc.getTime()).toBe(emBrasil.getTime())
      expect(emUtc.getTime()).toBe(emToquio.getTime())

      expect(isMeetingFrozen(emUtc)).toBe(isMeetingFrozen(emBrasil))
      expect(isMeetingFrozen(emUtc)).toBe(isMeetingFrozen(emToquio))
    })

    test('o corte não muda conforme a hora do dia da consulta', () => {
      const scheduledAt = new Date('2026-08-01T23:30:00.000Z')

      // Consultando em horários diferentes do mesmo dia, ambos dentro do prazo
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-04T01:00:00.000Z')) // ~49.5h depois
      const cedo = isMeetingFrozen(scheduledAt)

      vi.setSystemTime(new Date('2026-08-04T22:00:00.000Z')) // ~70.5h depois
      const tarde = isMeetingFrozen(scheduledAt)

      expect(cedo).toBe(false)
      expect(tarde).toBe(false)
    })
  })

  describe('getMeetingFreezeAt', () => {
    test('devolve exatamente 72 horas após a reunião', () => {
      const scheduledAt = new Date('2026-08-01T12:00:00.000Z')
      const freezeAt = getMeetingFreezeAt(scheduledAt)

      expect(freezeAt.getTime() - scheduledAt.getTime()).toBe(72 * HOUR)
      expect(freezeAt.toISOString()).toBe('2026-08-04T12:00:00.000Z')
    })
  })

  describe('checkMeetingEditable', () => {
    test('devolve frozen=false e o instante-limite quando dentro do prazo', () => {
      const scheduledAt = hoursFromNow(-2)
      const result = checkMeetingEditable(scheduledAt)

      expect(result.frozen).toBe(false)
      expect(result.freezeAt).toEqual(getMeetingFreezeAt(scheduledAt))
    })

    test('devolve frozen=true quando fora do prazo', () => {
      expect(checkMeetingEditable(hoursFromNow(-100)).frozen).toBe(true)
    })

    test('sem data, não congela e não há instante-limite', () => {
      expect(checkMeetingEditable(null)).toEqual({ frozen: false, freezeAt: null })
    })
  })
})
