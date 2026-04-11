import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'EXPIRED']).default('TODO'),
  dueDate: z.string().datetime().optional(), // Recebe string ISO do front
  assigneeIds: z.array(z.string()).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const createChecklistItemSchema = z.object({
  title: z.string().min(1),
});

export const updateChecklistItemSchema = z.object({
  isDone: z.boolean().optional(),
  title: z.string().optional(),
});