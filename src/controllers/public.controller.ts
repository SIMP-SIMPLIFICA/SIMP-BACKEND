import { FastifyReply, FastifyRequest } from 'fastify'

export class PublicController {
  async validateDocument(_request: FastifyRequest, reply: FastifyReply) {
    return reply.code(410).send({
      valid: false,
      message: 'A validação de documentos por hash foi removida. O módulo de documentos oficiais não está mais disponível.'
    })
  }
}
