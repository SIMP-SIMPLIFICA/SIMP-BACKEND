-- AlterTable: add is_active column with default true
ALTER TABLE "departments" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- DropIndex: remove global unique on code (was too broad — different orgs can share the same code)
DROP INDEX IF EXISTS "departments_code_key";

-- CreateIndex: composite unique per (organization_id, code) — each org has its own code namespace
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");
