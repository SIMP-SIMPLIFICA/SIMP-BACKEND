import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const userCount = await prisma.user.count();
    const workspaceCount = await prisma.workspace.count();
    const entryCount = await prisma.financeEntry.count();

    console.log('Database Status:');
    console.log(`Users: ${userCount}`);
    console.log(`Workspaces: ${workspaceCount}`);
    console.log(`Finance Entries: ${entryCount}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
