import { z } from 'zod'

export const createVirtualProcessSchema = z.object({
  processNumber: z.string().regex(/^\d+\/\d{4}$/, 'O número deve estar no formato NUMERO/ANO (ex: 001/2026)'),
  secretaria: z.string().min(1),
  source: z.string().min(1),
  sourceDetail: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  agency: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  companyCnpj: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  // Vigência legal — é esta data que dispara os alertas de vencimento.
  validityDate: z.coerce.date().optional().nullable(),
  totalValue: z.coerce.number().nonnegative().optional().nullable(),
  subject: z.string().min(1),
  category: z.string().min(1),
  status: z.string().optional()
}).strip().refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: 'A data de início não pode ser posterior à data de encerramento.', path: ['startDate'] }
)

export type CreateVirtualProcessInput = z.infer<typeof createVirtualProcessSchema>

export const updateVirtualProcessStatusSchema = z.object({
  status: z.string().min(1)
}).strip()

/**
 * Atualização de prazo/valor de um processo já existente.
 * Ambos anuláveis de propósito: `null` remove uma validade ou valor já gravado
 * (diferente de `undefined`, que significa "não mexer neste campo").
 */
export const updateValiditySchema = z.object({
  validityDate: z.coerce.date().optional().nullable(),
  totalValue: z.coerce.number().nonnegative().optional().nullable(),
}).strip()

export type UpdateValidityInput = z.infer<typeof updateValiditySchema>

export const updateCompanyInfoSchema = z.object({
  companyName: z.string().optional().nullable(),
  companyCnpj: z.string().optional().nullable()
}).strip()

export const uploadDocumentSchema = z.object({
  tag: z.string().min(1),
  description: z.string().optional().nullable()
}).strip()

export const createVirtualProcessCategorySchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type CreateVirtualProcessCategoryInput = z.infer<typeof createVirtualProcessCategorySchema>

export const updateVirtualProcessCategorySchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type UpdateVirtualProcessCategoryInput = z.infer<typeof updateVirtualProcessCategorySchema>

export const createVirtualProcessSourceSchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type CreateVirtualProcessSourceInput = z.infer<typeof createVirtualProcessSourceSchema>

export const updateVirtualProcessSourceSchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type UpdateVirtualProcessSourceInput = z.infer<typeof updateVirtualProcessSourceSchema>

export const createVirtualProcessCompanySchema = z.object({
  name: z.string().min(1).max(150),
  cnpj: z.string().max(20).optional().nullable(),
}).strip()

export type CreateVirtualProcessCompanyInput = z.infer<typeof createVirtualProcessCompanySchema>

export const updateVirtualProcessCompanySchema = z.object({
  name: z.string().min(1).max(150),
  cnpj: z.string().max(20).optional().nullable(),
}).strip()

export type UpdateVirtualProcessCompanyInput = z.infer<typeof updateVirtualProcessCompanySchema>
