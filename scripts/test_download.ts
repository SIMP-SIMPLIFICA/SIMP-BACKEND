import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

const streamPipeline = promisify(pipeline)
const BASE_URL = 'http://localhost:3000'

async function login(email: string, password: string) {
    console.log(`Logging in as ${email}...`)
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })

    if (!response.ok) {
        throw new Error(`Login failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data.tokens.accessToken
}

async function main() {
    try {
        // 1. Login
        const token = await login('admin@example.com', 'Admin123!@#') // Adjust credentials if needed
        const headers = { 'Authorization': `Bearer ${token}` }

        // 2. Get Sent Documents to find one with attachments
        console.log('Fetching sent documents...')
        const sentRes = await fetch(`${BASE_URL}/api/v1/communication/sent`, { headers })
        const sentList = await sentRes.json()

        if (!Array.isArray(sentList) || sentList.length === 0) {
            console.log('No sent documents found.')
            return
        }

        // Find a doc with attachments
        let targetDoc: any = null
        let targetAtt: any = null

        // Need to fetch details for attachments
        for (const docSummary of sentList) {
            const res = await fetch(`${BASE_URL}/api/v1/communication/documents/${docSummary.id}`, { headers })
            const doc = await res.json()
            if (doc.attachments && doc.attachments.length > 0) {
                targetDoc = doc
                targetAtt = doc.attachments[0]
                break
            }
        }

        if (!targetDoc) {
            console.log('No document with attachments found.')
            return
        }

        console.log(`Found document ${targetDoc.id} with attachment ${targetAtt.id} (${targetAtt.fileName})`)

        // 3. Try to download
        console.log('Attempting download...')
        const downloadUrl = `${BASE_URL}/api/v1/communication/documents/${targetDoc.id}/attachments/${targetAtt.id}/download`

        const downloadRes = await fetch(downloadUrl, { headers })

        if (!downloadRes.ok) {
            const errText = await downloadRes.text()
            throw new Error(`Download failed: ${downloadRes.status} ${errText}`)
        }

        console.log(`Download response status: ${downloadRes.status}`)
        console.log(`Content-Type: ${downloadRes.headers.get('content-type')}`)
        console.log(`Content-Disposition: ${downloadRes.headers.get('content-disposition')}`)

        // 4. Save to file (optional, just ensuring stream works)
        // const fileStream = createWriteStream(`./downloaded_${targetAtt.fileName}`)
        // await streamPipeline(downloadRes.body as any, fileStream)
        // console.log('File saved successfully.')

    } catch (e) {
        console.error('Error:', e)
    }
}

main()
