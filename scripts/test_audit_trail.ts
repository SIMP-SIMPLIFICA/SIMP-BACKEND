import { format } from 'date-fns'

const BASE_URL = 'http://localhost:3000'

async function login(email: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    if (!response.ok) {
        throw new Error(`Login failed: ${await response.text()}`)
    }
    const data = await response.json()
    // Return both token and user object
    return { token: data.tokens.accessToken, user: data.user }
}

async function main() {
    try {
        console.log('1. Logging in as Admin...')
        const { token, user } = await login('admin@example.com', 'Admin123!@#')
        const headers = { 'Authorization': `Bearer ${token}` }

        console.log('2. Creating Document for Recipient (Self)...')
        // Use logged-in user as recipient
        const recipientUser = user

        if (!recipientUser || !recipientUser.id) throw new Error('Could not get user info from login')

        const createRes = await fetch(`${BASE_URL}/api/v1/communication/documents`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Audit Trail Test Doc',
                content: 'Testing audit trail content',
                documentType: 'MEMORANDO',
                priority: 'MEDIUM',
                recipients: [{ userId: recipientUser.id, role: 'TO' }]
            })
        })
        const draft = await createRes.json()

        if (!createRes.ok) {
            console.error('Draft creation failed', draft)
            throw new Error('Draft creation failed')
        }
        console.log('   Draft created:', draft.id)

        console.log('3. Sending Document...')
        const sendRes = await fetch(`${BASE_URL}/api/v1/communication/documents/${draft.id}/send`, {
            method: 'POST',
            headers
        })
        if (!sendRes.ok) throw new Error('Send failed')
        console.log('   Document Sent')

        console.log('4. Viewing Document (Trigger Read/Sign)...')
        // This simulates the recipient viewing the document
        await fetch(`${BASE_URL}/api/v1/communication/documents/${draft.id}`, { headers })

        console.log('5. Verifying Audit Trail in getById...')
        const docRes = await fetch(`${BASE_URL}/api/v1/communication/documents/${draft.id}`, { headers })
        const docData = await docRes.json()

        if (docData.auditTrail && Array.isArray(docData.auditTrail)) {
            console.log('   [PASS] Audit Trail present with ' + docData.auditTrail.length + ' events')
            docData.auditTrail.forEach((e: any) => console.log(`     - ${e.event}: ${e.description} (${e.timestamp})`))

            // Check for specific events
            const hasCreated = docData.auditTrail.some((e: any) => e.event === 'CREATED')
            const hasSent = docData.auditTrail.some((e: any) => e.event === 'SENT')
            const hasRead = docData.auditTrail.some((e: any) => e.event === 'READ')
            const hasSigned = docData.auditTrail.some((e: any) => e.event === 'SIGNED')

            if (hasCreated && hasSent && hasRead && hasSigned) console.log('   [PASS] All expected events found')
            else console.log('   [FAIL] Missing events. Found:', docData.auditTrail.map((e: any) => e.event))
        } else {
            console.error('   [FAIL] No auditTrail found')
        }

        console.log('6. Verifying Aggregated Status in listSent...')
        const sentRes = await fetch(`${BASE_URL}/api/v1/communication/sent`, { headers })
        const sentList = await sentRes.json()
        const myDoc = sentList.find((d: any) => d.id === draft.id)

        if (myDoc) {
            console.log('   Found document in listSent. AggregatedStatus:', myDoc.aggregatedStatus)
            if (myDoc.aggregatedStatus === 'ASSINADO') console.log('   [PASS] Status is correct (ASSINADO)')
            else console.log('   [FAIL] Status incorrect, expected ASSINADO')
        } else {
            console.error('   [FAIL] Document not found in listSent')
        }

    } catch (e) {
        console.error('Test Failed:', e)
    }
}

main()
