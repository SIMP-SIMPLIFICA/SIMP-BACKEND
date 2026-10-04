-- TASK 2 do Simplifica Frotas (docs/frotas/): modelo de dados do módulo.
-- Gerada com migrate diff (migrations -> schema) e revisada à mão: a tabela
-- antiga fleet_fuelings é descartada e recriada (ver DropTable abaixo), e os
-- índices únicos parciais estão no fim do arquivo.

-- CreateEnum
CREATE TYPE "FleetOwnerKind" AS ENUM ('PREFEITURA', 'FUNDO_SAUDE', 'FUNDO_EDUCACAO', 'FUNDO_ASSISTENCIA', 'CAMARA', 'AUTARQUIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "FleetOwnership" AS ENUM ('PROPRIO', 'LOCADO', 'CEDIDO', 'COMODATO');

-- CreateEnum
CREATE TYPE "FleetVehicleType" AS ENUM ('AUTOMOVEL', 'CAMINHONETE', 'CAMIONETA', 'UTILITARIO', 'MOTOCICLETA', 'MICROONIBUS', 'ONIBUS', 'CAMINHAO', 'CAMINHAO_TRATOR', 'REBOQUE', 'MAQUINA', 'OUTRO');

-- CreateEnum
CREATE TYPE "FleetFuelType" AS ENUM ('GASOLINA', 'ETANOL', 'FLEX', 'DIESEL_S10', 'DIESEL_S500', 'GNV', 'ELETRICO', 'HIBRIDO');

-- CreateEnum
CREATE TYPE "FleetWorkRegime" AS ENUM ('PADRAO_8H', 'INTEGRAL_24H');

-- CreateEnum
CREATE TYPE "FleetVehicleStatus" AS ENUM ('EM_USO', 'RESERVA', 'MANUTENCAO', 'ACIDENTADO', 'PARALISADO', 'A_DOAR', 'BAIXADO');

-- CreateEnum
CREATE TYPE "FleetCnhCategory" AS ENUM ('A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE');

-- CreateEnum
CREATE TYPE "FleetCnhStatus" AS ENUM ('REGULAR', 'SUSPENSA', 'CASSADA', 'DESCONHECIDA');

-- CreateEnum
CREATE TYPE "FleetEmploymentKind" AS ENUM ('EFETIVO', 'COMISSIONADO', 'CONTRATADO', 'TERCEIRIZADO');

-- CreateEnum
CREATE TYPE "FleetDocStatus" AS ENUM ('PENDING', 'ISSUED');

-- CreateEnum
CREATE TYPE "FleetAuthLifecycle" AS ENUM ('OPEN', 'IN_USE', 'AWAITING_REVIEW', 'USED', 'CLOSED', 'EXPIRED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FleetRedeemMode" AS ENUM ('MANUAL', 'PHOTO_ONLY');

-- CreateEnum
CREATE TYPE "FleetTripServiceType" AS ENUM ('TRANSPORTE_PACIENTE', 'TRANSPORTE_ESCOLAR', 'ADMINISTRATIVO', 'OBRAS', 'FISCALIZACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "FleetTripStatus" AS ENUM ('SOLICITADA', 'AUTORIZADA', 'EM_CURSO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "FleetServiceOrderKind" AS ENUM ('PREVENTIVA', 'PREDITIVA', 'CORRETIVA', 'ACIDENTE', 'BANCADA', 'REFORMA');

-- CreateEnum
CREATE TYPE "FleetServiceOrderStatus" AS ENUM ('ABERTA', 'ORCADA', 'APROVADA', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "FleetServiceItemType" AS ENUM ('PECA', 'SERVICO', 'PNEU', 'LUBRIFICANTE');

-- CreateEnum
CREATE TYPE "FleetAlertSeverity" AS ENUM ('INFO', 'ALERTA', 'BLOQUEIO');

-- DropTable
-- Esboço antigo de abastecimento (Épico 3). Decisão de 2026-10-03: o único
-- registro existente era dado de teste do dev e é descartado. A tabela é
-- recriada do zero como autorização de abastecimento (TASK 2/3).
DROP TABLE "fleet_fuelings";

-- CreateTable
CREATE TABLE "fleet_fuelings" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "status" "FleetDocStatus" NOT NULL DEFAULT 'PENDING',
    "lifecycle" "FleetAuthLifecycle" NOT NULL DEFAULT 'OPEN',
    "department_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "qdd_item_id" TEXT,
    "qdd_ficha_snapshot" TEXT,
    "qdd_fonte_snapshot" TEXT,
    "qdd_natureza_snapshot" TEXT,
    "fuel_type" "FleetFuelType" NOT NULL,
    "max_volume_l" DECIMAL(10,3) NOT NULL,
    "max_amount" DECIMAL(15,2) NOT NULL,
    "unit_price_cap" DECIMAL(10,4) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "redeem_token_hash" TEXT,
    "plate_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "budget_overrun" BOOLEAN NOT NULL DEFAULT false,
    "cancel_reason" TEXT,
    "pdf_file_key" TEXT,
    "sha256_hash" TEXT,
    "issued_at" TIMESTAMP(3),
    "issued_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_fuelings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_owner_entities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "kind" "FleetOwnerKind" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_owner_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_vehicles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT,
    "owner_entity_id" TEXT,
    "plate" TEXT NOT NULL,
    "renavam" TEXT,
    "chassis" TEXT,
    "make_model" TEXT,
    "manufacture_year" INTEGER,
    "model_year" INTEGER,
    "ownership" "FleetOwnership" NOT NULL,
    "vehicle_type" "FleetVehicleType" NOT NULL,
    "fuel_type" "FleetFuelType" NOT NULL,
    "uses_arla32" BOOLEAN NOT NULL DEFAULT false,
    "tank_capacity_l" DECIMAL(10,3) NOT NULL,
    "reference_km_per_l" DECIMAL(5,2),
    "work_regime" "FleetWorkRegime" NOT NULL DEFAULT 'PADRAO_8H',
    "status" "FleetVehicleStatus" NOT NULL DEFAULT 'EM_USO',
    "odometer_km" INTEGER NOT NULL DEFAULT 0,
    "asset_tag" TEXT,
    "market_value" DECIMAL(15,2),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_drivers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" UUID,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "cpf_encrypted" TEXT NOT NULL,
    "cpf_blind_index" TEXT NOT NULL,
    "cnh_number_encrypted" TEXT NOT NULL,
    "cnh_category" "FleetCnhCategory" NOT NULL,
    "cnh_expiry" DATE NOT NULL,
    "cnh_status" "FleetCnhStatus" NOT NULL DEFAULT 'DESCONHECIDA',
    "special_courses" JSONB,
    "employment_kind" "FleetEmploymentKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "supplier_cnpj" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "fuel_type" "FleetFuelType",
    "unit_price" DECIMAL(10,4),
    "total_amount" DECIMAL(15,2) NOT NULL,
    "max_volume_l" DECIMAL(10,3),
    "commitment_number" TEXT,
    "qdd_item_id" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_fueling_redemptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "fueling_id" TEXT NOT NULL,
    "mode" "FleetRedeemMode" NOT NULL,
    "volume_l" DECIMAL(10,3),
    "unit_price" DECIMAL(10,4),
    "total_amount" DECIMAL(15,2),
    "odometer_km" INTEGER,
    "nfce_key" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_ip" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_fueling_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_receipt_images" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "redemption_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_receipt_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_trips" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "requester_department_id" TEXT NOT NULL,
    "requester_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "service_type" "FleetTripServiceType" NOT NULL,
    "planned_start" TIMESTAMP(3) NOT NULL,
    "planned_end" TIMESTAMP(3) NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "start_odometer" INTEGER,
    "end_odometer" INTEGER,
    "passengers" JSONB,
    "status" "FleetTripStatus" NOT NULL DEFAULT 'SOLICITADA',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_service_orders" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "formatted_number" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "kind" "FleetServiceOrderKind" NOT NULL,
    "workshop_name" TEXT,
    "workshop_cnpj" TEXT,
    "contract_id" TEXT,
    "qdd_item_id" TEXT,
    "qdd_ficha_snapshot" TEXT,
    "qdd_fonte_snapshot" TEXT,
    "qdd_natureza_snapshot" TEXT,
    "opened_at" DATE NOT NULL,
    "closed_at" DATE,
    "odometer_km" INTEGER,
    "diagnosis" TEXT NOT NULL,
    "invoice_number" TEXT,
    "invoice_key" TEXT,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "FleetServiceOrderStatus" NOT NULL DEFAULT 'ABERTA',
    "budget_overrun" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fleet_service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_service_order_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "item_type" "FleetServiceItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "part_code" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price" DECIMAL(10,4) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "warranty_months" INTEGER,
    "warranty_km" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_service_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_quality_alerts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" "FleetAlertSeverity" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_quality_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleet_owner_entities_organization_id_idx" ON "fleet_owner_entities"("organization_id");

-- CreateIndex
CREATE INDEX "fleet_vehicles_organization_id_status_idx" ON "fleet_vehicles"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fleet_vehicles_organization_id_department_id_idx" ON "fleet_vehicles"("organization_id", "department_id");

-- CreateIndex
CREATE INDEX "fleet_drivers_organization_id_active_idx" ON "fleet_drivers"("organization_id", "active");

-- CreateIndex
CREATE INDEX "fleet_contracts_organization_id_end_date_idx" ON "fleet_contracts"("organization_id", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fueling_redemptions_fueling_id_key" ON "fleet_fueling_redemptions"("fueling_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fueling_redemptions_organization_id_nfce_key_key" ON "fleet_fueling_redemptions"("organization_id", "nfce_key");

-- CreateIndex
CREATE INDEX "fleet_receipt_images_redemption_id_idx" ON "fleet_receipt_images"("redemption_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_trips_public_id_key" ON "fleet_trips"("public_id");

-- CreateIndex
CREATE INDEX "fleet_trips_organization_id_status_idx" ON "fleet_trips"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fleet_trips_vehicle_id_start_at_idx" ON "fleet_trips"("vehicle_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_trips_organization_id_year_sequence_number_key" ON "fleet_trips"("organization_id", "year", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_service_orders_public_id_key" ON "fleet_service_orders"("public_id");

-- CreateIndex
CREATE INDEX "fleet_service_orders_organization_id_status_idx" ON "fleet_service_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fleet_service_orders_qdd_item_id_idx" ON "fleet_service_orders"("qdd_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_service_orders_organization_id_year_sequence_number_key" ON "fleet_service_orders"("organization_id", "year", "sequence_number");

-- CreateIndex
CREATE INDEX "fleet_service_order_items_service_order_id_idx" ON "fleet_service_order_items"("service_order_id");

-- CreateIndex
CREATE INDEX "fleet_quality_alerts_organization_id_resolved_at_idx" ON "fleet_quality_alerts"("organization_id", "resolved_at");

-- AddForeignKey
ALTER TABLE "fleet_owner_entities" ADD CONSTRAINT "fleet_owner_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_owner_entities" ADD CONSTRAINT "fleet_owner_entities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_owner_entity_id_fkey" FOREIGN KEY ("owner_entity_id") REFERENCES "fleet_owner_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_contracts" ADD CONSTRAINT "fleet_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_contracts" ADD CONSTRAINT "fleet_contracts_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_contracts" ADD CONSTRAINT "fleet_contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fueling_redemptions" ADD CONSTRAINT "fleet_fueling_redemptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fueling_redemptions" ADD CONSTRAINT "fleet_fueling_redemptions_fueling_id_fkey" FOREIGN KEY ("fueling_id") REFERENCES "fleet_fuelings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fueling_redemptions" ADD CONSTRAINT "fleet_fueling_redemptions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_receipt_images" ADD CONSTRAINT "fleet_receipt_images_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_receipt_images" ADD CONSTRAINT "fleet_receipt_images_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "fleet_fueling_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "fleet_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_requester_department_id_fkey" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_orders" ADD CONSTRAINT "fleet_service_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_orders" ADD CONSTRAINT "fleet_service_orders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_orders" ADD CONSTRAINT "fleet_service_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "fleet_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_orders" ADD CONSTRAINT "fleet_service_orders_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_orders" ADD CONSTRAINT "fleet_service_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_order_items" ADD CONSTRAINT "fleet_service_order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_service_order_items" ADD CONSTRAINT "fleet_service_order_items_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "fleet_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_quality_alerts" ADD CONSTRAINT "fleet_quality_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_quality_alerts" ADD CONSTRAINT "fleet_quality_alerts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_quality_alerts" ADD CONSTRAINT "fleet_quality_alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fuelings_public_id_key" ON "fleet_fuelings"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fuelings_redeem_token_hash_key" ON "fleet_fuelings"("redeem_token_hash");

-- CreateIndex
CREATE INDEX "fleet_fuelings_organization_id_lifecycle_valid_until_idx" ON "fleet_fuelings"("organization_id", "lifecycle", "valid_until");

-- CreateIndex
CREATE INDEX "fleet_fuelings_organization_id_department_id_idx" ON "fleet_fuelings"("organization_id", "department_id");

-- CreateIndex
CREATE INDEX "fleet_fuelings_qdd_item_id_idx" ON "fleet_fuelings"("qdd_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_fuelings_organization_id_year_sequence_number_key" ON "fleet_fuelings"("organization_id", "year", "sequence_number");

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "fleet_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "fleet_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_qdd_item_id_fkey" FOREIGN KEY ("qdd_item_id") REFERENCES "qdd_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_fuelings" ADD CONSTRAINT "fleet_fuelings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Índices únicos parciais (SQL bruto: o Prisma não expressa índice parcial) ───
-- Unicidade "entre ativos" (spec técnica, TASK 2): um registro apagado (soft-delete)
-- libera o valor, porque um veículo doado ou um servidor recontratado pode voltar
-- a existir na mesma organização.

CREATE UNIQUE INDEX "fleet_owner_entities_org_cnpj_active_key"
  ON "fleet_owner_entities" ("organization_id", "cnpj")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "fleet_vehicles_org_plate_active_key"
  ON "fleet_vehicles" ("organization_id", "plate")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "fleet_vehicles_org_renavam_active_key"
  ON "fleet_vehicles" ("organization_id", "renavam")
  WHERE "deleted_at" IS NULL AND "renavam" IS NOT NULL;

CREATE UNIQUE INDEX "fleet_drivers_org_cpf_active_key"
  ON "fleet_drivers" ("organization_id", "cpf_blind_index")
  WHERE "deleted_at" IS NULL;
