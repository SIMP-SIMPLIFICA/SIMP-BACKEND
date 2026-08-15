import { PrismaClient } from '@prisma/client';
import * as argon2 from '@node-rs/argon2';

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({ select: { email: true, id: true } });
    console.log('Existing users:', users);

    if (users.length === 0) {
        console.log('No users found. Creating admin...');
        const passwordHash = await argon2.hash('Admin123!');
        const admin = await prisma.user.create({
            data: {
                email: 'admin@example.com',
                username: 'admin',
                passwordHash,
                firstName: 'Admin',
                lastName: 'System',
                isActive: true,
                isVerified: true,
                roles: {
                    create: {
                        role: {
                            create: {
                                name: 'admin',
                                displayName: 'Administrator',
                                description: 'System administrator with full access',
                                permissions: ['*'],
                                isSystem: true,
                                isActive: true
                            }
                        }
                    }
                }
            }
        });
        console.log('Admin user created successfully:', admin.id);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
