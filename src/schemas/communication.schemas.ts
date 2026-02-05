import { z } from 'zod'

export const createDocumentSchema = z.object({
  title: z.string().min(3, 'O título deve ter pelo menos 3 caracteres').max(500),
  documentNumber: z.string().optional(),
  content: z.string().min(1, 'O conteúdo do documento é obrigatório'),
  documentType: z.string().min(1, 'O tipo de documento é obrigatório'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  departmentId: z.string().optional(),
  sendEmailNotif: z.boolean().optional().default(false),
  recipients: z.array(
    z.object({
      userId: z.string().uuid().or(z.string()),
      role: z.enum(['TO', 'CC', 'BCC']).default('TO')
    })
  ).optional()
})

export const updateDocumentSchema = createDocumentSchema.partial()

export const documentIdSchema = z.object({
  id: z.string()
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>