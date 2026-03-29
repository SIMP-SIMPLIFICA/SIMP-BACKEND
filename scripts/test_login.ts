export { }
const BASE_URL = 'http://localhost:3000'

async function login(email, password) {
    console.log(`Attempting login for ${email}...`)
    try {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })

        console.log(`Response status: ${response.status}`)
        if (!response.ok) {
            const text = await response.text()
            console.error(`Login failed: ${text}`)
            return null
        }

        const data = await response.json()
        console.log('Login successful, token length:', data.accessToken.length)
        return data.accessToken
    } catch (e) {
        console.error('Fetch error:', e)
    }
}

async function main() {
    await login('admin@example.com', 'Admin123!@#')
}

main()
