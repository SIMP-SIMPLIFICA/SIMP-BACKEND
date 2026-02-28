import { z } from 'zod';
import { FinanceEntryType } from '@prisma/client';

export const createCategorySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const createEntrySchema = z.object({
  workspaceId: z.string().uuid(),
  occurredAt: z.string().datetime(), // expects ISO string
  description: z.string().min(1, 'Description is required').max(255),
  amountCents: z.number().int().positive('Amount must be positive'),
  type: z.nativeEnum(FinanceEntryType).default(FinanceEntryType.EXPENSE),
  categoryId: z.string().uuid().optional().nullable(),
  subcategoryName: z.string().max(100).optional().nullable(),
  nfeNumber: z.string().max(50).optional().nullable(),
  issueDate: z.string().datetime().optional().nullable(),
  providerDocument: z.string().max(20).optional().nullable(),
  empenhoNumber: z.string().max(50).optional().nullable(),
  liquidacaoNumber: z.string().max(50).optional().nullable(),
  deliveryDate: z.string().datetime().optional().nullable(),
  attachmentsStatus: z.enum(['none', 'pending', 'ok']).default('none'),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const updateEntrySchema = createEntrySchema.partial().omit({ workspaceId: true });

export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
