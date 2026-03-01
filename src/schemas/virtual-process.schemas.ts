import { z } from 'zod'

export const createVirtualProcessSchema = z.object({
  processNumber: z.string().regex(/^\d+\/\d{4}$/, 'O número deve estar no formato NUMERO/ANO (ex: 001/2026)'),
  secretaria: z.string().min(1),
  source: z.string().min(1),
  sourceDetail: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  agency: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  subject: z.string().min(1),
  category: z.string().min(1)
})

export type CreateVirtualProcessInput = z.infer<typeof createVirtualProcessSchema>

export const updateVirtualProcessStatusSchema = z.object({
  status: z.string().min(1)
})

export const uploadDocumentSchema = z.object({
  tag: z.string().min(1),
  description: z.string().optional().nullable()
})
