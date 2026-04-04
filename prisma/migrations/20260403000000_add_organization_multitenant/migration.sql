-- AlterEnum: remove SIGNED value (Carlos decision: remove digital signature feature)
BEGIN;
CREATE TYPE "DocumentStatus_new" AS ENUM ('DRAFT', 'SENT', 'READ', 'ARCHIVED');
ALTER TABLE "public"."communication_documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "communication_documents" ALTER COLUMN "status" TYPE "DocumentStatus_new" USING ("status"::text::"DocumentStatus_new");
ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
DROP TYPE "public"."DocumentStatus_old";
ALTER TABLE "communication_documents" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey (communication signature/protocol tables)
ALTER TABLE "communication_documents" DROP CONSTRAINT IF EXISTS "communication_documents_department_id_fkey";
ALTER TABLE "communication_documents" DROP CONSTRAINT IF EXISTS "communication_documents_protocol_id_fkey";
ALTER TABLE "document_signatures" DROP CONSTRAINT IF EXISTS "document_signatures_document_id_fkey";
ALTER TABLE "document_signatures" DROP CONSTRAINT IF EXISTS "document_signatures_user_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "communication_documents_protocol_id_key";
DROP INDEX IF EXISTS "communication_documents_protocol_number_key";

-- AlterTable: add organization_id to models
ALTER TABLE "Notification" ADD COLUMN     "organization_id" TEXT;
ALTER TABLE "Workspace" ADD COLUMN     "organization_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN     "organization_id" TEXT;
ALTER TABLE "departments" ADD COLUMN     "organization_id" TEXT;
ALTER TABLE "roles" ADD COLUMN     "organization_id" TEXT;
ALTER TABLE "settings" ADD COLUMN     "organization_id" TEXT;

-- AlterTable: users — add isSuperAdmin + organizationId
ALTER TABLE "users" ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
                    ADD COLUMN     "organization_id" TEXT;

-- AlterTable: communication_documents — remove signature columns, add organizationId
ALTER TABLE "communication_documents"
  DROP COLUMN IF EXISTS "current_hash",
  DROP COLUMN IF EXISTS "delivered_at",
  DROP COLUMN IF EXISTS "department_id",
  DROP COLUMN IF EXISTS "document_number",
  DROP COLUMN IF EXISTS "document_type",
  DROP COLUMN IF EXISTS "metadata",
  DROP COLUMN IF EXISTS "original_hash",
  DROP COLUMN IF EXISTS "page_count",
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "protocol_id",
  DROP COLUMN IF EXISTS "protocol_number",
  DROP COLUMN IF EXISTS "qr_code_hash",
  DROP COLUMN IF EXISTS "signed_at",
  ADD COLUMN     "organization_id" TEXT;

-- AlterTable: document_recipients — remove signature columns
ALTER TABLE "document_recipients"
  DROP COLUMN IF EXISTS "can_sign",
  DROP COLUMN IF EXISTS "read_device_id",
  DROP COLUMN IF EXISTS "read_ip",
  DROP COLUMN IF EXISTS "read_location",
  DROP COLUMN IF EXISTS "read_user_agent",
  DROP COLUMN IF EXISTS "signed_at";

-- AlterTable: finance_entries — re-add accountId (was added via db push)
ALTER TABLE "finance_entries" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

-- DropTable (signature/protocol tables — Carlos decision to remove)
DROP TABLE IF EXISTS "document_signatures";
DROP TABLE IF EXISTS "protocols";

-- DropEnum
DROP TYPE IF EXISTS "SignatureType";

-- CreateTable: organizations
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: bank_accounts
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agency" TEXT,
    "accountNumber" TEXT,
    "initialBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: finance_attachments
CREATE TABLE "finance_attachments" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: virtual_processes
CREATE TABLE "virtual_processes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "process_number" TEXT NOT NULL,
    "secretaria" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_detail" TEXT,
    "bank_account" TEXT,
    "agency" TEXT,
    "bank_name" TEXT,
    "company_cnpj" TEXT,
    "company_name" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Tramitando',
    "category" TEXT NOT NULL DEFAULT 'Outros',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "virtual_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: virtual_process_categories
CREATE TABLE "virtual_process_categories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: virtual_process_sources
CREATE TABLE "virtual_process_sources" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable: virtual_process_companies
CREATE TABLE "virtual_process_companies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable: virtual_process_documents
CREATE TABLE "virtual_process_documents" (
    "id" TEXT NOT NULL,
    "virtual_process_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "description" TEXT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: calendar_events
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: calendar_attachments
CREATE TABLE "calendar_attachments" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: notes
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#fef08a',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organizations_cnpj_key" ON "organizations"("cnpj");
CREATE INDEX "finance_attachments_entryId_idx" ON "finance_attachments"("entryId");
CREATE UNIQUE INDEX "virtual_processes_workspace_id_process_number_key" ON "virtual_processes"("workspace_id", "process_number");
CREATE UNIQUE INDEX "virtual_process_categories_workspace_id_name_key" ON "virtual_process_categories"("workspace_id", "name");
CREATE UNIQUE INDEX "virtual_process_sources_workspace_id_name_key" ON "virtual_process_sources"("workspace_id", "name");
CREATE UNIQUE INDEX "virtual_process_companies_workspace_id_name_key" ON "virtual_process_companies"("workspace_id", "name");
CREATE INDEX "calendar_events_user_id_start_at_idx" ON "calendar_events"("user_id", "start_at");
CREATE INDEX "notes_user_id_idx" ON "notes"("user_id");
CREATE INDEX "finance_entries_accountId_idx" ON "finance_entries"("accountId");

-- AddForeignKey: organizations
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: finance
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "finance_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: virtual processes
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "virtual_process_categories" ADD CONSTRAINT "virtual_process_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtual_process_sources" ADD CONSTRAINT "virtual_process_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtual_process_companies" ADD CONSTRAINT "virtual_process_companies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtual_process_documents" ADD CONSTRAINT "virtual_process_documents_virtual_process_id_fkey" FOREIGN KEY ("virtual_process_id") REFERENCES "virtual_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "virtual_process_documents" ADD CONSTRAINT "virtual_process_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: calendar
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_attachments" ADD CONSTRAINT "calendar_attachments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notes
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
