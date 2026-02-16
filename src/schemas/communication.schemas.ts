import { z } from 'zod'

// Definimos o schema de destinatário INLINE para evitar Ciclos de Importação
const recipientSchema = z.object({
  // Ajustado: Removemos .uuid() pois seus IDs (ex: Wpaj5Z...) não são UUIDs
  userId: z.string().min(1, 'ID do usuário inválido'),
  role: z.enum(['TO', 'CC', 'BCC']).default('TO')
})

// Schema de anexo INLINE
const attachmentSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(),
  fileType: z.string(),
  fileSize: z.number()
})

export const createDocumentSchema = z.object({
  title: z.string().min(3, 'O título deve ter pelo menos 3 caracteres').max(500),
  
  documentNumber: z.string().optional(),
  
  content: z.string().min(1, 'O conteúdo do documento é obrigatório'),
  
  documentType: z.string().min(1, 'O tipo de documento é obrigatório'), // Ex: 'OFICIO', 'MEMORANDO'
  
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  
  departmentId: z.string().optional(),
  
  sendEmailNotif: z.boolean().optional().default(false),
  
  // 🔥 CORREÇÃO: z.record exige 2 argumentos ou assume string->any. 
  // Usar .passthrough() em z.object() costuma ser mais seguro para JSON genérico,
  // mas z.record(z.string(), z.any()) funciona bem para metadados dinâmicos.
  metadata: z.record(z.string(), z.any()).optional(),

  // 🔥 SOLUÇÃO DO ERRO 500: Usamos a definição local, sem importar de outros arquivos
  recipients: z.array(recipientSchema).optional(),
  
  attachments: z.array(attachmentSchema).optional()
})

export const updateDocumentSchema = createDocumentSchema.partial()

export const documentIdSchema = z.object({
  id: z.string()
})

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>