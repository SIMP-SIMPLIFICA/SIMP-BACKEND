-- Migrate bank_accounts: workspace_id → organization_id
-- Step 1: add nullable column
ALTER TABLE "bank_accounts" ADD COLUMN "organization_id" TEXT;

-- Step 2: fill from workspace → organization
UPDATE "bank_accounts" ba
SET "organization_id" = w."organization_id"
FROM "Workspace" w
WHERE ba."workspaceId" = w.id;

-- Step 3: for any rows where workspace had no org, use first org as fallback
UPDATE "bank_accounts"
SET "organization_id" = (SELECT id FROM "organizations" LIMIT 1)
WHERE "organization_id" IS NULL;

-- Step 4: make NOT NULL and drop old column
ALTER TABLE "bank_accounts" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "bank_accounts" DROP COLUMN "workspaceId";

-- Step 5: add FK
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate finance_categories: workspace_id → organization_id
-- Step 1: add nullable column
ALTER TABLE "finance_categories" ADD COLUMN "organization_id" TEXT;

-- Step 2: fill from workspace → organization
UPDATE "finance_categories" fc
SET "organization_id" = w."organization_id"
FROM "Workspace" w
WHERE fc."workspaceId" = w.id;

-- Step 3: fallback
UPDATE "finance_categories"
SET "organization_id" = (SELECT id FROM "organizations" LIMIT 1)
WHERE "organization_id" IS NULL;

-- Step 4: make NOT NULL and drop old column
ALTER TABLE "finance_categories" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "finance_categories" DROP COLUMN "workspaceId";

-- Step 5: add FK
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: drop old unique constraint and add new one
ALTER TABLE "finance_categories" DROP CONSTRAINT IF EXISTS "finance_categories_workspaceId_name_key";
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_organization_id_name_key"
  UNIQUE ("organization_id", "name");
