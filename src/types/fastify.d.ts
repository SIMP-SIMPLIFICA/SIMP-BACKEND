export {}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: any
    payload: any
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string
      sub?: string
      email?: string
      permissions: string[]
      organizationId: string | null
      isSuperAdmin: boolean
      [key: string]: unknown
    }
    permissions: string[]
  }
}