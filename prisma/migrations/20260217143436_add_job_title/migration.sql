/*
  Warnings:

  - A unique constraint covering the columns `[protocol_id]` on the table `communication_documents` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "communication_documents" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "page_count" INTEGER DEFAULT 1,
ADD COLUMN     "protocol_id" TEXT;

-- AlterTable
ALTER TABLE "document_signatures" ADD COLUMN     "seal_data" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "job_title" TEXT;

-- CreateTable
CREATE TABLE "protocols" (
    "id" TEXT NOT NULL,
    "protocol_number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "protocols_protocol_number_key" ON "protocols"("protocol_number");

-- CreateIndex
CREATE UNIQUE INDEX "communication_documents_protocol_id_key" ON "communication_documents"("protocol_id");

-- AddForeignKey
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE SET NULL ON UPDATE CASCADE;
