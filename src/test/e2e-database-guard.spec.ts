import { afterEach, describe, expect, test } from 'vitest'
import {
  assertIsTestDatabaseUrl,
  getDatabaseName,
  maskUrl,
  resolveMaintenanceUrl,
  resolveTestDatabaseUrl,
} from '../tests/e2e-database.js'

/**
 * Trava de isolamento do banco de testes de integração.
 *
 * Estes testes existem porque a função protegida APAGA TABELAS. Se a derivação
 * da URL errar, o banco de desenvolvimento é destruído — então a trava precisa
 * ser verificada com o mesmo rigor de um controle de acesso.
 */

const DEV_URL = 'postgresql://postgres:senha@localhost:5432/fastify_auth?schema=public'

afterEach(() => {
  delete process.env.E2E_DATABASE_URL
})

describe('Trava de isolamento do banco E2E', () => {
  describe('derivação da URL', () => {
    test('troca apenas o nome do banco, preservando host e credenciais', () => {
      const url = new URL(resolveTestDatabaseUrl(DEV_URL))

      expect(url.pathname).toBe('/fastify_auth_e2e')
      expect(url.hostname).toBe('localhost')
      expect(url.port).toBe('5432')
      expect(url.username).toBe('postgres')
    })

    test('sem DATABASE_URL, falha em vez de adivinhar', () => {
      expect(() => resolveTestDatabaseUrl(undefined)).toThrow(/DATABASE_URL/)
    })

    test('E2E_DATABASE_URL sobrescreve, mas continua sujeita à trava', () => {
      process.env.E2E_DATABASE_URL = 'postgresql://u:p@outro-host:5432/qualquer_e2e'
      expect(getDatabaseName(resolveTestDatabaseUrl(DEV_URL))).toBe('qualquer_e2e')
    })

    test('override sem o sufixo é RECUSADO', () => {
      // O cenário perigoso: alguém aponta o override para o banco de produção.
      process.env.E2E_DATABASE_URL = 'postgresql://u:p@host:5432/producao'
      expect(() => resolveTestDatabaseUrl(DEV_URL)).toThrow(/_e2e/)
    })
  })

  describe('recusa de alvos perigosos', () => {
    test('banco sem o sufixo _e2e é recusado', () => {
      expect(() => assertIsTestDatabaseUrl('postgresql://u:p@h:5432/fastify_auth')).toThrow(
        /precisa terminar em "_e2e"/
      )
    })

    test('nome que apenas CONTÉM _e2e no meio é recusado', () => {
      // "..._e2e_producao" não pode passar por ser um banco de teste.
      expect(() => assertIsTestDatabaseUrl('postgresql://u:p@h:5432/app_e2e_producao')).toThrow(
        /_e2e/
      )
    })

    test('banco de teste igual ao de desenvolvimento é recusado', () => {
      expect(() =>
        assertIsTestDatabaseUrl(
          'postgresql://u:p@h:5432/app_e2e',
          'postgresql://u:p@h:5432/app_e2e'
        )
      ).toThrow(/MESMO/)
    })

    test('URL válida de teste passa', () => {
      expect(() =>
        assertIsTestDatabaseUrl('postgresql://u:p@h:5432/app_e2e', DEV_URL)
      ).not.toThrow()
    })
  })

  describe('conexão administrativa', () => {
    test('aponta para o banco `postgres` do mesmo servidor', () => {
      // Não é possível criar um banco estando conectado a ele.
      const admin = new URL(resolveMaintenanceUrl('postgresql://u:p@h:5432/app_e2e'))
      expect(admin.pathname).toBe('/postgres')
      expect(admin.hostname).toBe('h')
    })
  })

  describe('mascaramento', () => {
    test('a senha não aparece em log nem em mensagem de erro', () => {
      const masked = maskUrl(DEV_URL)
      expect(masked).not.toContain('senha')
      expect(masked).toContain('***')
    })

    test('URL inválida não quebra o log', () => {
      expect(maskUrl('nao-e-url')).toBe('(url inválida)')
    })
  })
})
