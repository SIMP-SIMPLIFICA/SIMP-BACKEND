import { describe, expect, test } from 'vitest'
import {
  isValidChassis,
  isValidCnhNumber,
  isValidCpf,
  isValidPlate,
  isValidRenavam,
  maskCnhNumber,
  maskCpf,
  normalizePlate,
  onlyDigits,
} from '../utils/fleet-validators.js'

describe('validadores de frota', () => {
  describe('placa', () => {
    test('normaliza hífen, espaço e minúsculas', () => {
      expect(normalizePlate(' abc-1d23 ')).toBe('ABC1D23')
      expect(normalizePlate('abc 1234')).toBe('ABC1234')
    })

    test('aceita o formato antigo e o Mercosul', () => {
      expect(isValidPlate('ABC1234')).toBe(true)
      expect(isValidPlate('ABC1D23')).toBe(true)
    })

    test('recusa formatos inválidos', () => {
      for (const plate of ['AB1234', 'ABCD123', 'ABC12345', 'ABC1DD3', '1BC1234', '']) {
        expect(isValidPlate(plate)).toBe(false)
      }
    })
  })

  describe('Renavam', () => {
    test('aceita Renavam com dígito verificador correto', () => {
      // 0123456789 → Σ = 202; 202 × 10 mod 11 = 7
      expect(isValidRenavam('01234567897')).toBe(true)
    })

    test('recusa DV errado e tamanho errado', () => {
      expect(isValidRenavam('01234567898')).toBe(false)
      expect(isValidRenavam('1234567897')).toBe(false)
    })
  })

  describe('CPF', () => {
    test('aceita CPF válido', () => {
      expect(isValidCpf(onlyDigits('529.982.247-25'))).toBe(true)
    })

    test('recusa DV errado e sequências repetidas', () => {
      expect(isValidCpf('52998224724')).toBe(false)
      expect(isValidCpf('11111111111')).toBe(false)
      expect(isValidCpf('5299822472')).toBe(false)
    })

    test('máscara nunca expõe o CPF inteiro', () => {
      expect(maskCpf('52998224725')).toBe('***.982.247-**')
    })
  })

  describe('CNH e chassi', () => {
    test('CNH: 11 dígitos, sem sequência repetida', () => {
      expect(isValidCnhNumber('02650306461')).toBe(true)
      expect(isValidCnhNumber('00000000000')).toBe(false)
      expect(isValidCnhNumber('123')).toBe(false)
      expect(maskCnhNumber('02650306461')).toBe('*******6461')
    })

    test('chassi: 17 caracteres sem I, O e Q', () => {
      expect(isValidChassis('9BWZZZ377VT004251')).toBe(true)
      expect(isValidChassis('9BWZZZ377VT00425I')).toBe(false)
      expect(isValidChassis('9BWZZZ377VT0042')).toBe(false)
    })
  })
})
