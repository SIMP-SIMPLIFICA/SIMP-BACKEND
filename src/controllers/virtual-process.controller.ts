import { FastifyReply, FastifyRequest } from 'fastify'
import { db } from '@/utils/database.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import { departmentExistsInOrganization } from '@/utils/department-scope.util.js'
import { z } from 'zod'
import { createVirtualProcessSchema, updateBudgetSchema, updateCompanyInfoSchema, updateValiditySchema, uploadDocumentSchema } from '@/schemas/virtual-process.schemas.js'
import { deleteFile, getFileUrl, saveFile } from '@/services/storage.service.js'
import { UPLOAD_POLICIES, assertAllowedFile } from '@/services/file-validation.service.js'
import { BudgetError, budgetService } from '@/services/budget.service.js'

export class VirtualProcessController {
  async listProcesses(request: FastifyRequest, reply: FastifyReply) {
    try {
      const organizationId = (request as any).user?.organizationId as string
      const orgFilter = (request as any).user?.isSuperAdmin ? {} : { organizationId }

      const querySchema = z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(50),
        search: z.string().optional(),
        status: z.string().optional(),
        secretaria: z.string().optional(),
        bankAccount: z.string().optional(),
        source: z.string().optional(),
        category: z.string().optional(),
        companyCnpj: z.string().optional(),
        companyName: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        // Janela de vencimento em dias: ?expiringIn=30 traz o que vence nos
        // próximos 30 dias (processos sem validityDate ficam fora naturalmente).
        expiringIn: z.coerce.number().int().positive().optional(),
      })

      const query = querySchema.parse(request.query)
      const where: any = { ...orgFilter }

      if (query.search) {
        where.OR = [
          { processNumber: { contains: query.search, mode: 'insensitive' } },
          { subject: { contains: query.search, mode: 'insensitive' } },
          { secretaria: { contains: query.search, mode: 'insensitive' } },
          { category: { contains: query.search, mode: 'insensitive' } }
        ]
      }

      if (query.status) where.status = query.status
      if (query.secretaria) where.secretaria = query.secretaria
      if (query.bankAccount) where.bankAccount = query.bankAccount
      if (query.source) where.source = query.source
      if (query.category) where.category = query.category
      if (query.companyCnpj) where.companyCnpj = query.companyCnpj
      if (query.companyName) where.companyName = { contains: query.companyName, mode: 'insensitive' }

      if (query.startDate || query.endDate) {
        where.createdAt = {}
        if (query.startDate) where.createdAt.gte = query.startDate
        if (query.endDate) where.createdAt.lte = query.endDate
      }

      if (query.expiringIn !== undefined) {
        // Limite inferior é o INÍCIO de hoje (não "agora"), senão um processo que
        // vence hoje sumiria do filtro no meio do expediente. Limite superior é o
        // FIM do último dia da janela, para incluí-lo por inteiro.
        const from = new Date()
        from.setHours(0, 0, 0, 0)
        const to = new Date(from)
        to.setDate(to.getDate() + query.expiringIn)
        to.setHours(23, 59, 59, 999)

        where.validityDate = { gte: from, lte: to }
      }

