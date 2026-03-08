import { z } from 'zod';
import { FinanceEntryType } from '@prisma/client';

export const createCategorySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
}).strip()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const createEntrySchema = z.object({
  workspaceId: z.string().uuid(),
  occurredAt: z.string().datetime(), // expects ISO string
  description: z.string().min(1, 'Description is required').max(255),
  amountCents: z.number().int().positive('Amount must be positive'),
  type: z.nativeEnum(FinanceEntryType).default(FinanceEntryType.EXPENSE),
  categoryId: z.string().uuid().optional().nullable(),
  attachmentsStatus: z.enum(['none', 'pending', 'ok']).default('none'),
}).strip()

export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const updateEntrySchema = createEntrySchema.partial().omit({ workspaceId: true });

export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
