import { PrismaClient } from '@prisma/client';
import { DocumentService } from './src/services/document.service.js';

const prisma = new PrismaClient();
const documentService = new DocumentService();

async function run() {
    try {
        const doc = await prisma.communicationDocument.findFirst({
            where: { status: { not: 'DRAFT' } },
            orderBy: { createdAt: 'desc' },
            include: { creator: true }
        });

        if (!doc) {
            console.log("No non-draft documents found.");
            return;
        }
        console.log("Testing sign() on doc:", doc.id);

        await documentService.sign(doc.id, doc.creator.id, '127.0.0.1');

        console.log("Sign() completed successfully.");
    } catch (e) {
        console.error("Sign() failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}
run();