      const total = await prisma.virtualProcess.count({ where })
      const processes = await prisma.virtualProcess.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count: { select: { documents: true } }
        }
      })

      const paginatedResult = db.paginate(processes, query.page, query.limit, total)
      return reply.send(paginatedResult)
    } catch (error: any) {
      logger.error(error, 'Failed to list virtual processes')
      return reply.code(500).send({ error: 'Process Fetch Failed', message: error.message })
    }
  }

  async getProcessDetails(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const userId = (request as any).user?.id as string

      const process = await prisma.virtualProcess.findUnique({
        where: { id },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
          documents: {
            include: { uploader: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { uploadedAt: 'desc' }
          },
          // Documentos anexados via Convênio e atribuídos a este processo.
          // Armazenamento continua sendo o da Biblioteca — aqui só os lemos.
          libraryDocuments: {
            where: { deletedAt: null },
            select: {
              id: true, title: true, fileName: true, fileSize: true, mimeType: true,
              accessLevel: true, createdAt: true, covenantId: true,
              uploader: { select: { id: true, firstName: true, lastName: true } },
              covenant: { select: { id: true, number: true } },
            },
            orderBy: { createdAt: 'desc' }
          },
          covenants: {
            select: { id: true, number: true, status: true, processObject: true,
              covenantType: { select: { id: true, name: true } } }
          }
        }
      })

      if (!process) return reply.code(404).send({ error: 'Process Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Process Not Found', message: 'Processo não encontrado' })
      }

      const auditLogs = await prisma.auditLog.findMany({
        where: { resource: 'VIRTUAL_PROCESS', resourceId: id },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, firstName: true, lastName: true } } }
      })

      await auditLedgerService.record({
        userId,
        action: 'VISUALIZOU',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
      })

      // Normalização na leitura: os dois modelos de documento têm formatos
      // diferentes (VirtualProcessDocument: fileUrl/tag; LibraryDocument:
      // fileKey/accessLevel/title). Aqui devolvemos uma forma unificada com a
      // origem marcada, para o frontend distinguir procedência sem duplicar regra.
      const { libraryDocuments, ...processRest } = process
      const unifiedDocuments = [
        ...process.documents.map(doc => ({
          id: doc.id,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          uploader: doc.uploader,
          tag: doc.tag,
          description: doc.description,
          source: 'process' as const,
        })),
        ...libraryDocuments.map(doc => ({
          id: doc.id,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          uploadedAt: doc.createdAt,
          uploader: doc.uploader,
          title: doc.title,
          accessLevel: doc.accessLevel,
          covenantNumber: doc.covenant?.number ?? null,
          source: 'covenant' as const,
        })),
      ].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())

      return reply.send({
        process: { ...processRest, documents: process.documents, unifiedDocuments },
        auditLog: auditLogs
      })
    } catch (error: any) {
      logger.error(error, 'Failed to get virtual process details')
      return reply.code(500).send({ error: 'Process Fetch Failed', message: error.message })
    }
  }

  async createProcess(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createVirtualProcessSchema.parse(request.body)
      const userId = (request as any).user?.id as string
      const organizationId = (request as any).user?.organizationId as string

      if (!organizationId && !(request as any).user?.isSuperAdmin) {
        return reply.code(403).send({ message: 'Usuário sem organização' })
      }

      const existingProcess = await prisma.virtualProcess.findUnique({
        where: { organizationId_processNumber: { organizationId, processNumber: data.processNumber } }
      })
      if (existingProcess) {
        return reply.code(400).send({ error: 'Conflict', message: 'Número de processo já existe nesta organização' })
      }

      if (data.departmentId && !(await departmentExistsInOrganization(data.departmentId, organizationId))) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'O departamento informado não existe nesta organização.',
        })
      }

      // Dotação do QDD que lastreia o processo (Épico 8, FR-011) — mesmo
      // padrão de DailyAllowance: valida o vínculo E tira uma cópia TEXTUAL
      // da ficha, para que o processo não mude de dotação retroativamente só
      // porque o cadastro do QDD mudou depois.
      let qddSnapshot: {
        qddFichaSnapshot: string
        qddFonteSnapshot: string
        qddNaturezaSnapshot: string
      } | null = null

      if (data.qddItemId) {
        await budgetService.assertQddItemBelongsToOrganization(data.qddItemId, organizationId)
        const qddItem = await prisma.qddItem.findUniqueOrThrow({ where: { id: data.qddItemId } })
        qddSnapshot = {
          qddFichaSnapshot: qddItem.ficha,
          qddFonteSnapshot: qddItem.fonte,
          qddNaturezaSnapshot: qddItem.naturezaDespesa,
        }
      }

      const process = await prisma.$transaction(async tx => {
        const created = await tx.virtualProcess.create({
          data: {
            organizationId,
            departmentId: data.departmentId ?? null,
            processNumber: data.processNumber,
            secretaria: data.secretaria,
            source: data.source,
            sourceDetail: data.sourceDetail,
            bankAccount: data.bankAccount,
            agency: data.agency,
            bankName: data.bankName,
            companyCnpj: data.companyCnpj,
            companyName: data.companyName,
            startDate: data.startDate,
            endDate: data.endDate,
            validityDate: data.validityDate,
            totalValue: data.totalValue,
            subject: data.subject,
            category: data.category,
            createdById: userId,
            status: data.status || 'Tramitando',
            qddItemId: data.qddItemId ?? null,
            ...qddSnapshot,
            // Fase oficial da despesa (Épico 8, FR-019) — dimensão adicional
            // ao `status` textual acima, aceita já na autuação.
            expensePhase: data.expensePhase ?? null,
          }
        })

        // Estouro de dotação (Épico 8, FR-011): calculado DEPOIS de gravar,
        // dentro da mesma transação, para que a soma já inclua este processo.
        // Não bloqueia — só registra para auditoria, mesma regra de
        // DailyAllowance.budgetOverrun.
        if (data.qddItemId) {
          const overrun = await budgetService.detectOverrun(tx, data.qddItemId)
          if (overrun) {
            return tx.virtualProcess.update({ where: { id: created.id }, data: { budgetOverrun: true } })
          }
        }

        return created
      })

      await auditLedgerService.record({
        userId,
        action: 'AUTUOU',
        resource: 'VIRTUAL_PROCESS',
        resourceId: process.id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: { newData: process },
      })

      return reply.code(201).send(process)
    } catch (error: any) {
      logger.error(error, 'Failed to create virtual process')
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', details: error.errors })
      }
      // Dotação do QDD inexistente ou de outra organização (Épico 8) — erro de
      // domínio, não falha interna.
      if (error instanceof BudgetError) {
        return reply.code(400).send({ error: error.code, message: error.message })
      }
      return reply.code(500).send({ error: 'Process Creation Failed', message: error.message })
    }
  }

  async toggleStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const { status } = z.object({ status: z.string().min(1) }).parse(request.body)
      const userId = (request as any).user?.id as string

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const oldStatus = process.status
      const updatedProcess = await prisma.virtualProcess.update({ where: { id }, data: { status } })

      await auditLedgerService.record({
        userId,
        action: 'ALTEROU_STATUS',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: { oldData: { status: oldStatus }, newData: { status } },
      })

      return reply.send(updatedProcess)
    } catch (error: any) {
      logger.error(error, 'Failed to update virtual process status')
      return reply.code(500).send({ error: 'Status Update Failed', message: error.message })
    }
  }

  async updateCompanyInfo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = updateCompanyInfoSchema.parse(request.body)
      const userId = (request as any).user?.id as string

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const updatedProcess = await prisma.virtualProcess.update({
        where: { id },
        data: { companyName: data.companyName, companyCnpj: data.companyCnpj }
      })

      await auditLedgerService.record({
        userId,
        action: 'ATUALIZOU_DADOS_EMPRESA',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: {
          oldData: { companyName: process.companyName, companyCnpj: process.companyCnpj },
          newData: { companyName: updatedProcess.companyName, companyCnpj: updatedProcess.companyCnpj },
        },
      })

      return reply.send(updatedProcess)
    } catch (error: any) {
      logger.error(error, 'Failed to update company info')
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', details: error.errors })
      }
      return reply.code(500).send({ error: 'Company Info Update Failed', message: error.message })
    }
  }

  /**
   * PATCH /:id/validity — atualiza prazo de vigência e valor total de um processo
   * já existente. Escopo estreito de propósito (mesmo padrão de /:id/company):
   * um update geral exigiria tratar unicidade de processNumber, o refine de
   * start/endDate e regras de status, sem necessidade para este épico.
   */
  async updateValidity(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = updateValiditySchema.parse(request.body)
      const userId = (request as any).user?.id as string

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      // `undefined` = campo não enviado (não mexer); `null` = remover o valor.
      const updatedProcess = await prisma.virtualProcess.update({
        where: { id },
        data: {
          ...(data.validityDate !== undefined && { validityDate: data.validityDate }),
          ...(data.totalValue   !== undefined && { totalValue: data.totalValue }),
        }
      })

      await auditLedgerService.record({
        userId,
        action: 'ATUALIZOU_VIGENCIA',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: {
          oldData: { validityDate: process.validityDate, totalValue: process.totalValue },
          newData: { validityDate: updatedProcess.validityDate, totalValue: updatedProcess.totalValue },
        },
      })

      return reply.send(updatedProcess)
    } catch (error: any) {
      logger.error(error, 'Failed to update validity')
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', details: error.errors })
      }
      return reply.code(500).send({ error: 'Validity Update Failed', message: error.message })
    }
  }

  /**
   * PATCH /:id/budget — vincula/desvincula o processo de uma ficha do QDD e/ou
   * atualiza sua fase da despesa (Épico 8, FR-011/FR-019). Um único endpoint
   * estreito para as duas dimensões orçamentárias do processo: `qddItemId` e
   * `expensePhase` são independentes — `undefined` não mexe no campo, `null`
   * limpa, um valor define.
   */
  async updateBudget(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = updateBudgetSchema.parse(request.body)
      const userId = (request as any).user?.id as string
      const organizationId = (request as any).user?.organizationId as string

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const isChangingQddItem = data.qddItemId !== undefined
      let qddSnapshot: {
        qddFichaSnapshot: string | null
        qddFonteSnapshot: string | null
        qddNaturezaSnapshot: string | null
      } = { qddFichaSnapshot: null, qddFonteSnapshot: null, qddNaturezaSnapshot: null }

      if (isChangingQddItem && data.qddItemId) {
        await budgetService.assertQddItemBelongsToOrganization(data.qddItemId, process.organizationId)
        const qddItem = await prisma.qddItem.findUniqueOrThrow({ where: { id: data.qddItemId } })
        qddSnapshot = {
          qddFichaSnapshot: qddItem.ficha,
          qddFonteSnapshot: qddItem.fonte,
          qddNaturezaSnapshot: qddItem.naturezaDespesa,
        }
      }

      const updatedProcess = await prisma.$transaction(async tx => {
        const updated = await tx.virtualProcess.update({
          where: { id },
          data: {
            ...(isChangingQddItem
              ? {
                  qddItemId: data.qddItemId,
                  ...qddSnapshot,
                  // Desvincular zera a flag: sem ficha, não há saldo contra o
                  // qual estourar. Vincular recalcula abaixo, na mesma transação.
                  budgetOverrun: false,
                }
              : {}),
            ...(data.expensePhase !== undefined ? { expensePhase: data.expensePhase } : {}),
          },
        })

        if (isChangingQddItem && data.qddItemId) {
          const overrun = await budgetService.detectOverrun(tx, data.qddItemId)
          if (overrun) {
            return tx.virtualProcess.update({ where: { id }, data: { budgetOverrun: true } })
          }
        }

        return updated
      })

      await auditLedgerService.record({
        userId,
        action: 'ATUALIZOU_ORCAMENTO',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: {
          oldData: { qddItemId: process.qddItemId, expensePhase: process.expensePhase },
          newData: { qddItemId: updatedProcess.qddItemId, expensePhase: updatedProcess.expensePhase },
        },
      })

      return reply.send(updatedProcess)
    } catch (error: any) {
      logger.error(error, 'Failed to update virtual process budget link')
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Validation Error', details: error.errors })
      }
      if (error instanceof BudgetError) {
        return reply.code(400).send({ error: error.code, message: error.message })
      }
      return reply.code(500).send({ error: 'Budget Update Failed', message: error.message })
    }
  }

  async deleteProcess(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const userId = (request as any).user?.id as string

      const process = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!process) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && process.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      if ((Date.now() - process.createdAt.getTime()) > 24 * 60 * 60 * 1000) {
        return reply.code(403).send({ error: 'Forbidden', message: 'O prazo de 24 horas para exclusão expirou' })
      }

      await prisma.virtualProcess.delete({ where: { id } })

      await auditLedgerService.record({
        userId,
        action: 'EXCLUIU',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: { oldData: process },
      })

      return reply.code(204).send()
    } catch (error: any) {
      logger.error(error, 'Failed to delete virtual process')
      return reply.code(500).send({ error: 'Process Deletion Failed', message: error.message })
    }
  }

  async uploadDocument(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const userId = (request as any).user?.id as string

      const processObj = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!processObj) return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && processObj.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Processo não encontrado' })
      }

      const parts = request.parts()
      let fileData: any = null
      const fieldsData: any = {}

      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer)
          }
          const buffer = Buffer.concat(chunks)

          // Anexo de processo não validava tipo algum — nem o mimetype declarado.
          assertAllowedFile(buffer, {
            policy: UPLOAD_POLICIES.GENERAL_ATTACHMENT,
            declaredMime: part.mimetype,
            fileName: part.filename,
          })

          const fileKey = await saveFile(buffer, {
            organizationId: processObj.organizationId,
            scope: 'virtual-processes',
            originalName: part.filename,
          })

          fileData = {
            fileName: part.filename,
            fileUrl: fileKey,
            fileSize: buffer.length,
          }
        } else {
          fieldsData[part.fieldname] = part.value
        }
      }

      if (!fileData) return reply.code(400).send({ error: 'Bad Request', message: 'Nenhum arquivo enviado' })

      const validatedFields = uploadDocumentSchema.parse(fieldsData)

      const document = await prisma.virtualProcessDocument.create({
        data: {
          virtualProcessId: id,
          tag: validatedFields.tag,
          description: validatedFields.description,
          fileName: fileData.fileName,
          fileUrl: fileData.fileUrl,
          fileSize: fileData.fileSize,
          uploadedById: userId
        }
      })

      await auditLedgerService.record({
        userId,
        action: 'ANEXOU_DOCUMENTO',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: {
          processId: id,
          documentId: document.id,
          fileName: fileData.fileName,
          description: `Anexou o documento: ${fileData.fileName}`,
        },
      })

      return reply.code(201).send(document)
    } catch (error: any) {
      logger.error(error, 'Failed to upload document')
      return reply.code(500).send({ error: 'Upload Failed', message: error.message })
    }
  }

  async downloadDocument(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, documentId } = request.params as { id: string; documentId: string }
      const userId = (request as any).user?.id as string

      const document = await prisma.virtualProcessDocument.findUnique({ where: { id: documentId } })
      if (document?.virtualProcessId !== id) {
        return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado' })
      }

      const processObj = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!processObj) return reply.code(404).send({ message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && processObj.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ message: 'Processo não encontrado' })
      }

      const signedUrl = getFileUrl(document.fileUrl)

      await auditLedgerService.record({
        userId,
        action: 'BAIXOU_DOCUMENTO',
        resource: 'VIRTUAL_PROCESS_DOCUMENT',
        resourceId: documentId,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: { processId: id },
      })

      return reply.send({ url: signedUrl })
    } catch (error: any) {
      logger.error(error, 'Failed to download document')
      return reply.code(500).send({ error: 'Download Failed', message: error.message })
    }
  }

  async deleteDocument(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, documentId } = request.params as { id: string; documentId: string }
      const userId = (request as any).user?.id as string

      const document = await prisma.virtualProcessDocument.findUnique({ where: { id: documentId } })
      if (document?.virtualProcessId !== id) {
        return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado' })
      }

      const processObj = await prisma.virtualProcess.findUnique({ where: { id } })
      if (!processObj) return reply.code(404).send({ message: 'Processo não encontrado' })

      if (!(request as any).user?.isSuperAdmin && processObj.organizationId !== (request as any).user?.organizationId) {
        return reply.code(404).send({ message: 'Processo não encontrado' })
      }

      if ((Date.now() - document.uploadedAt.getTime()) > 24 * 60 * 60 * 1000) {
        return reply.code(403).send({ error: 'Forbidden', message: 'O prazo de 24 horas para exclusão deste documento expirou' })
      }

      await prisma.virtualProcessDocument.delete({ where: { id: documentId } })

      try {
        await deleteFile(document.fileUrl)
      } catch (_e) {
        // falha ao apagar do disco não impede a exclusão do registro
      }

      await auditLedgerService.record({
        userId,
        action: 'REMOVEU_DOCUMENTO',
        resource: 'VIRTUAL_PROCESS',
        resourceId: id,
        organizationId: (request as any).user?.organizationId ?? null,
        ip: request.ip,
        success: true,
        details: { description: `Removeu o documento: ${document.fileName}`, oldData: document },
      })

      return reply.code(204).send()
    } catch (error: any) {
      logger.error(error, 'Failed to delete document')
      return reply.code(500).send({ error: 'Document Deletion Failed', message: error.message })
    }
  }
}

export const virtualProcessController = new VirtualProcessController()
