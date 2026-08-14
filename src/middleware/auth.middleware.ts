import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'

// ---------------------------------------------------------------------------
// Kill switch — suspensão de organização
// ---------------------------------------------------------------------------

/**
 * Cache do status de suspensão por organização. Espelha o `moduleCache` abaixo:
 * `authenticate` roda em TODA requisição, e consultar o banco a cada uma seria um
 * custo permanente para um estado que muda raríssimas vezes.
 *
 * O TTL curto é só rede de segurança para alterações feitas fora do endpoint
 * (ex: SQL manual). Pelo caminho normal, `invalidateOrgStatusCache()` é chamado
 * na alternância e o efeito é imediato na requisição seguinte.
 */
const orgStatusCache = new Map<string, { isActive: boolean; expiry: number }>()
const ORG_STATUS_CACHE_TTL = 60 * 1000 // 60 segundos

/** Invalida o status em cache de uma org (chamar ao suspender/reativar). */
export function invalidateOrgStatusCache(orgId: string) {
  orgStatusCache.delete(orgId)
}

/** Resolve se a organização está ativa, usando cache com fallback ao banco. */
async function isOrganizationActive(orgId: string): Promise<boolean> {
  const cached = orgStatusCache.get(orgId)
  if (cached && cached.expiry > Date.now()) return cached.isActive

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { isActive: true },
  })

  // Organização inexistente é tratada como inativa (falha fechada).
  const isActive = org?.isActive ?? false
  orgStatusCache.set(orgId, { isActive, expiry: Date.now() + ORG_STATUS_CACHE_TTL })
  return isActive
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  // 0. Ignorar requisições OPTIONS (Preflight do CORS)
  if (request.method === 'OPTIONS') {
    return
  }

  try {
    // 1. TRUQUE PARA SSE (Server-Sent Events):
    // Se o token vier na URL (?token=...), injetamos ele no Header Authorization.
    // Isso engana o jwtVerify() para ele achar que o token veio no cabeçalho padrão.
    const queryToken = (request.query as any)?.token
    if (queryToken) {
      request.headers.authorization = `Bearer ${queryToken}`
    }

    // 2. Verifica o token
    // O plugin vai olhar: 1º Header Authorization (que acabamos de preencher se for SSE), 2º Cookies
    await request.jwtVerify()

    // Normalização do payload JWT para os controllers
    const user = request.user as {
      id?: string
      sub?: string
      organizationId?: string | null
      isSuperAdmin?: boolean
      [key: string]: unknown
    }

    if (user?.sub && !user.id) {
      user.id = user.sub
    }
    if (user.organizationId === undefined) user.organizationId = null
    if (user.isSuperAdmin === undefined) user.isSuperAdmin = false

  } catch (err) {
    request.log.warn({ err }, 'JWT verification failed')
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Falha na autenticação'
    })
  }

  // --- Kill switch: bloqueio de organização suspensa ---
  // Fora do try/catch acima de propósito: uma falha de banco aqui não é uma falha
  // de autenticação e não deve ser mascarada como 401 "token inválido".
  //
  // A ORDEM ABAIXO É CRÍTICA e não pode ser reorganizada:
  const authUser = request.user as { organizationId?: string | null; isSuperAdmin?: boolean }

  // 1º) Super Admin nativo retorna ANTES de qualquer consulta de organização.
  //     Se essa checagem viesse depois, suspender todas as organizações
  //     bloquearia o próprio Super Admin — e a única pessoa capaz de reativar
  //     perderia o acesso para fazê-lo (bloqueio irreversível pela interface).
  if (authUser.isSuperAdmin) return

  // 2º) Usuário sem organização não tem o que estar suspenso — segue, e o acesso
  //     continua governado por requireModule/permissões (que já recusam
  //     "Usuário sem organização" com mensagem adequada).
  if (!authUser.organizationId) return

  // 3º) Demais usuários: organização suspensa derruba a requisição, mesmo com
  //     token emitido antes da suspensão.
  if (!(await isOrganizationActive(authUser.organizationId))) {
    return reply.code(403).send({
      error: 'ORGANIZATION_SUSPENDED',
      message: 'Organização suspensa. Entre em contato com o suporte.'
    })
  }
}

// Exportação dupla para garantir compatibilidade com rotas antigas
export { authenticate as authMiddleware }

export async function checkPermission(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermissions: string[]
) {
  const user = request.user as any
  if (!user || !user.id) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Sessão inválida ou expirada',
      statusCode: 401
    })
  }

  // Busca as roles e permissões reais do usuário no banco
  // Evita confiar apenas no payload do JWT (Zero Trust)
  const userWithRoles = await prisma.user.findUnique({
    where: { id: user.id },
    include: { roles: { include: { role: true } } }
  })

  if (!userWithRoles || !userWithRoles.isActive) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Usuário inexistente ou desativado',
      statusCode: 401
    })
  }

  const userPermissions = new Set<string>()
  for (const userRole of userWithRoles.roles) {
    if (userRole.role.isActive) {
      const permissions = userRole.role.permissions as string[]
      if (Array.isArray(permissions)) {
        permissions.forEach(p => userPermissions.add(p))
      }
    }
  }

  // Bypass para Administrador do Sistema
  if (userPermissions.has('system:admin')) return

  const hasPermission = requiredPermissions.some(p => userPermissions.has(p))

  if (!hasPermission) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Você não tem permissão militar para acessar este recurso',
      statusCode: 403
    })
  }
}

export function requirePermission(permissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await checkPermission(request, reply, permissions)
  }
}

// Alias para compatibilidade
export { requirePermission as requireAnyPermission }

// ---------------------------------------------------------------------------
// requireModule — feature flag por organização
// ---------------------------------------------------------------------------

// Cache simples em memória: orgId → { módulos habilitados, expiração }
const moduleCache = new Map<string, { modules: Set<string>; expiry: number }>()
const MODULE_CACHE_TTL = 5 * 60 * 1000 // 5 minutos

/** Invalida o cache de módulos de uma org (chamar ao habilitar/desabilitar módulo). */
export function invalidateModuleCache(orgId: string) {
  moduleCache.delete(orgId)
}

/**
 * Middleware factory: verifica se o módulo está habilitado para a org do usuário.
 * Super admin bypassa sempre. Usuários sem org recebem 403.
 */
export function requireModule(module: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any
    if (!user?.id) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Não autenticado.' })
    }

    if (user.isSuperAdmin) return

    const orgId = user.organizationId as string | undefined
    if (!orgId) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Usuário sem organização.' })
    }

    // Tenta cache
    const cached = moduleCache.get(orgId)
    if (cached && cached.expiry > Date.now()) {
      if (!cached.modules.has(module)) {
        return reply.code(403).send({
          error: 'MODULE_DISABLED',
          message: 'Este módulo não está disponível para sua organização.',
        })
      }
      return
    }

    // Cache miss — busca no banco
    const rows = await prisma.organizationModule.findMany({
      where: { organizationId: orgId, isEnabled: true },
      select: { module: true },
    })
    const enabledSet = new Set(rows.map(r => r.module))
    moduleCache.set(orgId, { modules: enabledSet, expiry: Date.now() + MODULE_CACHE_TTL })

    if (!enabledSet.has(module)) {
      return reply.code(403).send({
        error: 'MODULE_DISABLED',
        message: 'Este módulo não está disponível para sua organização.',
      })
    }
  }
}