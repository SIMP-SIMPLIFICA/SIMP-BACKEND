import { z } from 'zod';
import { FinanceEntryType } from '@prisma/client';

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Nome da categoria é obrigatório').max(100),
  description: z.string().max(500).optional(),
}).strip()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const createEntrySchema = z.object({
  occurredAt:       z.string().datetime({ message: 'Data do lançamento inválida (use ISO 8601)' }),
  description:      z.string().min(1, 'Descrição é obrigatória').max(255),
  amountCents:      z.number().int().positive('Valor deve ser maior que zero'),
  type:             z.nativeEnum(FinanceEntryType).default(FinanceEntryType.EXPENSE),
  categoryId:       z.string().uuid('Categoria inválida — informe um UUID válido'),
  accountId:        z.string().uuid('Conta bancária inválida — informe um UUID válido'),
  subcategoryName:  z.string().min(1, 'Subcategoria é obrigatória').max(100),
  providerDocument: z.string().min(1, 'CPF/CNPJ do fornecedor é obrigatório').max(50),
  nfeNumber:        z.string().min(1, 'Número da NF-e é obrigatório').max(50),
  empenhoNumber:    z.string().min(1, 'Número do empenho é obrigatório').max(50),
  liquidacaoNumber: z.string().min(1, 'Número da liquidação é obrigatório').max(50),
  issueDate:        z.string().datetime({ message: 'Data de emissão inválida (use ISO 8601)' }),
  deliveryDate:     z.string().datetime({ message: 'Data de entrega inválida (use ISO 8601)' }),
  attachmentsStatus: z.enum(['none', 'pending', 'ok']).default('none'),
}).strip()

export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const updateEntrySchema = createEntrySchema.partial();

export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

export const createBankAccountSchema = z.object({
  name: z.string().min(1, 'Nome da conta é obrigatório').max(100),
  agency: z.string().max(20).optional().nullable(),
  accountNumber: z.string().max(30).optional().nullable(),
  initialBalanceCents: z.number().int().default(0),
}).strip();

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

export const updateBankAccountSchema = createBankAccountSchema.partial();

export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;
