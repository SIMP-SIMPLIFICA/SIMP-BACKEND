import { FastifyInstance } from 'fastify';
import { FinanceCategoryController } from '../controllers/finance-category.controller.js';
import { FinanceEntryController } from '../controllers/finance-entry.controller.js';
import { FinanceBankAccountController } from '../controllers/finance-bank-account.controller.js';
import { authMiddleware, requireModule, requirePermission } from '../middleware/auth.middleware.js';

const categoryController = new FinanceCategoryController();
const entryController = new FinanceEntryController();
const bankAccountController = new FinanceBankAccountController();

export function financeRoutes(app: FastifyInstance) {
    // Todas as rotas de finanças requerem autenticação
    app.addHook('preHandler', authMiddleware);
    app.addHook('preHandler', requireModule('finance'));

    // --- Rotas de Contas Bancárias (org-scoped) ---
    app.post('/accounts', bankAccountController.create.bind(bankAccountController));
    app.get('/accounts', bankAccountController.list.bind(bankAccountController));
    app.put('/accounts/:id', bankAccountController.update.bind(bankAccountController));
    app.delete('/accounts/:id', bankAccountController.delete.bind(bankAccountController));

    // --- Rotas de Categorias (org-scoped) ---
    app.post('/categories', categoryController.create.bind(categoryController));
    app.get('/categories', categoryController.list.bind(categoryController));
    app.put('/categories/:id', categoryController.update.bind(categoryController));
    app.delete('/categories/:id', categoryController.delete.bind(categoryController));

    // --- Rotas de Lançamentos (Entries) ---
    app.post('/entries', { preHandler: requirePermission(['finance:write']) }, entryController.create.bind(entryController));
    app.get('/entries', { preHandler: requirePermission(['finance:read']) }, entryController.list.bind(entryController));
    app.put('/entries/:id', { preHandler: requirePermission(['finance:write']) }, entryController.update);
    app.delete('/entries/:id', { preHandler: requirePermission(['finance:manage']) }, entryController.delete);

    // --- Rotas de Anexos (Attachments) ---
    app.get('/entries/:entryId/attachments', entryController.listAttachments);
    app.post('/entries/:entryId/attachments', entryController.uploadAttachment);
    app.delete('/entries/:entryId/attachments/:attachmentId', entryController.deleteAttachment);
}
