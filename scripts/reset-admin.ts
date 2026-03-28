import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const prisma = new PrismaClient()

async function main() {
  const newHash = await hash('Admin123!@#', { memoryCost: 65536, timeCost: 3, parallelism: 4 })

  const user = await prisma.user.update({
    where: { email: 'admin@example.com' },
    data: {
      password: newHash,
      firstName: 'Admin',
      lastName: 'User',
      username: 'admin',
      isActive: true,
      isVerified: true,
    },
  })

  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } })
  if (!adminRole) throw new Error('Role admin não encontrada — rode db:seed primeiro')

  const existing = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: adminRole.id },
  })

  if (!existing) {
    await prisma.userRole.create({
      data: { userId: user.id, roleId: adminRole.id, assignedBy: 'system' },
    })
    console.log('✅ Role admin atribuída')
  } else {
    console.log('ℹ️  Role admin já estava atribuída')
  }

  console.log('✅ Admin atualizado: Admin User | admin@example.com | Admin123!@#')
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
