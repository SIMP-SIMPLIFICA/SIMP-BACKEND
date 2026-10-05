-- AlterTable
ALTER TABLE "fleet_drivers" ADD COLUMN     "registration_number" TEXT,
ADD COLUMN     "updated_by_id" UUID;

-- AlterTable
ALTER TABLE "fleet_vehicles" ADD COLUMN     "updated_by_id" UUID;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Índices únicos parciais (SQL bruto: o Prisma não expressa índice parcial) ───
-- Mesma regra "entre ativos" da migration da TASK 2: o soft-delete libera o
-- valor. Os dois campos são opcionais no banco (obrigatoriedade por
-- vínculo/propriedade fica no service), por isso o IS NOT NULL.

CREATE UNIQUE INDEX "fleet_vehicles_org_asset_tag_active_key"
  ON "fleet_vehicles" ("organization_id", "asset_tag")
  WHERE "deleted_at" IS NULL AND "asset_tag" IS NOT NULL;

CREATE UNIQUE INDEX "fleet_drivers_org_registration_number_active_key"
  ON "fleet_drivers" ("organization_id", "registration_number")
  WHERE "deleted_at" IS NULL AND "registration_number" IS NOT NULL;
