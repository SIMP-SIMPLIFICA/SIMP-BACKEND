import { FastifyReply, FastifyRequest } from 'fastify'

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
    const user = request.user
    if (user?.sub && !user.id) {
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