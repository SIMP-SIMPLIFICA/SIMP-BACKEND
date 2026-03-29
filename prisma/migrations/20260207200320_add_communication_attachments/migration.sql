-- CreateTable
CREATE TABLE "communication_attachments" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "communication_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
