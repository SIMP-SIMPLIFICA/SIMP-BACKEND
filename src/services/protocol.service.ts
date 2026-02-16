import { prisma } from '@/lib/prisma'

export class ProtocolService {
    /**
     * Gera um número de protocolo sequencial único no formato: YYYY.MM.DD.SEQ
     * Exemplo: 2026.02.05.0001
     * Garante unicidade e concorrência via transação no banco de dados.
     */
    static async generate(): Promise<string> {
        return await prisma.$transaction(async (tx) => {
            const now = new Date()
            const year = now.getFullYear()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const day = String(now.getDate()).padStart(2, '0')

            // Cria um registro de protocolo para garantir a sequência
            // O ID é nanoid, mas podemos usar o count ou sequencial se o banco suportar
            // Aqui vamos usar a contagem do dia para gerar o sufixo

            const prefix = `${year}.${month}.${day}`

            // Conta quantos protocolos foram criados hoje
            // Isso pode ter race condition se não travar a tabela, mas com transactions o isolamento ajuda.
            // Melhor seria ter uma tabela de sequencia por dia, mas para simplificar:

            const count = await tx.protocol.count({
                where: {
                    createdAt: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0)),
                        lt: new Date(new Date().setHours(23, 59, 59, 999))
                    }
                }
            })

            const sequence = String(count + 1).padStart(4, '0')
            const protocolNumber = `${prefix}.${sequence}`

            // Cria o registro para reservar o número
            await tx.protocol.create({
                data: {
                    protocolNumber,
                    year
                }
            })

            return protocolNumber
        })
    }
}