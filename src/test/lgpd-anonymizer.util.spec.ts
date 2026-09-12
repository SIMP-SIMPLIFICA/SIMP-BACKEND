import { describe, expect, test } from 'vitest'
import { anonymizeName, anonymizeUserName } from '../utils/lgpd-anonymizer.util.js'

/**
 * Ofuscação de nomes (LGPD).
 *
 * A função alimenta um registro PÚBLICO, então os casos de borda importam: um
 * nome que escape da máscara vaza dado pessoal no portal da transparência.
 */

describe('Ofuscação de nomes para exposição pública', () => {
  describe('regra principal', () => {
    test('primeiro nome inteiro, meio em iniciais, sobrenome mascarado', () => {
      expect(anonymizeName('Carlos Magno Almeida Soares')).toBe('Carlos M. A. S***')
    })

    test('nome com duas palavras mascara o sobrenome', () => {
      expect(anonymizeName('Maria Souza')).toBe('Maria S***')
    })

    test('três palavras', () => {
      expect(anonymizeName('João Pedro Silva')).toBe('João P. S***')
    })
  })

  describe('partículas permanecem legíveis', () => {
    test('"de" não vira inicial', () => {
      // "Carlos d. A***" seria ilegível e não protegeria ninguém: a partícula
      // não identifica pessoa alguma.
      expect(anonymizeName('Carlos de Almeida')).toBe('Carlos de A***')
    })

    test('partículas múltiplas', () => {
      expect(anonymizeName('Ana dos Santos da Silva')).toBe('Ana dos S. da S***')
    })

    test('partícula em caixa alta é normalizada para minúscula', () => {
      expect(anonymizeName('Ana DOS Santos')).toBe('Ana dos S***')
    })
  })

  describe('casos de borda', () => {
    test('nome único é devolvido inteiro', () => {
      // Não há sobrenome a proteger; "C***" destruiria a única informação útil.
      expect(anonymizeName('Carlos')).toBe('Carlos')
    })

    test('vazio devolve rótulo neutro', () => {
      expect(anonymizeName('')).toBe('Não identificado')
    })

    test('nulo e indefinido não quebram', () => {
      expect(anonymizeName(null)).toBe('Não identificado')
      expect(anonymizeName(undefined)).toBe('Não identificado')
    })

    test('apenas espaços devolve rótulo neutro', () => {
      expect(anonymizeName('    ')).toBe('Não identificado')
    })

    test('espaços extras são colapsados', () => {
      expect(anonymizeName('  Carlos   Magno   Soares  ')).toBe('Carlos M. S***')
    })

    test('só partículas após o primeiro nome não inventa máscara', () => {
      // Digitação sobrando ("Carlos de"): sem a busca pelo último nome real, a
      // partícula seria mascarada como se fosse sobrenome.
      expect(anonymizeName('Carlos de')).toBe('Carlos de')
    })

    test('acentuação é preservada na inicial', () => {
      expect(anonymizeName('José Ângelo Ávila')).toBe('José Â. Á***')
    })
  })

  describe('a partir de campos separados', () => {
    test('combina nome e sobrenome', () => {
      expect(anonymizeUserName('Carlos', 'Soares')).toBe('Carlos S***')
    })

    test('sem sobrenome devolve só o primeiro nome', () => {
      expect(anonymizeUserName('Carlos', null)).toBe('Carlos')
    })

    test('ambos ausentes devolve rótulo neutro', () => {
      expect(anonymizeUserName(null, null)).toBe('Não identificado')
    })
  })

  describe('garantia de não vazamento', () => {
    test('nenhum sobrenome completo sobrevive à ofuscação', () => {
      const surnames = ['Almeida', 'Soares', 'Conceição', 'Nascimento']
      const masked = anonymizeName(`Carlos ${surnames.join(' ')}`)

      // O primeiro nome permanece; nenhum sobrenome aparece por extenso.
      expect(masked).toContain('Carlos')
      for (const surname of surnames) {
        expect(masked).not.toContain(surname)
      }
    })
  })
})
