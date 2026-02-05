
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const email = 'testesilva@gmail.com'
    console.log(`Checking user: ${email}`)

    const user = await prisma.user.findFirst({
        where: { email: { contains: 'testesilva', mode: 'insensitive' } },
        include: {
            roles: {
                include: { role: true }
            }
        }
    })

    if (!user) {
        console.log('User not found in DB.')
        return
    }

    console.log(`User found: ${user.firstName} ${user.lastName} (Active: ${user.isActive})`)

    let authorized = false
    for (const ur of user.roles) {
        const role = ur.role
        const perms = (role.permissions as unknown as string[]) || []
        console.log(`- Role: ${role.name} (Permissions: ${perms.length})`)

        if (perms.includes('documents:read') || perms.includes('documents:manage') || perms.includes('system:admin')) {
            console.log('  ✅ Role has required permissions.')
            authorized = true
        } else {
            console.log('  ❌ Role missing permissions.')
        }
    }

    if (authorized) {
        console.log('\nRESULT: User SHOULD be visible in the list.')
    } else {
        console.log('\nRESULT: User will NOT be visible (missing permissions).')
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect())
