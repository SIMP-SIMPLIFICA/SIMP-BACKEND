import { prisma } from '@/lib/prisma'
import { ProtocolService } from './protocol.service'
import { AuditService } from './audit.service'
import { pdfService } from './pdf.service'
import { signatureService } from './signature.service'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class DocumentService {

    /**
     * Executa o fluxo completo de "Protocolar e Enviar"
     */
    async protocolAndSend(documentId: string, userId: string): Promise<any> {
        const document = await prisma.communicationDocument.findUnique({
            where: { id: documentId },
            include: {
                creator: true,
                recipients: { include: { user: true } },
                signatures: true
            }
        })

        if (!document) throw new Error('Documento não encontrado')
        if (document.status !== 'DRAFT') throw new Error('Documento já enviado')

        // 1. Gera Protocolo
        const protocolNumber = await ProtocolService.generate()

        // 2. Hash Original (Conteúdo + Metadados Essenciais)
        const dataToHash = `${protocolNumber}|${document.title}|${document.content}|${userId}|${new Date().toISOString()}`
        const originalHash = crypto.createHash('sha256').update(dataToHash).digest('hex')

        // 3. Log de Auditoria Inicial (SENT)
        await AuditService.log({
            userId,
            action: 'PROTOCOL_GENERATED',
            resource: 'DOCUMENT',
            resourceId: documentId,
            metadata: { protocol: protocolNumber, hash: originalHash }
        })

        const now = new Date()

        // Atualiza status básico
        await prisma.communicationDocument.update({
            where: { id: documentId },
            data: {
                protocolNumber,
                originalHash,
                status: 'SENT',
                sentAt: now
            }
        })

        // Recupera histórico atualizado
        const historico = await AuditService.getDocumentHistory(documentId)

        // Prepara dados para PDF
        const recipientUser = document.recipients[0]?.user
        const pdfData = {
            numero_oficio: document.documentNumber || protocolNumber,
            data_extenso: now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
            nome_destinatario: recipientUser ? `${recipientUser.firstName} ${recipientUser.lastName}` : "A QUEM INTERESSAR POSSA",
            cargo_destinatario: recipientUser?.jobTitle || "Cargo não informado",
            assunto: document.title,
            lista_paragrafos: [{ texto: document.content }],
            nome_remetente: `${document.creator.firstName} ${document.creator.lastName}`,
            cargo_remetente: document.creator.jobTitle || "Servidor",
            rodape_hash: originalHash,
            qr_code_url: `${process.env.APP_URL}/verify/${originalHash}`,
            cabecalho_livre: (document.metadata as any)?.customHeader,
            data_hora_criacao: now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            historico: historico.map(h => ({
                date: new Date(h.date).toLocaleString('pt-BR'),
                action: h.action,
                action_label: formatActionLabel(h.action),
                user: h.user,
                role: h.role,
                details: h.details ? JSON.stringify(h.details) : ''
            })),
            assinaturas: []
        }

        // Gera PDF Visual
        const pdfBuffer = await pdfService.generate(pdfData)

        // 4. Assina Digitalmente (PAdES com certificado do sistema)
        let finalPdf = pdfBuffer
        try {
            const certPath = path.resolve(__dirname, '../../certs/certificado_sistema.pfx')
            if (fs.existsSync(certPath)) {
                const pfxBuffer = fs.readFileSync(certPath)
                finalPdf = await signatureService.signPdf(pdfBuffer, pfxBuffer, process.env.CERT_PASSWORD || '1234')
            }
        } catch (e) {
            console.error('Erro ao assinar digitalmente:', e)
        }

        // 5. Salva Arquivo
        const uploadDir = path.resolve(__dirname, '../../uploads')
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

        const fileName = `OFICIO_${protocolNumber.replace(/\./g, '')}.pdf`
        const filePath = path.join(uploadDir, fileName)
        fs.writeFileSync(filePath, finalPdf)

        // Atualiza anexo
        await prisma.communicationDocument.update({
            where: { id: documentId },
            data: {
                attachments: {
                    create: {
                        fileName,
                        fileUrl: `/uploads/${fileName}`,
                        fileType: 'application/pdf',
                        fileSize: finalPdf.length
                    }
                }
            }
        })

        return { protocol: protocolNumber, hash: originalHash }
    }

    /**
     * Registra a assinatura de um usuário e regenera o PDF com o novo status
     */
    async sign(documentId: string, userId: string, ipAddress: string): Promise<any> {
        const document = await prisma.communicationDocument.findUnique({
            where: { id: documentId },
            include: {
                creator: true,
                recipients: { include: { user: true } },
                signatures: true,
                attachments: true
            }
        })

        if (!document) throw new Error('Documento não encontrado')

        const isCreator = document.createdBy === userId
        const recipient = document.recipients.find(r => r.userId === userId)

        // Regra de Ouro: Criador tem permissão implícita. Destinatário precisa ter flag canSign.
        const canSignAsCreator = isCreator
        const canSignAsRecipient = recipient && recipient.canSign

        if (!canSignAsCreator && !canSignAsRecipient) {
            // Detalha o erro para debug
            if (recipient && !recipient.canSign) {
                throw new Error('Você está na lista de destinatários, mas não foi marcado para assinar este documento.')
            }
            throw new Error('Usuário não autorizado a assinar este documento. Apenas o criador ou signatários designados podem realizar esta ação.')
        }

        const alreadySigned = document.signatures.some(s => s.userId === userId && s.isValid)
        if (alreadySigned) throw new Error('Documento já assinado por este usuário')

        const now = new Date()
        const signatureHash = crypto.createHash('sha256').update(`${documentId}|${userId}|${now.toISOString()}`).digest('hex').substring(0, 16).toUpperCase()

        // 1. Registra Assinatura
        await prisma.documentSignature.create({
            data: {
                documentId,
                userId,
                signatureType: 'DIGITAL',
                ipAddress,
                isValid: true,
                signedAt: now,
                sealData: { hash: signatureHash }
            }
        })

        if (recipient) {
            await prisma.documentRecipient.update({
                where: { id: recipient.id },
                data: { signedAt: now }
            })
        }

        // 2. Log de Auditoria
        await AuditService.log({
            userId,
            action: 'SIGNED',
            resource: 'DOCUMENT',
            resourceId: documentId,
            metadata: { signatureHash }
        })

        // 3. Regenera o PDF
        const historico = await AuditService.getDocumentHistory(documentId)
        const signatures = await prisma.documentSignature.findMany({
            where: { documentId, isValid: true },
            include: { user: true }
        })

        const visualSignatures = signatures.map(s => ({
            nome: `${s.user.firstName} ${s.user.lastName}`,
            cargo: s.user.jobTitle || "Assinante",
            data: s.signedAt,
            hash: (s.sealData as any)?.hash || "---",
            is_digital: true
        }))

        const recipientUser = document.recipients[0]?.user
        const pdfData = {
            numero_oficio: document.documentNumber || document.protocolNumber || "---",
            data_extenso: (document.sentAt || now).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
            nome_destinatario: recipientUser ? `${recipientUser.firstName} ${recipientUser.lastName}` : "A QUEM INTERESSAR POSSA",
            cargo_destinatario: recipientUser?.jobTitle || "Cargo não informado",
            assunto: document.title,
            lista_paragrafos: [{ texto: document.content }],
            nome_remetente: `${document.creator.firstName} ${document.creator.lastName}`,
            cargo_remetente: document.creator.jobTitle || "Servidor",
            rodape_hash: document.originalHash || "---",
            qr_code_url: `${process.env.APP_URL}/verify/${document.originalHash}`,
            logo_base64: (document.metadata as any)?.logoBase64,
            cabecalho_livre: (document.metadata as any)?.customHeader,
            historico: historico.map(h => ({
                date: new Date(h.date).toLocaleString('pt-BR'),
                action: h.action,
                action_label: formatActionLabel(h.action),
                user: h.user,
                role: h.role,
                details: h.details ? JSON.stringify(h.details) : ''
            })),
            data_hora_criacao: (document.sentAt || now).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            assinaturas: visualSignatures.map(s => ({
                ...s,
                data: new Date(s.data).toLocaleString('pt-BR'),
                cpf_mascarado: "***.***.***-**", // Placeholder, pois User não tem CPF no schema ainda
                ip: "IP Registrado" // Placeholder ou pegar de log
            }))
        }

        const pdfBuffer = await pdfService.generate(pdfData)

        // 4. Assina o novo PDF
        let finalPdf = pdfBuffer
        try {
            const certPath = path.resolve(__dirname, '../../certs/certificado_sistema.pfx')
            if (fs.existsSync(certPath)) {
                const pfxBuffer = fs.readFileSync(certPath)
                finalPdf = await signatureService.signPdf(pdfBuffer, pfxBuffer, process.env.CERT_PASSWORD || '1234')
            }
        } catch (e) {
            console.error('Erro ao assinar PDF regenerado:', e)
        }

        // 5. Substitui Arquivo
        const fileName = document.attachments[0]?.fileName || `OFICIO_${document.protocolNumber?.replace(/\./g, '') || 'SIGNED'}.pdf`
        const uploadDir = path.resolve(__dirname, '../../uploads')
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

        const filePath = path.join(uploadDir, fileName)
        fs.writeFileSync(filePath, finalPdf)

        // Atualiza tamanho do anexo se existir
        const attachment = await prisma.communicationAttachment.findFirst({ where: { documentId } })
        if (attachment) {
            await prisma.communicationAttachment.update({
                where: { id: attachment.id },
                data: { fileSize: finalPdf.length }
            })
        }

        return { message: 'Assinado com sucesso', signatureHash }
    }
}

function formatActionLabel(action: string): string {
    const map: Record<string, string> = {
        'CREATED': 'Documento Criado',
        'PROTOCOL_GENERATED': 'Protocolo Gerado',
        'SENT': 'Enviado para Destinatário',
        'READ': 'Visualizado',
        'SIGNED': 'Assinado Digitalmente',
        'DOCUMENT_VIEWED': 'Visualizado pelo Usuário'
    }
    return map[action] || action
}

export const documentService = new DocumentService()
