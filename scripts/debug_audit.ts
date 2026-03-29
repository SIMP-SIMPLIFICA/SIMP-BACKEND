const BASE_URL = 'http://localhost:3000'

async function login(email: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    const data = await response.json()
    return data.tokens.accessToken
}

async function main() {
    try {
        console.log('Logging in...')
        const token = await login('admin@example.com', 'Admin123!@#')
        const headers = { 'Authorization': `Bearer ${token}` }

        console.log('Fetching /sent list...')
        const sentRes = await fetch(`${BASE_URL}/api/v1/communication/sent`, { headers })
        const sentList = await sentRes.json()

        if (!Array.isArray(sentList) || sentList.length === 0) {
            console.log('No sent documents found')
            return
        }

        // Assuming sorted by sentAt desc, so first is latest
        const latestDoc = sentList[0]
        console.log('Latest Document ID:', latestDoc.id)
        console.log('Aggregated Status:', latestDoc.aggregatedStatus)

        console.log(`Fetching Doc ${latestDoc.id}...`)
        const res = await fetch(`${BASE_URL}/api/v1/communication/documents/${latestDoc.id}`, { headers })
        const doc = await res.json()

        if (doc.auditTrail) {
            console.log('Audit Trail Events:', doc.auditTrail.length)
            doc.auditTrail.forEach((e: any) => console.log(` - ${e.event}: ${e.description}`))
        } else {
            console.log('No auditTrail found')
        }

    } catch (e) {
        console.error(e)
    }
}

main()
