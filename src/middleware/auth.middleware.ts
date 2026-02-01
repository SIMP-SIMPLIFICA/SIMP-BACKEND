import { FastifyRequest, FastifyReply } from 'fastify'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  // 0. Ignorar requisições OPTIONS (Preflight do CORS)
  // O navegador envia isso antes do POST do arquivo. Se bloquearmos aqui, o upload nunca acontece.
  if (request.method === 'OPTIONS') {
    return
  }

  try {
    let token: string | null = null

    // 1. Tenta pegar do Header Authorization
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    // 2. Tenta pegar do Cookie
    if (!token && request.cookies?.token) {
      token = request.cookies.token
    }

    // DEBUG: Descomente se o erro persistir para ver o que está chegando
    // console.log(`[AUTH] Method: ${request.method} | Path: ${request.url} | Token Found: ${!!token}`)

    if (!token) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Token não fornecido ou inválido'
      })
    }

    // Verifica o token
    await request.jwtVerify()

    // Correção do user.id (mantida do seu código original)
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

export { authenticate as authMiddleware }