import { prisma } from '../src/lib/prisma'
import { documentService } from '../src/services/document.service'
import { ProtocolService } from '../src/services/protocol.service'

async function main() {
    console.log('--- INICIANDO TESTE DE WORKFLOW COMPLETO ---')

    // 1. Identificar Usuário de Teste (Admin)
    const user = await prisma.user.findFirst({
        include: { roles: true }
    })

    if (!user) {
        console.error('Nenhum usuário encontrado no banco. Rode as seeds primeiro.')
        return
    }

    console.log(`Usuário de teste: ${user.firstName} (${user.id})`)

    // 2. Criar Documento (Rascunho) via Prisma direto
    console.log('2. Criando Rascunho...')
    const draft = await prisma.communicationDocument.create({
        data: {
            title: 'Documento de Teste Automatizado',
            content: 'Este é um documento de teste para verificar a geração de protocolo, assinatura e histórico auditável.',
            documentType: 'OFÍCIO',
            status: 'DRAFT',
            createdBy: user.id,
            recipients: {
                create: {
                    userId: user.id, // Envia para si mesmo para poder assinar
                    role: 'TO',
                    canSign: true
                }
            }
        }
    })
    console.log(`Rascunho criado ID: ${draft.id}`)

    // 3. Protocolar e Enviar
    console.log('3. Protocolando e Enviando...')
    // Precisamos regenerar o cliente prisma para usar o ProtocolService corretamente se ele depender do modelo Protocol
    // Se falhar aqui, é porque o cliente não foi atualizado.
    try {
        const result = await documentService.protocolAndSend(draft.id, user.id)
        console.log('Documento enviado!', result)
    } catch (e: any) {
        console.error('Erro ao enviar:', e.message)
        return
    }

    // 4. Assinar
    console.log('4. Assinando Documento...')
    try {
        const signResult = await documentService.sign(draft.id, user.id, '127.0.0.1')
        console.log('Documento assinado!', signResult)
    } catch (e: any) {
        console.error('Erro ao assinar:', e.message)
        return
    }

    // 5. Verificar Histórico
    console.log('5. Verificando Banco de Dados...')
    const docFinal = await prisma.communicationDocument.findUnique({
        where: { id: draft.id },
        include: {
            signatures: true,
            recipients: true,
            attachments: true
        }
    })

    console.log('Status Final:', docFinal?.status) // Deve estar SENT (ou SIGNED se implementássemos mudança de status)
    console.log('Hash Original:', docFinal?.originalHash)
    console.log('Assinaturas:', docFinal?.signatures.length)
    console.log('Anexo Final:', docFinal?.attachments[0]?.fileUrl)

    console.log('--- TESTE CONCLUÍDO ---')
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
