import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      id?: string;
      email?: string;
      permissions: string[];
      organizationId: string | null;
      isSuperAdmin: boolean;
      type: string;
    };
    user: {
      sub: string;
      id: string;
      email?: string;
      permissions: string[];
      organizationId: string | null;
      isSuperAdmin: boolean;
      type: string;
    };
  }
}