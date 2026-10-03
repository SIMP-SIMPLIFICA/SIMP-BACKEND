-- Baseline do schema (TASK 0, decisão D10 em docs/frotas/decisoes.md).
-- Gerada com: prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- Substitui as 3 migrations antigas, cujo histórico não reexecutava em banco
-- novo (P3006: a segunda recriava organization_modules, já criada pela init).
-- No fim, o SQL que o Prisma não expressa (antes aplicado à mão a partir de prisma/sql/).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('superadmin', 'admin', 'standard_user');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'SENT', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentRole" AS ENUM ('TO', 'CC', 'BCC');

-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "CovenantStatus" AS ENUM ('EM_ANALISE', 'APROVADO', 'EM_EXECUCAO', 'PRESTACAO_CONTAS', 'CONCLUIDO', 'DEVOLVIDO');

-- CreateEnum
CREATE TYPE "OfficialDocumentCategory" AS ENUM ('COMUNICACAO', 'NORMATIVO');

-- CreateEnum
CREATE TYPE "OfficialDocumentNumberingType" AS ENUM ('SEQUENTIAL', 'RANDOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "OfficialDocumentStatus" AS ENUM ('RESERVADO', 'EMITIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CouncilMemberRole" AS ENUM ('PRESIDENTE', 'VICE_PRESIDENTE', 'SECRETARIO', 'MEMBRO_TITULAR', 'MEMBRO_SUPLENTE');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CouncilDocumentType" AS ENUM ('ATA', 'RESOLUCAO', 'CONVOCACAO', 'PARECER', 'OUTROS');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDENTE', 'ASSINADO', 'FALHOU', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "AgendaItemStatus" AS ENUM ('PENDENTE', 'APROVADO_UNANIMIDADE', 'APROVADO_MAIORIA', 'APROVADO_RESSALVAS', 'REPROVADO', 'VISTAS_ADIADO');

-- CreateEnum
CREATE TYPE "SupportType" AS ENUM ('TICKET', 'CHAT');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DailyAllowanceStatus" AS ENUM ('PENDING', 'ISSUED', 'ACCOUNTED');

-- CreateEnum
CREATE TYPE "TransportMeans" AS ENUM ('RODOVIARIO', 'AEREO', 'VEICULO_OFICIAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM ('PROPRIO', 'CONVENIO');

-- CreateEnum
CREATE TYPE "BudgetLawType" AS ENUM ('LOA', 'PPA', 'LDO');

-- CreateEnum
CREATE TYPE "ExpensePhase" AS ENUM ('EMPENHO', 'LIQUIDACAO', 'PAGAMENTO');

-- CreateEnum
CREATE TYPE "HolidayScope" AS ENUM ('NATIONAL', 'STATE', 'MUNICIPAL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "logo_url" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_modules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabled_by_id" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "full_name" TEXT,
    "avatar" TEXT,
    "password" TEXT NOT NULL,
    "verify_token" TEXT,
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "backup_codes" TEXT[],
    "job_title" TEXT,
    "municipality_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'standard_user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "metadata" JSONB,
    "preferences" JSONB,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,
    "auto_clear_days" INTEGER NOT NULL DEFAULT 30,
    "clearance_level" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "permissions" JSONB NOT NULL,
    "parentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "fingerprint" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deviceType" TEXT,
    "deviceName" TEXT,
    "location" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "method" TEXT,
    "endpoint" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "metadata" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revoked_tokens" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "cnpj" TEXT,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,
    "manager_id" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT,
    "department_id" TEXT,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNote" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" UUID NOT NULL,

    CONSTRAINT "TaskNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,
    "link" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_documents" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "communication_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_recipients" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "DocumentRole" NOT NULL DEFAULT 'TO',
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "document_recipients_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agency" TEXT,
    "accountNumber" TEXT,
    "initialBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "department_id" TEXT NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" "FinanceEntryType" NOT NULL DEFAULT 'EXPENSE',
    "categoryId" TEXT,
    "accountId" TEXT,
    "subcategoryName" TEXT,
    "nfeNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "providerDocument" TEXT,
    "empenhoNumber" TEXT,
    "liquidacaoNumber" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "attachmentsStatus" TEXT NOT NULL DEFAULT 'none',
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_attachments" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "uploaderId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_processes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT,
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
    "validity_date" TIMESTAMP(3),
    "total_value" DECIMAL(15,2),
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Tramitando',
    "category" TEXT NOT NULL DEFAULT 'Outros',
    "qdd_item_id" TEXT,
    "qdd_ficha_snapshot" TEXT,
    "qdd_fonte_snapshot" TEXT,
    "qdd_natureza_snapshot" TEXT,
    "budget_overrun" BOOLEAN NOT NULL DEFAULT false,
    "expense_phase" "ExpensePhase",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "virtual_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_process_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_process_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_process_companies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_process_documents" (
    "id" TEXT NOT NULL,
    "virtual_process_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "description" TEXT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_process_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "user_id" UUID NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#fef08a',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_documents" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "access_level" INTEGER NOT NULL DEFAULT 1,
    "text_content" TEXT,
    "uploader_id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category_id" TEXT,
    "covenant_id" TEXT,
    "virtual_process_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "covenant_types" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "covenant_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convenentes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convenentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concedentes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concedentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "covenants" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT,
    "number" TEXT NOT NULL,
    "type_id" TEXT,
    "proponent_id" TEXT,
    "convenente_id" TEXT,
    "concedente_id" TEXT,
    "process_object" TEXT NOT NULL,
    "budgetary_action" TEXT,
    "qdd_item_id" TEXT,
    "qdd_ficha_snapshot" TEXT,
    "qdd_fonte_snapshot" TEXT,
    "qdd_natureza_snapshot" TEXT,
    "execution_start_date" TIMESTAMP(3),
    "validity_start_date" TIMESTAMP(3),
    "validity_end_date" TIMESTAMP(3),
    "term_days" INTEGER,
    "transfer_value" DECIMAL(15,2),
    "counterpart_value" DECIMAL(15,2),
    "status" "CovenantStatus" NOT NULL DEFAULT 'EM_ANALISE',
    "bank_name" TEXT,
    "bank_agency" TEXT,
    "bank_account" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "covenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_controls" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_category" "OfficialDocumentCategory" NOT NULL,
    "document_type" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "department_id" TEXT,
    "year" INTEGER NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequence_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "creator_id" UUID NOT NULL,
    "document_category" "OfficialDocumentCategory" NOT NULL,
    "document_type" TEXT NOT NULL,
    "numbering_type" "OfficialDocumentNumberingType" NOT NULL,
    "sequence_number" INTEGER,
    "year" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "recipient" TEXT,
    "sector" TEXT NOT NULL,
    "department_id" TEXT,
    "status" "OfficialDocumentStatus" NOT NULL DEFAULT 'RESERVADO',
    "cancel_reason" TEXT,
    "library_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "official_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "councils" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acronym" TEXT,
    "description" TEXT,
    "legal_basis" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "councils_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "council_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CouncilMemberRole" NOT NULL DEFAULT 'MEMBRO_TITULAR',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "council_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_meetings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "council_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "status" "MeetingStatus" NOT NULL DEFAULT 'AGENDADA',
    "quorum" INTEGER,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "council_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_agenda_items" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgendaItemStatus" NOT NULL DEFAULT 'PENDENTE',
    "voting_remarks" TEXT,

    CONSTRAINT "meeting_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendance" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "is_present" BOOLEAN NOT NULL DEFAULT false,
    "justified_absence" BOOLEAN,

    CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "document_type" "CouncilDocumentType" NOT NULL DEFAULT 'ATA',
    "title" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "sha256_hash" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "council_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDENTE',
    "pkcs7_data" TEXT,
    "signed_at" TIMESTAMP(3),
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "govbr_oauth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "govbr_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "SupportType" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_allowances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "beneficiary_name" TEXT NOT NULL,
    "beneficiary_cpf" TEXT,
    "beneficiary_registration_number" TEXT,
    "beneficiary_rg" TEXT,
    "beneficiary_rg_issuer" TEXT,
    "beneficiary_job_title" TEXT,
    "beneficiary_lotacao" TEXT,
    "beneficiary_bank_name" TEXT,
    "beneficiary_bank_agency" TEXT,
    "beneficiary_bank_account" TEXT,
    "created_by_id" UUID NOT NULL,
    "department_id" TEXT NOT NULL,
    "qdd_item_id" TEXT,
    "sequence_number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "status" "DailyAllowanceStatus" NOT NULL DEFAULT 'PENDING',
    "budget_overrun" BOOLEAN NOT NULL DEFAULT false,
    "public_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "departure_date" TIMESTAMP(3) NOT NULL,
    "return_date" TIMESTAMP(3) NOT NULL,
    "departure_time" TEXT,
    "arrival_time" TEXT,
    "weekend_holiday_justification" TEXT,
    "transport_means" "TransportMeans",
    "funding_source" "FundingSource",
    "daily_rate" DECIMAL(15,2) NOT NULL,
    "day_count" DECIMAL(5,2) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "sha256_hash" TEXT,
    "issued_at" TIMESTAMP(3),
    "pdf_file_key" TEXT,
    "qdd_ficha_snapshot" TEXT,
    "qdd_fonte_snapshot" TEXT,
    "qdd_natureza_snapshot" TEXT,
    "accountability_date" TIMESTAMP(3),
    "activity_report" TEXT,
    "accountability_ticket_number" TEXT,
    "accountability_event_address" TEXT,
    "accountability_contacts_info" TEXT,
    "accountability_public_id" TEXT,
    "accountability_sha256_hash" TEXT,
    "accountability_pdf_file_key" TEXT,
    "accountability_issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_allowance_receipts" (
    "id" TEXT NOT NULL,
    "daily_allowance_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "payee_name" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_allowance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_fuelings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "department_id" TEXT,
    "license_plate" TEXT NOT NULL,
    "odometer" INTEGER NOT NULL,
    "liters" DECIMAL(10,3) NOT NULL,
    "total_value" DECIMAL(15,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sha256_hash" TEXT,
    "issued_at" TIMESTAMP(3),
    "pdf_file_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_fuelings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "department_id" TEXT,
    "registration_number" TEXT,
    "rg" TEXT,
    "job_title" TEXT,
    "lotacao" TEXT,
    "bank_name" TEXT,
    "bank_agency" TEXT,
    "bank_account" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exported_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "sha256_hash" TEXT NOT NULL,
    "exporter_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exported_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "HolidayScope" NOT NULL DEFAULT 'MUNICIPAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_histories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "qdd_item_id" TEXT NOT NULL,
    "previous_value" DECIMAL(15,2) NOT NULL,
    "new_value" DECIMAL(15,2) NOT NULL,
    "change_percent" DECIMAL(7,2),
    "reason" TEXT NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "council_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "council_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_laws" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "type" "BudgetLawType" NOT NULL,
    "year" INTEGER NOT NULL,
    "law_number" TEXT,
    "published_at" TIMESTAMP(3),
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_laws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qdd_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "ficha" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "projeto_atividade" TEXT NOT NULL,
    "natureza_despesa" TEXT NOT NULL,
    "valor_orcado" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qdd_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DepartmentMembers" (
    "A" TEXT NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_DepartmentMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CovenantToVirtualProcess" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CovenantToVirtualProcess_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_cnpj_key" ON "organizations"("cnpj");

-- CreateIndex
CREATE INDEX "organization_modules_organization_id_idx" ON "organization_modules"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_modules_organization_id_module_key" ON "organization_modules"("organization_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "revoked_tokens_jti_key" ON "revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_jti_idx" ON "revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_expiresAt_idx" ON "revoked_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_department_id_idx" ON "bank_accounts"("organization_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_organization_id_name_key" ON "finance_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "finance_entries_organization_id_occurredAt_idx" ON "finance_entries"("organization_id", "occurredAt");

-- CreateIndex
CREATE INDEX "finance_entries_categoryId_idx" ON "finance_entries"("categoryId");

-- CreateIndex
CREATE INDEX "finance_entries_accountId_idx" ON "finance_entries"("accountId");

-- CreateIndex
CREATE INDEX "finance_attachments_entryId_idx" ON "finance_attachments"("entryId");

-- CreateIndex
CREATE INDEX "virtual_processes_qdd_item_id_idx" ON "virtual_processes"("qdd_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_processes_organization_id_process_number_key" ON "virtual_processes"("organization_id", "process_number");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_process_categories_organization_id_name_key" ON "virtual_process_categories"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_process_sources_organization_id_name_key" ON "virtual_process_sources"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_process_companies_organization_id_name_key" ON "virtual_process_companies"("organization_id", "name");

-- CreateIndex
CREATE INDEX "calendar_events_user_id_start_at_idx" ON "calendar_events"("user_id", "start_at");

-- CreateIndex
CREATE INDEX "notes_user_id_idx" ON "notes"("user_id");

-- CreateIndex
CREATE INDEX "library_documents_organization_id_access_level_idx" ON "library_documents"("organization_id", "access_level");

-- CreateIndex
CREATE INDEX "library_documents_organization_id_deleted_at_idx" ON "library_documents"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "library_documents_uploader_id_idx" ON "library_documents"("uploader_id");

-- CreateIndex
CREATE INDEX "library_documents_category_id_idx" ON "library_documents"("category_id");

-- CreateIndex
CREATE INDEX "library_documents_covenant_id_idx" ON "library_documents"("covenant_id");

-- CreateIndex
CREATE INDEX "library_documents_virtual_process_id_idx" ON "library_documents"("virtual_process_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_organization_id_name_key" ON "document_categories"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "covenant_types_organization_id_name_key" ON "covenant_types"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "convenentes_organization_id_name_key" ON "convenentes"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "concedentes_organization_id_name_key" ON "concedentes"("organization_id", "name");

-- CreateIndex
CREATE INDEX "covenants_organization_id_status_idx" ON "covenants"("organization_id", "status");

-- CreateIndex
CREATE INDEX "covenants_organization_id_type_id_idx" ON "covenants"("organization_id", "type_id");

-- CreateIndex
CREATE INDEX "covenants_qdd_item_id_idx" ON "covenants"("qdd_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "covenants_organization_id_number_key" ON "covenants"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_controls_organization_id_sector_document_type_year_key" ON "sequence_controls"("organization_id", "sector", "document_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "official_documents_library_document_id_key" ON "official_documents"("library_document_id");

-- CreateIndex
CREATE INDEX "official_documents_organization_id_document_category_year_idx" ON "official_documents"("organization_id", "document_category", "year");

-- CreateIndex
CREATE INDEX "official_documents_organization_id_status_idx" ON "official_documents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "councils_organization_id_is_active_idx" ON "councils"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "councils_organization_id_acronym_key" ON "councils"("organization_id", "acronym");

-- CreateIndex
CREATE INDEX "council_memberships_organization_id_idx" ON "council_memberships"("organization_id");

-- CreateIndex
CREATE INDEX "council_memberships_council_id_is_active_idx" ON "council_memberships"("council_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "council_memberships_council_id_user_id_role_key" ON "council_memberships"("council_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "council_meetings_organization_id_scheduled_at_idx" ON "council_meetings"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "council_meetings_council_id_status_idx" ON "council_meetings"("council_id", "status");

-- CreateIndex
CREATE INDEX "meeting_agenda_items_meeting_id_idx" ON "meeting_agenda_items"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_attendance_meeting_id_idx" ON "meeting_attendance"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendance_meeting_id_membership_id_key" ON "meeting_attendance"("meeting_id", "membership_id");

-- CreateIndex
CREATE INDEX "council_documents_organization_id_idx" ON "council_documents"("organization_id");

-- CreateIndex
CREATE INDEX "council_documents_meeting_id_idx" ON "council_documents"("meeting_id");

-- CreateIndex
CREATE INDEX "signature_requests_organization_id_status_idx" ON "signature_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "signature_requests_document_id_idx" ON "signature_requests"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "govbr_oauth_states_state_key" ON "govbr_oauth_states"("state");

-- CreateIndex
CREATE INDEX "govbr_oauth_states_state_idx" ON "govbr_oauth_states"("state");

-- CreateIndex
CREATE INDEX "govbr_oauth_states_expires_at_idx" ON "govbr_oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "support_requests_organization_id_status_idx" ON "support_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "support_requests_author_id_idx" ON "support_requests"("author_id");

-- CreateIndex
CREATE INDEX "support_messages_request_id_created_at_idx" ON "support_messages"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "support_messages_request_id_is_read_idx" ON "support_messages"("request_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "daily_allowances_public_id_key" ON "daily_allowances"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_allowances_accountability_public_id_key" ON "daily_allowances"("accountability_public_id");

-- CreateIndex
CREATE INDEX "daily_allowances_organization_id_departure_date_idx" ON "daily_allowances"("organization_id", "departure_date");

-- CreateIndex
CREATE INDEX "daily_allowances_organization_id_beneficiary_name_idx" ON "daily_allowances"("organization_id", "beneficiary_name");

-- CreateIndex
CREATE INDEX "daily_allowances_qdd_item_id_idx" ON "daily_allowances"("qdd_item_id");

-- CreateIndex
CREATE INDEX "daily_allowances_organization_id_status_return_date_idx" ON "daily_allowances"("organization_id", "status", "return_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_allowances_organization_id_year_sequence_number_key" ON "daily_allowances"("organization_id", "year", "sequence_number");

-- CreateIndex
CREATE INDEX "daily_allowance_receipts_daily_allowance_id_idx" ON "daily_allowance_receipts"("daily_allowance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fuelings_public_id_key" ON "fleet_fuelings"("public_id");

-- CreateIndex
CREATE INDEX "fleet_fuelings_organization_id_date_idx" ON "fleet_fuelings"("organization_id", "date");

-- CreateIndex
CREATE INDEX "fleet_fuelings_department_id_idx" ON "fleet_fuelings"("department_id");

-- CreateIndex
CREATE INDEX "fleet_fuelings_organization_id_license_plate_idx" ON "fleet_fuelings"("organization_id", "license_plate");

-- CreateIndex
CREATE INDEX "beneficiaries_organization_id_idx" ON "beneficiaries"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_name_organization_id_key" ON "beneficiaries"("name", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_cpf_organization_id_key" ON "beneficiaries"("cpf", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "exported_documents_public_id_key" ON "exported_documents"("public_id");

-- CreateIndex
CREATE INDEX "exported_documents_organization_id_created_at_idx" ON "exported_documents"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "exported_documents_organization_id_document_type_idx" ON "exported_documents"("organization_id", "document_type");

-- CreateIndex
CREATE INDEX "holidays_organization_id_date_idx" ON "holidays"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_organization_id_date_key" ON "holidays"("organization_id", "date");

-- CreateIndex
CREATE INDEX "budget_histories_organization_id_qdd_item_id_idx" ON "budget_histories"("organization_id", "qdd_item_id");

-- CreateIndex
CREATE INDEX "council_departments_organization_id_idx" ON "council_departments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "council_departments_council_id_department_id_key" ON "council_departments"("council_id", "department_id");

-- CreateIndex
CREATE INDEX "budget_laws_organization_id_department_id_year_idx" ON "budget_laws"("organization_id", "department_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "budget_laws_department_id_type_year_key" ON "budget_laws"("department_id", "type", "year");

-- CreateIndex
CREATE INDEX "qdd_items_organization_id_year_idx" ON "qdd_items"("organization_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "qdd_items_department_id_year_ficha_key" ON "qdd_items"("department_id", "year", "ficha");

-- CreateIndex
CREATE INDEX "_DepartmentMembers_B_index" ON "_DepartmentMembers"("B");

-- CreateIndex
CREATE INDEX "_CovenantToVirtualProcess_B_index" ON "_CovenantToVirtualProcess"("B");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNote" ADD CONSTRAINT "TaskNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNote" ADD CONSTRAINT "TaskNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_documents" ADD CONSTRAINT "communication_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "communication_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "communication_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "finance_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_processes" ADD CONSTRAINT "virtual_processes_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_process_categories" ADD CONSTRAINT "virtual_process_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_process_sources" ADD CONSTRAINT "virtual_process_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_process_companies" ADD CONSTRAINT "virtual_process_companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_process_documents" ADD CONSTRAINT "virtual_process_documents_virtual_process_id_fkey" FOREIGN KEY ("virtual_process_id") REFERENCES "virtual_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_process_documents" ADD CONSTRAINT "virtual_process_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_attachments" ADD CONSTRAINT "calendar_attachments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_covenant_id_fkey" FOREIGN KEY ("covenant_id") REFERENCES "covenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_virtual_process_id_fkey" FOREIGN KEY ("virtual_process_id") REFERENCES "virtual_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenant_types" ADD CONSTRAINT "covenant_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convenentes" ADD CONSTRAINT "convenentes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concedentes" ADD CONSTRAINT "concedentes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "covenant_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_proponent_id_fkey" FOREIGN KEY ("proponent_id") REFERENCES "virtual_process_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_convenente_id_fkey" FOREIGN KEY ("convenente_id") REFERENCES "convenentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_concedente_id_fkey" FOREIGN KEY ("concedente_id") REFERENCES "concedentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covenants" ADD CONSTRAINT "covenants_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_controls" ADD CONSTRAINT "sequence_controls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_documents" ADD CONSTRAINT "official_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_documents" ADD CONSTRAINT "official_documents_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_documents" ADD CONSTRAINT "official_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_documents" ADD CONSTRAINT "official_documents_library_document_id_fkey" FOREIGN KEY ("library_document_id") REFERENCES "library_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "councils" ADD CONSTRAINT "councils_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_memberships" ADD CONSTRAINT "council_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_memberships" ADD CONSTRAINT "council_memberships_council_id_fkey" FOREIGN KEY ("council_id") REFERENCES "councils"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_memberships" ADD CONSTRAINT "council_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_meetings" ADD CONSTRAINT "council_meetings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_meetings" ADD CONSTRAINT "council_meetings_council_id_fkey" FOREIGN KEY ("council_id") REFERENCES "councils"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_meetings" ADD CONSTRAINT "council_meetings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "council_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "council_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "council_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_documents" ADD CONSTRAINT "council_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_documents" ADD CONSTRAINT "council_documents_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "council_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_documents" ADD CONSTRAINT "council_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "council_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowances" ADD CONSTRAINT "daily_allowances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowances" ADD CONSTRAINT "daily_allowances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowances" ADD CONSTRAINT "daily_allowances_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowances" ADD CONSTRAINT "daily_allowances_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowance_receipts" ADD CONSTRAINT "daily_allowance_receipts_daily_allowance_id_fkey" FOREIGN KEY ("daily_allowance_id") REFERENCES "daily_allowances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exported_documents" ADD CONSTRAINT "exported_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_departments" ADD CONSTRAINT "council_departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_departments" ADD CONSTRAINT "council_departments_council_id_fkey" FOREIGN KEY ("council_id") REFERENCES "councils"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_departments" ADD CONSTRAINT "council_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_laws" ADD CONSTRAINT "budget_laws_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_laws" ADD CONSTRAINT "budget_laws_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qdd_items" ADD CONSTRAINT "qdd_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qdd_items" ADD CONSTRAINT "qdd_items_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentMembers" ADD CONSTRAINT "_DepartmentMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentMembers" ADD CONSTRAINT "_DepartmentMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CovenantToVirtualProcess" ADD CONSTRAINT "_CovenantToVirtualProcess_A_fkey" FOREIGN KEY ("A") REFERENCES "covenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CovenantToVirtualProcess" ADD CONSTRAINT "_CovenantToVirtualProcess_B_fkey" FOREIGN KEY ("B") REFERENCES "virtual_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── prisma/sql/001-unique-normativo-number.sql ─────────────────────────────────────────────

-- Índice único PARCIAL: garante que não existam dois Atos Normativos do MESMO TIPO
-- com o mesmo número e ano dentro da mesma organização (Hotfix, User Story 3 / FR-011).
--
-- Por que parcial (WHERE document_category = 'NORMATIVO'):
--   Documentos de COMUNICACAO legitimamente repetem `sequence_number` entre setores
--   diferentes (cada setor tem sua própria sequência, controlada por sequence_controls).
--   Um índice único total quebraria todo o fluxo de Comunicação existente.
--
-- Por que document_type faz parte da chave:
--   Cada espécie normativa tem sua própria sequência oficial. "Lei nº 001/2026" e
--   "Decreto nº 001/2026" são documentos distintos e coexistem legitimamente — a
--   duplicidade a impedir é dois documentos do MESMO tipo com o mesmo número no
--   mesmo ano (ex: duas "Lei nº 001/2026"). Confirmado contra dados reais do banco,
--   que já continham exatamente esse par Lei/Decreto.
--
-- Por que SQL bruto e não @@unique no schema.prisma:
--   O Prisma não expressa índices únicos parciais de forma declarativa.
--
-- Este arquivo existe porque a migration history do projeto está com drift
-- (a migration 20260408032158 falha no shadow database), então o fluxo em uso é
-- `prisma db push` + SQL aplicado manualmente. Ver docs/TechStack.md §11.
--
-- Aplicação:
--   docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/001-unique-normativo-number.sql

CREATE UNIQUE INDEX IF NOT EXISTS official_documents_normativo_number_unique
  ON official_documents (organization_id, document_type, sequence_number, year)
  WHERE document_category = 'NORMATIVO';

-- ─── prisma/sql/002-immutable-audit.sql ─────────────────────────────────────────────

-- Imutabilidade da trilha de auditoria (Épico 2, Task 2.1)
--
-- Bloqueia UPDATE e DELETE na tabela audit_logs. O registro de auditoria é
-- append-only: uma vez gravado, não pode ser alterado nem removido por ninguém.
--
-- POR QUE UM TRIGGER, E NÃO APENAS REVOKE:
--   A aplicação conecta como `postgres`, que é SUPERUSUÁRIO e DONO da tabela.
--   REVOKE UPDATE/DELETE não tem efeito sobre o dono nem sobre um superusuário —
--   sozinho, seria teatro de segurança. O trigger dispara independentemente do
--   papel, e é ele que efetivamente impede a alteração.
--   O REVOKE no fim é defesa em profundidade: passa a valer no dia em que a
--   aplicação deixar de conectar como superusuário (recomendado para produção).
--
-- COMO REVERTER (exige acesso administrativo deliberado ao banco, que é o ponto):
--   DROP TRIGGER trg_audit_immutable ON audit_logs;
--
-- Aplicação:
--   docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/002-immutable-audit.sql

-- Limpeza da nomenclatura anterior (pt-BR). Roda ANTES de criar a nova: sem
-- isso, um banco que já aplicou a versão antiga ficaria com DOIS triggers
-- ativos sobre a mesma tabela — a proteção continuaria valendo, mas a mensagem
-- de erro viria duplicada e a origem ficaria confusa no diagnóstico.
DROP TRIGGER IF EXISTS trg_auditoria_imutavel ON audit_logs;
DROP FUNCTION IF EXISTS fn_auditoria_imutavel();

CREATE OR REPLACE FUNCTION fn_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Registro de auditoria e imutavel: % nao e permitido na tabela audit_logs (id=%)',
    TG_OP,
    COALESCE(OLD.id, '(desconhecido)')
  USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_audit_immutable();

-- Defesa em profundidade: sem efeito enquanto a app conectar como superusuário,
-- mas já deixa a permissão correta para um papel de aplicação restrito.
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
