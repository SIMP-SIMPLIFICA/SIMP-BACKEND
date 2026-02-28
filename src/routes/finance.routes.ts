import { FastifyInstance } from 'fastify';
import { FinanceCategoryController } from '../controllers/finance-category.controller.js';
import { FinanceEntryController } from '../controllers/finance-entry.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const categoryController = new FinanceCategoryController();
const entryController = new FinanceEntryController();

export async function financeRoutes(app: FastifyInstance) {
    // Todas as rotas de finanças requerem autenticação
    app.addHook('preHandler', authMiddleware);

    // --- Rotas de Categorias ---
    app.post('/workspaces/:workspaceId/categories', categoryController.create);
    app.get('/workspaces/:workspaceId/categories', categoryController.list);
    app.put('/categories/:id', categoryController.update);
    app.delete('/categories/:id', categoryController.delete);

    // --- Rotas de Lançamentos (Entries) ---
    app.post('/workspaces/:workspaceId/entries', entryController.create);
    app.get('/workspaces/:workspaceId/entries', entryController.list);
    app.put('/entries/:id', entryController.update);
    app.delete('/entries/:id', entryController.delete);

    // --- Rotas de Anexos (Attachments) ---
    app.get('/entries/:entryId/attachments', entryController.listAttachments);
    app.post('/entries/:entryId/attachments', entryController.uploadAttachment);
    app.delete('/entries/:entryId/attachments/:attachmentId', entryController.deleteAttachment);
}
