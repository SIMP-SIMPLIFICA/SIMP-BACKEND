-- AlterTable
ALTER TABLE "fleet_fuelings" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" UUID,
ALTER COLUMN "sequence_number" DROP NOT NULL,
ALTER COLUMN "year" DROP NOT NULL,
ALTER COLUMN "formatted_number" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Ajustes manuais (TASK 3A) ───────────────────────────────────────────────

-- Nº do contrato único entre ativos da organização (o soft-delete libera o
-- número). Índice parcial: o Prisma não o expressa no schema.
CREATE UNIQUE INDEX "fleet_contracts_org_number_active_key"
  ON "fleet_contracts" ("organization_id", "number")
  WHERE "deleted_at" IS NULL;

-- Defesa no banco das regras do service: autorização emitida sempre tem
-- número e hash do PDF; cancelada sempre tem motivo.
ALTER TABLE "fleet_fuelings"
  ADD CONSTRAINT "fleet_fuelings_issued_complete_check"
  CHECK ("status" <> 'ISSUED' OR ("sequence_number" IS NOT NULL AND "sha256_hash" IS NOT NULL AND "pdf_file_key" IS NOT NULL));

ALTER TABLE "fleet_fuelings"
  ADD CONSTRAINT "fleet_fuelings_cancel_reason_check"
  CHECK ("lifecycle" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL);
