import { FastifyInstance } from "fastify";
import { NotesController } from "../controllers/notes.controller";

export async function notesRoutes(app: FastifyInstance) {
    const controller = new NotesController();

    app.addHook('onRequest', async (request, reply) => {
        try {
            await request.jwtVerify()
            const user = request.user as any
            if (user && user.sub && !user.id) {
                user.id = user.sub
            }
        } catch (err) {
            reply.send(err)
        }
    })

    app.get("/", controller.findMany.bind(controller));
    app.post("/", controller.create.bind(controller));
    app.put("/:id", controller.update.bind(controller));
    app.delete("/:id", controller.delete.bind(controller));
}
