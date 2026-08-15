import { FastifyInstance } from "fastify";
import { NotesController } from "../controllers/notes.controller";
import { authenticate, requireModule } from "../middleware/auth.middleware.js";

export async function notesRoutes(app: FastifyInstance) {
    const controller = new NotesController();

    // Middleware compartilhado em vez de hook próprio. O hook anterior:
    //  1. devolvia o erro cru com reply.send(err), expondo stack trace (CodeQL);
    //  2. omitia a normalização de organizationId, o mesmo defeito que causou o
    //     vazamento entre organizações no módulo de Comunicação (Épico 1);
    //  3. contornava o kill switch de organização suspensa (Épico 3).
    app.addHook('preHandler', authenticate)
    app.addHook('preHandler', requireModule('notes'))

    app.get("/", controller.findMany.bind(controller));
    app.post("/", controller.create.bind(controller));
    app.put("/:id", controller.update.bind(controller));
    app.delete("/:id", controller.delete.bind(controller));
}
