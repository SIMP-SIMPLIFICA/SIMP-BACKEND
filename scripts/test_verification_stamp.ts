
const BASE_URL = 'http://localhost:3000'

async function login(email: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    if (!response.ok) {
        const text = await response.text()
        console.error('Login failed details:', text, response.status)
        throw new Error('Login failed')
    }
    const data = await response.json()
    return data.tokens.accessToken
}

async function main() {
    try {
        console.log('1. Logging in...')
        const token = await login('admin@example.com', 'Admin123!@#')
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }

        console.log('2. Creating Draft Document...')
        const draftRes = await fetch(`${BASE_URL}/api/v1/communication/documents`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                title: 'Test Verification Stamp',
                content: 'Testing stamp generation content',
                documentType: 'MEMORANDO',
                priority: 'MEDIUM',
                recipients: []
            })
        })
        const draft = await draftRes.json()
        if (!draftRes.ok || !draft.id) {
            console.error('Draft creation failed:', JSON.stringify(draft, null, 2))
            throw new Error('Failed to create draft')
        }
        console.log('   Draft created:', draft.id)

        console.log('3. Sending Document...')
        const sendRes = await fetch(`${BASE_URL}/api/v1/communication/documents/${draft.id}/send`, {
            method: 'POST',
            headers,
            body: '{}'
        })
        const sendData = await sendRes.json()

        console.log('   Checking send response for verification data...')
        if (sendData.document && sendData.document.verification) {
            console.log('   [PASS] Verification data found in SEND response')
            console.log('   Data:', JSON.stringify(sendData.document.verification, null, 2))
        } else {
            console.error('   [FAIL] Verification data MISSING in SEND response')
            console.log(JSON.stringify(sendData, null, 2))
        }

        console.log('4. Fetching Document by ID...')
        const getRes = await fetch(`${BASE_URL}/api/v1/communication/documents/${draft.id}`, {
            headers
        })
        const docData = await getRes.json()

        console.log('   Checking getById response for verification data...')
        if (docData.verification) {
            console.log('   [PASS] Verification data found in GET response')
            console.log('   Data:', JSON.stringify(docData.verification, null, 2))
        } else {
            console.error('   [FAIL] Verification data MISSING in GET response')
        }

    } catch (e) {
        console.error('Test Failed:', e)
    }
}

main()
