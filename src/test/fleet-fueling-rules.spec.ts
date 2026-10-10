import { describe, expect, test } from 'vitest'
import {
  addBusinessDays,
  cnhCovers,
  compatibleFuels,
  endOfLocalDay,
  localIsoDate,
  localYear,
  requiredCnhCategory,
} from '../utils/fleet-fueling-rules.js'

describe('regras da autorização de abastecimento', () => {
  describe('dias úteis', () => {
    test('segunda + 3 dias úteis = quinta', () => {
      expect(addBusinessDays('2026-10-05', 3, [])).toBe('2026-10-08')
    })

    test('sexta + 3 dias úteis = quarta, pulando o fim de semana', () => {
      expect(addBusinessDays('2026-10-02', 3, [])).toBe('2026-10-07')
    })

    test('feriado da organização não conta como dia útil', () => {
      // 12/10 (segunda) é feriado: sexta 09/10 + 3 = 13, 14, 15.
      expect(addBusinessDays('2026-10-09', 3, ['2026-10-12'])).toBe('2026-10-15')
    })

    test('feriado no fim de semana não desconta duas vezes', () => {
      expect(addBusinessDays('2026-11-13', 1, ['2026-11-15'])).toBe('2026-11-16')
    })
  })

  describe('fuso de Brasília', () => {
    test('a data local vira no meio da noite UTC, não à meia-noite UTC', () => {
      // 02:30 UTC de 06/10 ainda é 23:30 de 05/10 em Brasília.
      expect(localIsoDate(new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-05')
      expect(localYear(new Date('2027-01-01T02:00:00Z'))).toBe(2026)
    })

    test('fim do dia local = 02:59:59.999 UTC do dia seguinte', () => {
      expect(endOfLocalDay('2026-10-08').toISOString()).toBe('2026-10-09T02:59:59.999Z')
    })
  })

  describe('combustível compatível', () => {
    test('flex aceita gasolina e etanol, nunca diesel', () => {
      expect(compatibleFuels('FLEX')).toEqual(['GASOLINA', 'ETANOL'])
    })

    test('motor S500 aceita S10; motor S10 não aceita S500', () => {
      expect(compatibleFuels('DIESEL_S500')).toContain('DIESEL_S10')
      expect(compatibleFuels('DIESEL_S10')).not.toContain('DIESEL_S500')
    })

    test('elétrico não tem combustível autorizável', () => {
      expect(compatibleFuels('ELETRICO')).toEqual([])
    })
  })

  describe('categoria de CNH', () => {
    test('exigência por tipo de veículo', () => {
      expect(requiredCnhCategory('AUTOMOVEL')).toBe('B')
      expect(requiredCnhCategory('MOTOCICLETA')).toBe('A')
      expect(requiredCnhCategory('ONIBUS')).toBe('D')
      expect(requiredCnhCategory('MAQUINA')).toBeNull()
    })

    test('categorias de quatro rodas são cumulativas', () => {
      expect(cnhCovers('E', 'B')).toBe(true)
      expect(cnhCovers('D', 'C')).toBe(true)
      expect(cnhCovers('B', 'C')).toBe(false)
      expect(cnhCovers('AD', 'D')).toBe(true)
    })

    test('A é independente das demais', () => {
      expect(cnhCovers('B', 'A')).toBe(false)
      expect(cnhCovers('AB', 'A')).toBe(true)
      expect(cnhCovers('A', 'B')).toBe(false)
    })
  })
})
