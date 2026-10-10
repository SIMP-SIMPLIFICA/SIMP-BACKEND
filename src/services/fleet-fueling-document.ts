import type { Prisma } from '@prisma/client'
import { createFormDocumentPdf } from '@/services/document-pdf.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { formatCnpj } from '@/utils/cnpj.util.js'
import { resolveChiefName } from '@/utils/department-chief.util.js'
import { FUEL_LABELS, localIsoDate } from '@/utils/fleet-fueling-rules.js'
import { anonymizeName } from '@/utils/lgpd-anonymizer.util.js'

/**
 * PDF da autorização de abastecimento (TASK 3A), pelo motor de formulário
 * existente: grade numerada, assinatura do ordenador e rodapé universal com o
 * QR pequeno de validação. No centro, o QR OPERACIONAL de 5 cm, que abre a tela
 * do frentista.
 *
 * Decisões (D16):
 * - A PLACA NÃO É IMPRESSA. O frentista digita a placa do veículo que está à
 *   frente dele; com a placa no papel, ele poderia copiá-la do papel e o
 *   controle perderia a força. O veículo aparece por modelo, tipo e patrimônio.
 * - Motorista só pelo nome e categoria da CNH: nada de CPF nem nº da CNH.
 * - O token (dentro da URL do QR operacional) só existe neste PDF.
 */

/** 5 cm em pontos (1 cm = 28,3465 pt). */
const OPERATIONAL_QR_SIZE = 142

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  AUTOMOVEL: 'Automóvel',
  CAMINHONETE: 'Caminhonete',
  CAMIONETA: 'Camioneta',
  UTILITARIO: 'Utilitário',
  MOTOCICLETA: 'Motocicleta',
  MICROONIBUS: 'Micro-ônibus',
  ONIBUS: 'Ônibus',
  CAMINHAO: 'Caminhão',
  CAMINHAO_TRATOR: 'Caminhão-trator',
  REBOQUE: 'Reboque',
  MAQUINA: 'Máquina',
  OUTRO: 'Outro',
}

export interface FuelingPdfInput {
  organizationId: string
  organizationName: string
  department: { name: string; code: string; manager: { firstName: string | null; lastName: string | null } | null }
  fueling: {
    publicId: string
    formattedNumber: string | null
    fuelType: string
    maxVolumeL: Prisma.Decimal
    maxAmount: Prisma.Decimal
    unitPriceCap: Prisma.Decimal
    validUntil: Date
    purpose: string
    vehicle: { makeModel: string | null; vehicleType: string; assetTag: string | null }
    driver: { name: string; cnhCategory: string }
    qddItem: { ficha: string; fonte: string; naturezaDespesa: string } | null
  }
  contract: { number: string }
  contractSupplier: { supplierName: string; supplierCnpj: string } | null
  redeemUrl: string
  issuedAt: Date
  /** Nome completo de quem emitiu — vai OFUSCADO para o rodapé. */
  issuerFullName: string
}

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const money = (v: Prisma.Decimal) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const price = (v: Prisma.Decimal) => `R$ ${v.toFixed(4).replace('.', ',')}`
const litres = (v: Prisma.Decimal) => `${v.toFixed(3).replace(/\.?0+$/, '').replace('.', ',')} L`

export async function buildFuelingPdf(input: FuelingPdfInput) {
  const { fueling } = input
  const logoPng = await organizationBrandingService.getLogoBytes(input.organizationId)
  const vehicle = [
    fueling.vehicle.makeModel || 'Modelo não informado',
    VEHICLE_TYPE_LABELS[fueling.vehicle.vehicleType] ?? fueling.vehicle.vehicleType,
  ].join(' · ')

  return createFormDocumentPdf({
    title: `AUTORIZAÇÃO DE ABASTECIMENTO Nº ${fueling.formattedNumber}`,
    organizationName: input.organizationName,
    publicId: fueling.publicId,
    exporterName: anonymizeName(input.issuerFullName),
    logoPng,
    blocks: [
      {
        type: 'grid',
        rows: [
          {
            cells: [
              { number: 1, label: 'Emissão', value: brDate(localIsoDate(input.issuedAt)) },
              { number: 2, label: 'Válida até', value: `${brDate(localIsoDate(fueling.validUntil))}, 23:59` },
              { number: 3, label: 'Departamento (ordenador)', value: input.department.name, span: 2 },
            ],
          },
          {
            cells: [
              { number: 4, label: 'Veículo', value: vehicle, span: 2 },
              { number: 5, label: 'Patrimônio', value: fueling.vehicle.assetTag ?? 'Não tombado' },
            ],
          },
          {
            cells: [
              { number: 6, label: 'Motorista', value: fueling.driver.name, span: 2 },
              { number: 7, label: 'CNH (categoria)', value: fueling.driver.cnhCategory },
            ],
          },
          {
            cells: [
              { number: 8, label: 'Combustível', value: FUEL_LABELS[fueling.fuelType as keyof typeof FUEL_LABELS] ?? fueling.fuelType },
              { number: 9, label: 'Litros (máx.)', value: litres(fueling.maxVolumeL) },
              { number: 10, label: 'Preço unitário (máx.)', value: price(fueling.unitPriceCap) },
              { number: 11, label: 'Valor (máx.)', value: money(fueling.maxAmount) },
            ],
          },
          {
            cells: [
              { number: 12, label: 'Contrato', value: input.contract.number },
              {
                number: 13,
                label: 'Posto (fornecedor)',
                value: input.contractSupplier
                  ? `${input.contractSupplier.supplierName} · CNPJ ${formatCnpj(input.contractSupplier.supplierCnpj)}`
                  : '',
                span: 3,
              },
            ],
          },
          {
            cells: [
              { number: 14, label: 'Ficha', value: fueling.qddItem?.ficha ?? '' },
              { number: 15, label: 'Fonte', value: fueling.qddItem?.fonte ?? '' },
              { number: 16, label: 'Natureza da despesa', value: fueling.qddItem?.naturezaDespesa ?? '', span: 2 },
            ],
          },
          { cells: [{ number: 17, label: 'Finalidade', value: fueling.purpose }] },
        ],
      },
      {
        type: 'qr',
        url: input.redeemUrl,
        sizePt: OPERATIONAL_QR_SIZE,
        heading: 'PARA O POSTO — USO ÚNICO',
        lines: [
          '1. Aponte a câmera do celular para este código.',
          '2. Digite a placa do veículo que está à sua frente (3 tentativas).',
          '3. Informe litros, preço e hodômetro e leia o QR do cupom fiscal.',
          'Não abasteça acima dos limites desta autorização. Depois de usada, ela não vale mais.',
        ],
      },
      {
        type: 'signature',
        name: resolveChiefName(input.department.manager),
        role: `Ordenador de despesa · ${input.department.name}`,
      },
    ],
  })
}
