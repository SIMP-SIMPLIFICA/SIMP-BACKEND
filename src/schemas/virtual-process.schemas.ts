import { z } from 'zod'

export const createVirtualProcessSchema = z.object({
  workspaceId: z.string().uuid(),
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
  subject: z.string().min(1),
  category: z.string().min(1),
  status: z.string().optional()
}).strip()

export type CreateVirtualProcessInput = z.infer<typeof createVirtualProcessSchema>

export const updateVirtualProcessStatusSchema = z.object({
  status: z.string().min(1)
}).strip()

export const updateCompanyInfoSchema = z.object({
  companyName: z.string().optional().nullable(),
  companyCnpj: z.string().optional().nullable()
}).strip()

export const uploadDocumentSchema = z.object({
  tag: z.string().min(1),
  description: z.string().optional().nullable()
}).strip()

export const createVirtualProcessCategorySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
}).strip()

export type CreateVirtualProcessCategoryInput = z.infer<typeof createVirtualProcessCategorySchema>

export const updateVirtualProcessCategorySchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type UpdateVirtualProcessCategoryInput = z.infer<typeof updateVirtualProcessCategorySchema>

export const createVirtualProcessSourceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
}).strip()

export type CreateVirtualProcessSourceInput = z.infer<typeof createVirtualProcessSourceSchema>

export const updateVirtualProcessSourceSchema = z.object({
  name: z.string().min(1).max(100),
}).strip()

export type UpdateVirtualProcessSourceInput = z.infer<typeof updateVirtualProcessSourceSchema>

export const createVirtualProcessCompanySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(150),
  cnpj: z.string().max(20).optional().nullable(),
}).strip()

export type CreateVirtualProcessCompanyInput = z.infer<typeof createVirtualProcessCompanySchema>

export const updateVirtualProcessCompanySchema = z.object({
  name: z.string().min(1).max(150),
  cnpj: z.string().max(20).optional().nullable(),
}).strip()

export type UpdateVirtualProcessCompanyInput = z.infer<typeof updateVirtualProcessCompanySchema>
