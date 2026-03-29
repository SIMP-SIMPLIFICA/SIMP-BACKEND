import { prisma } from '../src/lib/prisma'
import { v4 as uuidv4 } from 'uuid'

async function main() {
    console.log('--- TESTE DE DEBUG DE ERRO 500 ---')

    // 1. Identificar Usuário de Teste
    const user = await prisma.user.findFirst()
    if (!user) {
        console.error('Nenhum usuário encontrado.')
        return
    }
    console.log(`Usuário: ${user.id}`)

    // 2. Simular Payload do Frontend
    // O frontend envia `recipients` como array de objetos
    const frontendPayloadRecipients = [
        {
            userId: user.id, // O próprio usuário (Admin)
            role: 'TO',
            canSign: false // Frontend pode mandar false, mas a regra deve sobrescrever
        }
    ]

    // 3. Simular Lógica do Controller
    try {
        console.log('Tentando criar documento...')

        // Emulando o código do controller:
        const userId = user.id
        const recipients = frontendPayloadRecipients

        const finalRecipients = [
            // Garante que o autor seja um signatário
            {
                userId,
                role: 'SIGNER',
                canView: true,
                canSign: true
            },
            // Adiciona os demais destinatários, filtrando para não duplicar o autor
            ...(recipients || [])
                .filter((r: any) => r.userId !== userId)
                .map((recipient: any) => ({
                    userId: recipient.userId,
                    role: recipient.role,
                    canView: true,
                    canSign: recipient.canSign || false
                }))
        ]

        console.log('Recipients processados:', finalRecipients)

        const doc = await prisma.communicationDocument.create({
            data: {
                title: 'Teste Debug 500',
                documentNumber: '123/2026',
                content: 'Teste',
                documentType: 'OFICIO', // Tipo válido
                priority: 'MEDIUM',
                status: 'DRAFT',
                createdBy: userId,
                recipients: {
                    create: finalRecipients
                }
            }
        })
        console.log('Documento criado com sucesso:', doc.id)

    } catch (e: any) {
        console.error('ERRO AO CRIAR:', e)
        if (e.code) console.error('Código Prisma:', e.code)
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
