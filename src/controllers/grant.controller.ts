import { FastifyReply, FastifyRequest } from 'fastify';
import { GrantService } from '../services/grant.service';

const grantService = new GrantService();

export class GrantController {
  
  static async sync(req: FastifyRequest<{ Body: { startDate?: string, endDate?: string, status?: string } }>, reply: FastifyReply) {
    try {
      const filters = req.body || {};
      const result = await grantService.syncGrants(filters);
      return reply.send(result);
    } catch (error: any) {
      const configErrors = ['TOKEN_MISSING', 'CNPJ_MISSING', 'TOKEN_INVALID'];
      if (configErrors.includes(error.message)) {
        return reply.status(400).send({ 
          error: error.message, 
          message: "Configuração incompleta ou inválida." 
        });
      }
      req.log.error(error);
      return reply.status(500).send({ message: "Erro interno na sincronização." });
    }
  }

  // --- NOVO: Rota para limpar o banco ---
  static async reset(req: FastifyRequest, reply: FastifyReply) {
    try {
      await grantService.deleteAll();
      return reply.send({ message: "Todos os convênios foram removidos." });
    } catch (error) {
      return reply.status(500).send({ message: "Erro ao limpar banco." });
    }
  }

  static async configure(req: FastifyRequest<{ Body: { token: string; cnpj: string } }>, reply: FastifyReply) {
    const { token, cnpj } = req.body;
    if (!token || !cnpj) return reply.status(400).send({ message: "Token e CNPJ são obrigatórios" });
    await grantService.saveConfig(token, cnpj);
    return reply.send({ message: "Configurações salvas!" });
  }

  static async getConfig(req: FastifyRequest, reply: FastifyReply) {
    const config = await grantService.getConfig();
    return reply.send(config);
  }

  static async list(req: FastifyRequest<{ Querystring: { search?: string, status?: string } }>, reply: FastifyReply) {
    const { search, status } = req.query;
    const grants = await grantService.listGrants({ search, status });
    return reply.send(grants);
  }

  static async getDetails(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const grant = await grantService.getGrantDetails(id);
    if (!grant) return reply.status(404).send({ message: 'Convênio não encontrado' });
    return reply.send(grant);
  }

  static async createNote(req: FastifyRequest<{ Params: { id: string }, Body: { content: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const { content } = req.body;
    // @ts-ignore
    const userId = req.user.id; 
    const note = await grantService.addNote(userId, id, content);
    return reply.status(201).send(note);
  }
}