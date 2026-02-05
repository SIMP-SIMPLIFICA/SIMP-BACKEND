// import { PrismaClient } from '@prisma/client'

export { }
const BASE_URL = 'http://localhost:3000/api/v1'
// Checking .env usually gives PORT. 
// I'll assume 3333 based on common patterns or I'll check .env first. 
// Actually I'll check .env shortly.

async function login(email: string, password: string) {
    const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Login failed for ${email}: ${response.status} ${text}`)
    }

    const data = await response.json() as any
    return data.accessToken
}

async function main() {
    try {
        console.log('🚀 Starting Verification: Document Tracking & Signatures')

        // 1. Login
        console.log('🔑 Logging in as Admin (Sender)...')
        const adminToken = await login('admin@example.com', 'Admin123!@#')

        console.log('🔑 Logging in as User (Recipient)...')
        const userToken = await login('user@example.com', 'User123!')

        // Get User ID
        const userResponse = await fetch(`${BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${userToken}` } })
        if (!userResponse.ok) throw new Error(`Auth Me failed: ${await userResponse.text()}`)
        const userData = await userResponse.json() as any
        const recipientId = userData.id
        console.log(`👤 Recipient ID: ${recipientId}`)

        // 2. Create Draft (Admin)
        console.log('\n📝 Creating Draft...')
        const draftRes = await fetch(`${BASE_URL}/communication/documents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                title: 'Ofício de Verificação Auto-Assinatura',
                content: 'Este é um documento de teste para verificar a assinatura automática.',
                documentType: 'OFICIO',
                priority: 'HIGH',
                recipients: [
                    { userId: recipientId, role: 'TO' }
                ]
            })
        })

        if (!draftRes.ok) throw new Error(`Create Draft failed: ${await draftRes.text()}`)
        const draft = await draftRes.json() as any
        console.log(`✅ Draft Created: ${draft.id}`)

        // 3. Send Document (Admin)
        console.log('\nUPDATE: Sending Document...')
        const sendRes = await fetch(`${BASE_URL}/communication/documents/${draft.id}/send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` }
        })

        if (!sendRes.ok) throw new Error(`Send failed: ${await sendRes.text()}`)
        const sentDoc = await sendRes.json() as any
        console.log(`✅ Document Sent! Protocol: ${sentDoc.protocol}`)
        console.log(`   Original Hash: ${sentDoc.hash}`)

        // 4. List Sent (Admin)
        console.log('\n📂 Verifying "Sent" List (Admin)...')
        const listSentRes = await fetch(`${BASE_URL}/communication/sent`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        })
        const sentList = await listSentRes.json() as any[]
        const inSentList = sentList.find(d => d.id === draft.id)
        if (!inSentList) throw new Error('Document not found in Sent list!')
        console.log(`✅ Document found in Sent list. Recipient count: ${inSentList._count.recipients}`)

        // 5. List Received (Recipient)
        console.log('\nghunt Verifying "Received" List (Recipient)...')
        const listRecRes = await fetch(`${BASE_URL}/communication/received`, {
            headers: { Authorization: `Bearer ${userToken}` }
        })
        const recList = await listRecRes.json() as any[]
        const inRecList = recList.find(d => d.id === draft.id)
        if (!inRecList) throw new Error('Document not found in Received list!')
        console.log(`✅ Document found in Received list. ReadAt: ${inRecList.recipients[0]?.readAt || 'NULL'}`)

        // 6. View Document (Recipient) -> Trigger Auto-Sign
        console.log('\n👁️  Recipient Viewing Document (Triggering Auto-Sign)...')
        const viewRes = await fetch(`${BASE_URL}/communication/documents/${draft.id}`, {
            headers: { Authorization: `Bearer ${userToken}` }
        })
        if (!viewRes.ok) throw new Error(`View failed: ${await viewRes.text()}`)
        const viewedDoc = await viewRes.json() as any

        // Assertions
        console.log('   Checking signatures...')
        const signatures = viewedDoc.signatures || []
        const userSig = signatures.find((s: any) => s.userId === recipientId)

        if (userSig) {
            console.log(`✅ Signature Found!`)
            console.log(`   Signed At: ${userSig.signedAt}`)
            console.log(`   IP: ${userSig.ipAddress}`)
            console.log(`   Auto-Signed: ${userSig.certificateData?.autoSigned}`)
        } else {
            console.error('❌ Signature NOT found!')
            console.log('Signatures:', JSON.stringify(signatures, null, 2))
            throw new Error('Auto-signing failed')
        }

        console.log('\n✨ VERIFICATION SUCCESSFUL! ✨')

    } catch (error) {
        console.error('\n❌ VERIFICATION FAILED:', error)
        process.exit(1)
    }
}

main()
