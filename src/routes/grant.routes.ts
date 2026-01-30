import { FastifyInstance } from 'fastify';
import { GrantController } from '../controllers/grant.controller';
import { authenticate } from '../middleware/auth.middleware';

export async function grantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/config', GrantController.getConfig);
  app.post('/configure', GrantController.configure);
  
  app.post('/sync', GrantController.sync);
  app.post('/reset', GrantController.reset); // <--- NOVA ROTA

  app.get('/', GrantController.list);
  app.get('/:id', GrantController.getDetails);
  app.post('/:id/notes', GrantController.createNote);
}