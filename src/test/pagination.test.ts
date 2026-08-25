import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  HARD_QUERY_CAP,
  MAX_PAGE_SIZE,
  boundedTake,
  paginationSchema,
} from '@/constants/pagination.js'

describe('paginationSchema', () => {
  it('aplica os padrões quando nada é enviado', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE })
  })

  it('coage strings de query string para número', () => {
    expect(paginationSchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 })
  })

  it('RECUSA limit acima do teto — o caso do épico', () => {
    expect(() => paginationSchema.parse({ limit: 10000 })).toThrow()
    expect(() => paginationSchema.parse({ limit: MAX_PAGE_SIZE + 1 })).toThrow()
  })

  it('aceita exatamente o teto', () => {
    expect(paginationSchema.parse({ limit: MAX_PAGE_SIZE }).limit).toBe(MAX_PAGE_SIZE)
  })

  it('recusa limit e page inválidos', () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow()
    expect(() => paginationSchema.parse({ limit: -5 })).toThrow()
    expect(() => paginationSchema.parse({ page: 0 })).toThrow()
    expect(() => paginationSchema.parse({ limit: 1.5 })).toThrow()
  })
})

describe('boundedTake', () => {
  it('devolve o teto duro quando o limit é omitido', () => {
    expect(boundedTake(undefined)).toBe(HARD_QUERY_CAP)
  })

  it('nunca ultrapassa o teto', () => {
    expect(boundedTake(99999)).toBe(HARD_QUERY_CAP)
  })

  it('respeita um limit válido abaixo do teto', () => {
    expect(boundedTake(25)).toBe(25)
  })

  it('trata valores inválidos como ausência', () => {
    expect(boundedTake(0)).toBe(HARD_QUERY_CAP)
    expect(boundedTake(-1)).toBe(HARD_QUERY_CAP)
  })

  it('aceita um teto customizado', () => {
    expect(boundedTake(undefined, 50)).toBe(50)
    expect(boundedTake(80, 50)).toBe(50)
  })
})

describe('invariantes dos limites', () => {
  it('o teto de página não passa do teto duro', () => {
    expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(HARD_QUERY_CAP)
  })

  it('o padrão não passa do teto de página', () => {
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE)
  })
})
