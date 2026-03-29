import { prisma } from '@/lib/prisma'

export interface AuditLogData {
    userId?: string
    action: string
    resource: string
    resourceId?: string
    method?: string
    endpoint?: string
    ipAddress?: string
    userAgent?: string
    oldData?: any
    newData?: any
    metadata?: any
    success?: boolean
    errorMessage?: string
}

export class AuditService {

    /**
     * Registra uma ação no sistema de auditoria imutável
     */
    static async log(data: AuditLogData) {
        try {
            await prisma.auditLog.create({
                data: {
                    userId: data.userId,
                    action: data.action,
                    resource: data.resource,
                    resourceId: data.resourceId,
                    method: data.method,
                    endpoint: data.endpoint,
                    ipAddress: data.ipAddress || 'SYSTEM',
                    userAgent: data.userAgent,
                    oldData: data.oldData ? JSON.parse(JSON.stringify(data.oldData)) : undefined,
                    newData: data.newData ? JSON.parse(JSON.stringify(data.newData)) : undefined,
                    metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
                    success: data.success ?? true,
                    errorMessage: data.errorMessage
                }
            })
        } catch (error) {
            console.error('Falha crítica ao salvar log de auditoria:', error)
            // Não lançamos erro para não parar o fluxo principal, mas logamos no console
        }
    }

    /**
     * Recupera o histórico completo de um documento para a "Última Página"
     */
    static async getDocumentHistory(documentId: string) {
        const logs = await prisma.auditLog.findMany({
            where: {
                resource: 'DOCUMENT',
                resourceId: documentId,
                success: true
            },
            orderBy: {
                createdAt: 'asc'
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        jobTitle: true
                    }
                }
            }
        })

        return logs.map(log => ({
            date: log.createdAt,
            action: log.action, // CREATED, SENT, READ, SIGNED
            user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'Sistema',
            role: log.user?.jobTitle || 'N/A',
            details: log.metadata
        }))
    }
}

export const auditService = new AuditService()
