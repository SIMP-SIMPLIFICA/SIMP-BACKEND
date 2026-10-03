import { describe, expect, test } from 'vitest'
import { currencyToWords } from '../utils/currency-in-words.util.js'

describe('Valor por extenso (Anexo I)', () => {
  test('valor redondo, sem centavos', () => {
    expect(currencyToWords(750)).toBe('SETECENTOS E CINQUENTA REAIS')
  })

  test('centavos aparecem só quando existem', () => {
    expect(currencyToWords(750.5)).toBe('SETECENTOS E CINQUENTA REAIS E CINQUENTA CENTAVOS')
    expect(currencyToWords(100.01)).toBe('CEM REAIS E UM CENTAVO')
  })

  test('singular de real e centavo', () => {
    expect(currencyToWords(1)).toBe('UM REAL')
    expect(currencyToWords(1.01)).toBe('UM REAL E UM CENTAVO')
  })

  test('zero', () => {
    expect(currencyToWords(0)).toBe('ZERO REAIS')
  })

  test('cem não vira "cento"', () => {
    // Regra clássica do português: "CEM" isolado, "CENTO E..." quando há resto.
    expect(currencyToWords(100)).toBe('CEM REAIS')
    expect(currencyToWords(101)).toBe('CENTO E UM REAIS')
  })

  test('dezenas de 11 a 19 usam a forma irregular', () => {
    expect(currencyToWords(15)).toBe('QUINZE REAIS')
    expect(currencyToWords(19)).toBe('DEZENOVE REAIS')
  })

  test('mil não repete "um"', () => {
    expect(currencyToWords(1000)).toBe('MIL REAIS')
    expect(currencyToWords(2000)).toBe('DOIS MIL REAIS')
  })

  test('milhar composto', () => {
    expect(currencyToWords(1234)).toBe('MIL DUZENTOS E TRINTA E QUATRO REAIS')
  })

  test('milhão', () => {
    expect(currencyToWords(1_000_000)).toBe('UM MILHÃO REAIS')
    expect(currencyToWords(2_500_000)).toBe('DOIS MILHÕES E QUINHENTOS MIL REAIS')
  })

  test('valor negativo é tratado pelo módulo — não é o extenso que decide sinal', () => {
    expect(currencyToWords(-750)).toBe('SETECENTOS E CINQUENTA REAIS')
  })

  test('arredonda sujeira de ponto flutuante em centavos', () => {
    // 0.1 + 0.2 = 0.30000000000000004 em ponto flutuante puro.
    expect(currencyToWords(0.1 + 0.2)).toBe('ZERO REAIS E TRINTA CENTAVOS')
  })
})
