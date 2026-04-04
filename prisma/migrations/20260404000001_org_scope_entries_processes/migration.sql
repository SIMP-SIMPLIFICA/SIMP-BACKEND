-- Migration: org_scope_entries_processes
-- Move FinanceEntry, VirtualProcess, VirtualProcessCategory,
-- VirtualProcessSource, VirtualProcessCompany from workspace-scoped to org-scoped

-- ─── 1. finance_entries ───────────────────────────────────────────────────────

-- 1a. Preserve existing R2 paths in finance_attachments BEFORE dropping workspaceId
--     fileUrl stored just the uniqueName; convert to full key so we can still find the file
UPDATE finance_attachments fa
SET "fileUrl" = 'workspaces/' || fe."workspaceId" || '/finance/' || fa."fileUrl"
FROM finance_entries fe
WHERE fa."entryId" = fe.id
  AND fa."fileUrl" NOT LIKE 'workspaces/%'
  AND fa."fileUrl" NOT LIKE 'organizations/%';

-- 1b. Add organization_id (nullable first)
ALTER TABLE finance_entries ADD COLUMN organization_id TEXT;

-- 1c. Fill from workspace → organization
UPDATE finance_entries fe
SET organization_id = w.organization_id
FROM "Workspace" w
WHERE w.id = fe."workspaceId";

-- 1d. Fallback: assign to first org if workspace not found
UPDATE finance_entries
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

-- 1e. Make NOT NULL
ALTER TABLE finance_entries ALTER COLUMN organization_id SET NOT NULL;

-- 1f. Drop old column (cascades FK constraint automatically)
ALTER TABLE finance_entries DROP COLUMN "workspaceId";

-- 1g. Add FK to organizations
ALTER TABLE finance_entries
  ADD CONSTRAINT finance_entries_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- 1h. Update index (drop old, create new)
DROP INDEX IF EXISTS "finance_entries_workspaceId_occurredAt_idx";
CREATE INDEX "finance_entries_organization_id_occurredAt_idx" ON finance_entries(organization_id, "occurredAt");


-- ─── 2. virtual_processes ─────────────────────────────────────────────────────

ALTER TABLE virtual_processes ADD COLUMN organization_id TEXT;

UPDATE virtual_processes vp
SET organization_id = w.organization_id
FROM "Workspace" w
WHERE w.id = vp.workspace_id;

UPDATE virtual_processes
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE virtual_processes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE virtual_processes DROP COLUMN workspace_id;

ALTER TABLE virtual_processes
  ADD CONSTRAINT virtual_processes_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Update unique constraint (drop old, add new)
ALTER TABLE virtual_processes DROP CONSTRAINT IF EXISTS "virtual_processes_workspaceId_processNumber_key";
ALTER TABLE virtual_processes DROP CONSTRAINT IF EXISTS "virtual_processes_workspace_id_process_number_key";
ALTER TABLE virtual_processes
  ADD CONSTRAINT virtual_processes_organization_id_process_number_key
  UNIQUE (organization_id, process_number);


-- ─── 3. virtual_process_categories ───────────────────────────────────────────

ALTER TABLE virtual_process_categories ADD COLUMN organization_id TEXT;

UPDATE virtual_process_categories vpc
SET organization_id = w.organization_id
FROM "Workspace" w
WHERE w.id = vpc.workspace_id;

UPDATE virtual_process_categories
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE virtual_process_categories ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE virtual_process_categories DROP COLUMN workspace_id;

ALTER TABLE virtual_process_categories
  ADD CONSTRAINT virtual_process_categories_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE virtual_process_categories DROP CONSTRAINT IF EXISTS "virtual_process_categories_workspace_id_name_key";
ALTER TABLE virtual_process_categories
  ADD CONSTRAINT virtual_process_categories_organization_id_name_key
  UNIQUE (organization_id, name);


-- ─── 4. virtual_process_sources ──────────────────────────────────────────────

ALTER TABLE virtual_process_sources ADD COLUMN organization_id TEXT;

UPDATE virtual_process_sources vps
SET organization_id = w.organization_id
FROM "Workspace" w
WHERE w.id = vps.workspace_id;

UPDATE virtual_process_sources
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE virtual_process_sources ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE virtual_process_sources DROP COLUMN workspace_id;

ALTER TABLE virtual_process_sources
  ADD CONSTRAINT virtual_process_sources_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE virtual_process_sources DROP CONSTRAINT IF EXISTS "virtual_process_sources_workspace_id_name_key";
ALTER TABLE virtual_process_sources
  ADD CONSTRAINT virtual_process_sources_organization_id_name_key
  UNIQUE (organization_id, name);


-- ─── 5. virtual_process_companies ────────────────────────────────────────────

ALTER TABLE virtual_process_companies ADD COLUMN organization_id TEXT;

UPDATE virtual_process_companies vpc2
SET organization_id = w.organization_id
FROM "Workspace" w
WHERE w.id = vpc2.workspace_id;

UPDATE virtual_process_companies
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE virtual_process_companies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE virtual_process_companies DROP COLUMN workspace_id;

ALTER TABLE virtual_process_companies
  ADD CONSTRAINT virtual_process_companies_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE virtual_process_companies DROP CONSTRAINT IF EXISTS "virtual_process_companies_workspace_id_name_key";
ALTER TABLE virtual_process_companies
  ADD CONSTRAINT virtual_process_companies_organization_id_name_key
  UNIQUE (organization_id, name);
