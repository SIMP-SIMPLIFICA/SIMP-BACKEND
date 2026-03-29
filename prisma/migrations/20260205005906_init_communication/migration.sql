-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SENT', 'READ', 'SIGNED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentRole" AS ENUM ('TO', 'CC', 'BCC');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('DIGITAL', 'MANUAL', 'BIOMETRIC');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_documents" (
    "id" TEXT NOT NULL,
    "protocol_number" TEXT,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "original_hash" VARCHAR(128),
    "current_hash" VARCHAR(128),
    "qr_code_hash" VARCHAR(128),
    "created_by" TEXT NOT NULL,
    "department_id" TEXT,

    CONSTRAINT "communication_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_recipients" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "DocumentRole" NOT NULL DEFAULT 'TO',
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_sign" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "read_ip" VARCHAR(45),
    "read_location" VARCHAR(200),
    "read_user_agent" TEXT,
    "read_device_id" VARCHAR(100),

    CONSTRAINT "document_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatures" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "signature_type" "SignatureType" NOT NULL,
    "certificate_data" JSONB,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45),
    "validity_until" TIMESTAMP(3),
    "is_valid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "communication_documents_protocol_number_key" ON "communication_documents"("protocol_number");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "communication_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "communication_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
