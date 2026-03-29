
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🔍 Verifying Recipient Visibility...')

    // 1. Find roles with 'documents:read', 'documents:manage' or 'system:admin'
    // 1. Fetch all active roles and filter in JS to be safe with Json types
    console.log('\nFetching active roles...')
    const allRoles = await prisma.role.findMany({
        where: { isActive: true },
        select: { id: true, name: true, permissions: true, isSystem: true }
    })

    // Filter logic mirroring the controller intent
    const eligibleRoles = allRoles.filter(role => {
        const perms = (role.permissions as unknown as string[]) || []
        if (!Array.isArray(perms)) return false

        if (perms.includes('documents:read')) return true
        if (perms.includes('documents:manage')) return true
        if (perms.includes('system:admin')) return true
        if (role.isSystem && role.name === 'admin') return true

        return false
    })

    // Note: Prisma schema uses String[] for permissions, so 'hasSome' works if it's scalar list. 
    // If it's pure JSON array (as in some setups), we might need array_contains which isn't standard in all prisma versions for scalar lists.
    // Actually, the controller I wrote uses `array_contains: ['documents:read']` which is Raw SQL syntax or specific prisma feature?
    // Wait, my controller code used `{ permissions: { array_contains: ... } }`.
    // Prisma doesn't support `array_contains` on String[] lists directly in `findMany` 'where' clause usually, it supports `has` or `hasSome`.
    // Let's re-verify the controller code I wrote. I wrote: `permissions: { array_contains: ... }`.
    // If that was invalid, the previous `npm run dev` would likely fail at runtime when hitting the endpoint, but not build time if TS validation is loose there?
    // No, `npm run dev` uses `tsx` which type checks.
    // Wait, if I used `array_contains` and it's not in the generated client type, it would error.
    // Let's check schema.prisma to see the type of `permissions`.

    // Assuming it works for now, let's just use Prisma to emulate the query logic to see what users we FIND.

    console.log(`Found ${eligibleRoles.length} eligible roles:`, eligibleRoles.map(r => r.name))

    const roleIds = eligibleRoles.map(r => r.id)

  // Debug: Targeted check for "teste da silva"
  console.log('\n--- DEBUG: TARGETED CHECK ---')
  const targetEmail = 'testesilva@gmail.com'
  const targetUser = await prisma.user.findFirst({
    where: { 
        OR: [
            { email: { contains: 'testesilva', mode: 'insensitive' } },
            { username: { contains: 'teste', mode: 'insensitive' } }
        ]
    },
    include: {
        roles: {
            include: { role: true }
        }
    }
  })

  if (!targetUser) {
    console.error(`❌ Target user '${targetEmail}' regex match NOT FOUND in database!`)
    // List first 5 users to see what's there
    const someUsers = await prisma.user.findMany({ take: 5 })
    console.log('Sample users in DB:', someUsers.map(u => u.email))
  } else {
    console.log(`✅ Found User: ${targetUser.firstName} ${targetUser.lastName} (${targetUser.email})`)
    console.log(`   Active: ${targetUser.isActive}, Verified: ${targetUser.isVerified}`)
    console.log(`   Roles:`)
    targetUser.roles.forEach(ur => {
        console.log(`   - ${ur.role.name} (${ur.role.id})`)
        console.log(`     Permissions: ${JSON.stringify(ur.role.permissions)}`)
        
        // Check eligibility manually
        const perms = (ur.role.permissions as unknown as string[]) || []
        const isEligible = perms.includes('documents:read') || 
                           perms.includes('documents:manage') || 
                           perms.includes('system:admin') ||
                           (ur.role.isSystem && ur.role.name === 'admin');
        console.log(`     -> Eligible? ${isEligible}`)
    })
  }

    const users = await prisma.user.findMany({
        where: {
            isActive: true,
            roles: {
                some: {
                    roleId: { in: roleIds }
                }
            }
        },
        select: {
            username: true,
            email: true,
            roles: {
                select: {
                    role: { select: { name: true } }
                }
            }
        }
    })

    console.log(`\nFound ${users.length} eligible users:`)
    users.forEach(u => {
        console.log(`- ${u.username} (${u.email}) [Roles: ${u.roles.map(ur => ur.role.name).join(', ')}]`)
    })
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
