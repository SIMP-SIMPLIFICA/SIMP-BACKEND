import { z } from "zod";

export const createNoteSchema = z.object({
    title: z.string().max(255).optional(),
    content: z.string(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const updateNoteSchema = createNoteSchema.partial();

export type CreateNoteDto = z.infer<typeof createNoteSchema>;
export type UpdateNoteDto = z.infer<typeof updateNoteSchema>;
