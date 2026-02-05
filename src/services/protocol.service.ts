import { prisma } from '@/lib/prisma'

export class ProtocolService {
    /**
     * Gera um número de protocolo no formato: YYYYMMDD-SEQUENCIA
     * Exemplo: 20260205-0001
     */
    static async generate(): Promise<string> {
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')

        // Prefixo do dia: 20260205
        const prefix = `${year}${month}${day}`

        // Conta quantos documentos JÁ TÊM protocolo gerado hoje
        const count = await prisma.communicationDocument.count({
            where: {
                protocolNumber: {
                    startsWith: prefix
                }
            }
        })

        // Gera a sequência (ex: 0001, 0002)
        const sequence = String(count + 1).padStart(4, '0')

        return `${prefix}-${sequence}`
    }
}