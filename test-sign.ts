const { PrismaClient } = require('@prisma/client');
const { DocumentService } = require('./src/services/document.service');

const prisma = new PrismaClient();
const documentService = new DocumentService();

async function run() {
    try {
        // Obter o último documento
        const doc = await prisma.communicationDocument.findFirst({
            orderBy: { createdAt: 'desc' },
            include: { creator: true, recipients: true }
        });

        if (!doc) {
            console.log("No documents found.");
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
