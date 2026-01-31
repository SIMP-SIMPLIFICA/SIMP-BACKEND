import { FastifyRequest, FastifyReply } from 'fastify'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    let token: string | null = null

    // 1. Tenta pegar do Header Authorization
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    // 2. Tenta pegar do Cookie (Essencial para uploads e sessão)
    if (!token && request.cookies?.token) {
      token = request.cookies.token
    }

    if (!token) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Token não fornecido ou inválido'
      })
    }

    // Verifica o token
    await request.jwtVerify()

    // --- CORREÇÃO DO ERRO 500 (Abas Sumidas) ---
    // O token JWT geralmente traz o ID no campo 'sub'.
    // Aqui garantimos que request.user.id exista para os controllers usarem.
    const user = request.user as any
    if (user && user.sub && !user.id) {
      user.id = user.sub
    }
    // -------------------------------------------
    
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