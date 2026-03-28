export {}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: any
    payload: any
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: any
    permissions: any
  }
}