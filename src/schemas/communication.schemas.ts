import { z } from 'zod'

const recipientSchema = z.object({
  userId: z.string().min(1, 'ID do usuário inválido'),
  role: z.enum(['TO', 'CC', 'BCC']).default('TO')
}).strip()

const attachmentSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(),
  fileType: z.string(),
  fileSize: z.number()
}).strip()

export const createMessageSchema = z.object({
  subject: z.string().min(3, 'O assunto deve ter pelo menos 3 caracteres').max(500),
  body: z.string().min(1, 'O corpo da mensagem é obrigatório'),
  recipients: z.array(recipientSchema).min(1, 'Informe ao menos um destinatário'),
  attachments: z.array(attachmentSchema).optional()
}).strip()

export const updateMessageSchema = createMessageSchema.partial()

export const messageIdSchema = z.object({
  id: z.string()
}).strip()

export type CreateMessageInput = z.infer<typeof createMessageSchema>
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>
