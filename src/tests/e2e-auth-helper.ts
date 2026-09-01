import { randomUUID } from 'node:crypto'
import type { Organization, Role, User } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { authService } from '@/services/auth.service.js'
import { calculateFingerprint } from '@/services/fingerprint.service.js'

/**
 * Utilidades de autenticação para os testes de integração.
 *
 * REUSO, NÃO IMITAÇÃO: o token é assinado por `authService.generateAccessToken`
 * — a MESMA função que o login de produção usa — e o fingerprint sai de
 * `calculateFingerprint`, a mesma que o middleware recalcula a cada requisição.
 * Uma lógica de JWT paralela produziria testes que passam enquanto a
 * autenticação real está quebrada, que é o oposto do que um teste de integração
 * serve para fazer.
 *
 * POR QUE O FINGERPRINT PRECISA DE ATENÇÃO AQUI: o middleware compara o claim
 * `fp` do token com o hash de (faixa de rede + User-Agent) da requisição. Token
 * e cabeçalhos precisam contar a mesma história, senão toda requisição
 * autenticada dos testes levaria 401 por sessão invalidada.
 *
 * `TRUST_PROXY` vale 1 por padrão, então o Fastify aceita `X-Forwarded-For` como
 * origem — é isso que permite fixar o IP nos testes.
 */

/** Origem simulada. O fingerprint do token é calculado a partir destes valores. */
export const TEST_IP = '192.168.0.1'
export const TEST_USER_AGENT = 'e2e-test-agent'

export interface TestUserOptions {
  /** Organização do usuário. Nulo apenas para super admin de plataforma. */
  organizationId: string | null
  /** Permissões concedidas — viram uma Role real no banco. */
  permissions?: string[]
  isSuperAdmin?: boolean
  email?: string
}

export interface TestUserSession {
  user: User
  role: Role | null
  token: string
  /** Cabeçalhos prontos para `app.inject`. */
  headers: Record<string, string>
}

/**
 * Cabeçalhos de uma requisição autenticada.
 *
 * O User-Agent e o X-Forwarded-For não são enfeite: sem eles o fingerprint
 * recalculado pelo middleware não bate com o do token e a resposta vira 401.
 */
export function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': TEST_USER_AGENT,
    'X-Forwarded-For': TEST_IP,
  }
}

/**
 * Cabeçalhos de origem SEM autenticação.
 *
 * Útil para provar que uma rota protegida recusa quem não se identificou —
 * mantendo o resto da requisição idêntico, de modo que a única diferença seja a
 * ausência do token.
 */
export function buildAnonymousHeaders(): Record<string, string> {
  return {
    'User-Agent': TEST_USER_AGENT,
    'X-Forwarded-For': TEST_IP,
  }
}

/**
 * Cria uma organização de teste, opcionalmente com módulos habilitados.
 *
 * Os módulos importam: as rotas passam por `requireModule`, e sem a linha
 * correspondente em `OrganizationModule` a requisição leva 403 MODULE_DISABLED
 * antes de chegar ao controller.
 */
export async function createTestOrganization(options?: {
  name?: string
  modules?: string[]
  isActive?: boolean
}): Promise<Organization> {
  const suffix = randomUUID().slice(0, 8)

  const organization = await prisma.organization.create({
    data: {
      name: options?.name ?? `Prefeitura de Teste ${suffix}`,
      slug: `teste-${suffix}`,
      isActive: options?.isActive ?? true,
    },
  })

  if (options?.modules?.length) {
    await prisma.organizationModule.createMany({
      data: options.modules.map(module => ({
        organizationId: organization.id,
        module,
        isEnabled: true,
      })),
    })
  }

  return organization
}

/**
 * Cria um usuário com as permissões pedidas e devolve token e cabeçalhos.
 *
 * As permissões viram uma Role de verdade ligada ao usuário porque o
 * `requirePermission` as lê do BANCO, não do token (Zero Trust — ver
 * auth.middleware.ts). Colocá-las apenas no JWT faria o teste passar por um
 * caminho que a produção não usa.
 *
 * NOTA SOBRE A ASSINATURA: não recebe a instância do Fastify. O token é assinado
 * pelo serviço de autenticação da aplicação, que não depende do servidor — pedir
 * `app` aqui seria um parâmetro que nada faz, e parâmetros inúteis viram
 * armadilha para quem lê depois.
 */
export async function createTestUserWithToken(
  options: TestUserOptions
): Promise<TestUserSession> {
  const suffix = randomUUID().slice(0, 8)
  const permissions = options.permissions ?? []

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: options.email ?? `servidor-${suffix}@prefeitura.gov.br`,
      password: 'nao-usado-neste-fluxo',
      firstName: 'Servidor',
      lastName: 'de Teste',
      organizationId: options.organizationId,
      isSuperAdmin: options.isSuperAdmin ?? false,
      isActive: true,
    },
  })

  let role: Role | null = null

  if (permissions.length > 0) {
    // `Role.name` é único globalmente, daí o sufixo aleatório.
    role = await prisma.role.create({
      data: {
        name: `test-role-${suffix}`,
        displayName: 'Perfil de Teste',
        permissions,
        organizationId: options.organizationId,
        isActive: true,
      },
    })

    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })
  }

  // Mesma função do login de produção — inclusive o fingerprint no claim `fp`.
  const token = await authService.generateAccessToken(
    user.id,
    permissions,
    options.organizationId,
    user.isSuperAdmin,
    calculateFingerprint(TEST_IP, TEST_USER_AGENT)
  )

  return { user, role, token, headers: buildAuthHeaders(token) }
}
