import { prisma } from '../src/lib/prisma'
import { ProtocolService } from '../src/services/protocol.service'
import { AuditService } from '../src/services/audit.service'

async function main() {
    console.log('--- Iniciando Verificação de Serviços ---')

    // 1. Teste de Protocolo
    try {
        console.log('Gerando protocolo...')
        const protocol = await ProtocolService.generate()
        console.log('Protocolo gerado:', protocol)
    } catch (err) {
        console.error('Erro ao gerar protocolo:', err)
    }

    // 2. Teste de Auditoria
    try {
        console.log('Criando log de auditoria...')
        await AuditService.log({
            action: 'TEST_ACTION',
            resource: 'SYSTEM',
            ipAddress: '127.0.0.1',
            metadata: { teste: true }
        })
        console.log('Log criado com sucesso.')
    } catch (err) {
        console.error('Erro ao criar log:', err)
    }

    console.log('--- Verificação Concluída ---')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
