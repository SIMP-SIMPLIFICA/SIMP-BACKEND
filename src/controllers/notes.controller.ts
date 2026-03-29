import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";
import { createNoteSchema, updateNoteSchema } from "../schemas/notes.schemas";

export class NotesController {
    async findMany(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ message: "Não autorizado" });
        }

        const notes = await prisma.note.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        return reply.status(200).send(notes);
    }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ message: "Não autorizado" });
        }

        const data = createNoteSchema.parse(request.body);

        const note = await prisma.note.create({
            data: {
                title: data.title,
                content: data.content,
                color: data.color,
                user: { connect: { id: userId } },
            },
        });

        return reply.status(201).send(note);
    }

    async update(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ message: "Não autorizado" });
        }

        const { id } = request.params;
        const data = updateNoteSchema.parse(request.body);

        // Verify ownership
        const existingNote = await prisma.note.findUnique({ where: { id } });
        if (!existingNote || existingNote.userId !== userId) {
            return reply.status(404).send({ message: "Anotação não encontrada" });
        }

        const updatedNote = await prisma.note.update({
            where: { id },
            data,
        });

        return reply.status(200).send(updatedNote);
    }

    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ message: "Não autorizado" });
        }

        const { id } = request.params;

        // Verify ownership
        const existingNote = await prisma.note.findUnique({ where: { id } });
        if (!existingNote || existingNote.userId !== userId) {
            return reply.status(404).send({ message: "Anotação não encontrada" });
        }

        await prisma.note.delete({ where: { id } });

        return reply.status(204).send();
    }
}
