import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma.js'

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

    // Correção do user.id para garantir compatibilidade
    // O token JWT geralmente traz o ID no campo 'sub'.
    // Aqui garantimos que request.user.id exista para os controllers usarem.
    const user = request.user as any
    if (user && user.sub && !user.id) {
      user.id = user.sub
    }
    
  } catch (err) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Falha na autenticação',
      details: err
    })
  }
}

// Exportação dupla para garantir compatibilidade com rotas antigas
export { authenticate as authMiddleware }

export function requireAnyPermission(requiredPermissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any
    if (!user || !user.id) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Usuário não autenticado' })
    }

    // Busca as roles do usuário para checar permissões reais
    const userWithRoles = await prisma.user.findUnique({
      where: { id: user.id },
      include: { roles: { include: { role: true } } }
    })

    if (!userWithRoles) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Usuário não encontrado' })
    }

    const userPermissions = new Set<string>()
    for (const userRole of userWithRoles.roles) {
      const permissions = userRole.role.permissions as string[]
      if (Array.isArray(permissions)) {
        permissions.forEach(p => userPermissions.add(p))
      }
    }

    // Bypass para Super Admin
    if (userPermissions.has('system:admin')) return

    const hasPermission = requiredPermissions.some(p => userPermissions.has(p))
    if (!hasPermission) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Permissões insuficientes para esta ação' })
    }
  }
}