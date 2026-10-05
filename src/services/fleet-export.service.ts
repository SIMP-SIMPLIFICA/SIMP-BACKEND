import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { auditLedgerService } from '@/services/audit-ledger.service.js'
import {
  type PdfField,
  type ReportColumn,
  type ReportRowHighlight,
  type ReportSignature,
  createSectionedReportPdf,
  createTabularReportPdf,
} from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { DRIVER_SELECT, driverListWhere, fleetDriverService, toPublicDriver } from '@/services/fleet-driver.service.js'
import { FleetError } from '@/services/fleet-error.js'
import { fleetPiiService } from '@/services/fleet-pii.service.js'
import type { FleetScope } from '@/services/fleet-scope.service.js'
import { VEHICLE_SELECT, fleetVehicleService, toPublicVehicle, vehicleListWhere } from '@/services/fleet-vehicle.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import type { ExportDriversBody, ExportVehiclesBody } from '@/schemas/fleet.schemas.js'
import { type FleetUserRef, USER_REF_SELECT, toUserRef } from '@/utils/fleet-user-ref.js'
import { anonymizeName } from '@/utils/lgpd-anonymizer.util.js'

/**
 * PDFs autenticados do Simplifica Frotas: relação da frota, relação de
 * motoristas e as fichas individuais.
 *
 * Saem pelo MOTOR UNIVERSAL (document-pdf.service, D9) — QR Code, hash SHA-256 e
 * registro em ExportedDocument. Este arquivo só monta linhas e seções.
 *
 * Regras:
 * - Escopo de departamento e filtros da tela: os mesmos `where` da listagem.
 * - CPF e CNH só MASCARADOS — o PDF circula impresso e anexado a processo.
 * - Rodapé padrão em todas as páginas (nome de quem exportou OFUSCADO); o nome
 *   completo e o cargo do responsável vão num bloco na última página.
 * - Registro do documento e auditoria na MESMA transação (D3).
 */

/** Teto de linhas por PDF: acima disso o arquivo deixa de ser legível e a geração pesa no servidor. */
export const MAX_EXPORT_ROWS = 2000

export interface FleetExportResult {
  bytes: Uint8Array
  publicId: string
  fileName: string
}

// ─── Rótulos (os mesmos da tela) ─────────────────────────────────────────────

const OWNERSHIP: Record<string, string> = { PROPRIO: 'Próprio', LOCADO: 'Locado', CEDIDO: 'Cedido', COMODATO: 'Comodato' }
const VEHICLE_TYPE: Record<string, string> = {
  AUTOMOVEL: 'Automóvel', CAMINHONETE: 'Caminhonete', CAMIONETA: 'Camioneta', UTILITARIO: 'Utilitário',
  MOTOCICLETA: 'Motocicleta', MICROONIBUS: 'Micro-ônibus', ONIBUS: 'Ônibus', CAMINHAO: 'Caminhão',
  CAMINHAO_TRATOR: 'Caminhão-trator', REBOQUE: 'Reboque', MAQUINA: 'Máquina', OUTRO: 'Outro',
}
const FUEL: Record<string, string> = {
  GASOLINA: 'Gasolina', ETANOL: 'Etanol', FLEX: 'Flex', DIESEL_S10: 'Diesel S10', DIESEL_S500: 'Diesel S500',
  GNV: 'GNV', ELETRICO: 'Elétrico', HIBRIDO: 'Híbrido',
}
const VEHICLE_STATUS: Record<string, string> = {
  EM_USO: 'Em uso', RESERVA: 'Reserva', MANUTENCAO: 'Em manutenção', ACIDENTADO: 'Acidentado',
  PARALISADO: 'Paralisado', A_DOAR: 'A doar', BAIXADO: 'Baixado',
}
const WORK_REGIME: Record<string, string> = { PADRAO_8H: 'Padrão (8h)', INTEGRAL_24H: 'Integral (24h)' }
const CNH_STATUS: Record<string, string> = {
  REGULAR: 'Regular', SUSPENSA: 'Suspensa', CASSADA: 'Cassada', DESCONHECIDA: 'Não verificada',
}
const EMPLOYMENT: Record<string, string> = {
  EFETIVO: 'Efetivo', COMISSIONADO: 'Comissionado', CONTRATADO: 'Contratado', TERCEIRIZADO: 'Terceirizado',
}

const GENERAL_FLEET = 'Frota geral'
const DASH = '—'

// ─── Formatação ──────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo'

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(value)
}

/** Data "de calendário" (YYYY-MM-DD) sem passar por fuso. */
function formatIsoDate(value: string): string {
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

function formatPlate(plate: string): string {
  // Placa antiga (ABC1234) ganha hífen; Mercosul (ABC1D23) fica como está.
  return /^[A-Z]{3}\d{4}$/.test(plate) ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate
}

function formatNumber(value: { toString(): string } | number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return DASH
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 }).format(Number(value))
}

function formatCurrency(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return DASH
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

function authorLine(at: Date, by: FleetUserRef | null): string {
  return by ? `${formatDateTime(at)} por ${by.name}` : formatDateTime(at)
}

/** "Automóvel: 3 · Caminhonete: 2", em ordem decrescente de quantidade. */
function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  if (counts.size === 0) return DASH
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([label, n]) => `${label}: ${n}`)
    .join(' · ')
}

/** Hoje no fuso da prefeitura, como YYYY-MM-DD. */
function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/**
 * Situação da validade da CNH para destaque: vencida, vencendo em até 30
 * dias, ou em dia. Exportada para teste.
 */
export function cnhExpiryAlert(
  expiryIso: string,
  today = todayIso()
): { level: ReportRowHighlight | null; label: string; daysLeft: number } {
  const days = Math.round((Date.parse(`${expiryIso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (days < 0) return { level: 'alert', label: 'VENCIDA', daysLeft: days }
  if (days === 0) return { level: 'warning', label: 'VENCE HOJE', daysLeft: days }
  if (days <= 30) return { level: 'warning', label: `VENCE EM ${days} ${days === 1 ? 'DIA' : 'DIAS'}`, daysLeft: days }
  return { level: null, label: 'Em dia', daysLeft: days }
}

// ─── Emissão comum ───────────────────────────────────────────────────────────

interface Issuer {
  organizationName: string
  logoPng: Uint8Array | undefined
  exporterFullName: string
  signature: ReportSignature
}

async function loadIssuer(scope: FleetScope): Promise<Issuer> {
  const [organization, user, logoPng] = await Promise.all([
    prisma.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: scope.userId }, select: { ...USER_REF_SELECT, jobTitle: true } }),
    organizationBrandingService.getLogoBytes(scope.organizationId),
  ])
  const fullName = toUserRef(user)?.name ?? 'Usuário sem nome'
  return {
    organizationName: organization?.name ?? 'Organização',
    logoPng,
    exporterFullName: fullName,
    // Nome COMPLETO e cargo de propósito (ver ReportSignature): responsável
    // pela emissão responde pelo documento. O rodapé de toda página continua
    // com o nome ofuscado, que é o metadado consultável no portal público.
    signature: { name: fullName, role: user?.jobTitle?.trim() || 'Responsável pela emissão' },
  }
}

/** Registra o documento e audita, juntos (D3). */
async function finalize(
  scope: FleetScope,
  args: {
    documentType: string
    publicId: string
    bytes: Uint8Array
    issuer: Issuer
    action: string
    resource: 'FLEET_VEHICLE' | 'FLEET_DRIVER'
    resourceId: string | null
    details: Prisma.InputJsonObject
  }
) {
  await prisma.$transaction(async tx => {
    await exportedDocumentService.registerInTransaction(
      {
        organizationId: scope.organizationId,
        documentType: args.documentType,
        publicId: args.publicId,
        bytes: args.bytes,
        exporterFullName: args.issuer.exporterFullName,
      },
      tx
    )
    await auditLedgerService.record(
      {
        userId: scope.userId,
        organizationId: scope.organizationId,
        ip: scope.ip,
        userAgent: scope.userAgent ?? null,
        resource: args.resource,
        action: args.action,
        resourceId: args.resourceId,
        details: { ...args.details, publicId: args.publicId, documentType: args.documentType },
      },
      tx
    )
  })
}

function assertExportSize(total: number, noun: string) {
  if (total > MAX_EXPORT_ROWS) {
    throw new FleetError(
      'EXPORT_TOO_LARGE',
      `A relação tem ${total} ${noun}; o limite por PDF é ${MAX_EXPORT_ROWS}. Filtre por departamento ou situação e exporte em partes.`,
      { total, max: MAX_EXPORT_ROWS }
    )
  }
}

const HISTORY_SECTION = {
  heading: 'Histórico',
  columns: [
    { header: 'Data', width: 80 },
    { header: 'Tipo', width: 110 },
    { header: 'Descrição', width: 305 },
  ] satisfies ReportColumn[],
  rows: [] as string[][],
  emptyMessage: 'Abastecimentos, viagens e manutenções aparecerão aqui quando esses registros existirem no SIMP.',
}

// ─── Relação da frota ────────────────────────────────────────────────────────

/**
 * Paisagem, 12 colunas (741 pt de área útil). Larguras medidas para que o
 * rótulo mais longo de cada coluna caiba sem "..." (o motor corta em
 * `width - 8`): "Em manutenção", "Caminhão-trator", "9.999.999 km".
 * Chassi, consumo de referência, regime, ARLA, valor de mercado e entidade
 * proprietária ficam só na ficha do veículo: na relação não caberiam legíveis.
 */
const VEHICLE_LIST_COLUMNS: ReportColumn[] = [
  { header: 'Placa', width: 48 },
  { header: 'Patrimônio', width: 58 },
  { header: 'Marca/modelo', width: 86 },
  { header: 'Fab./Mod.', width: 50 },
  { header: 'Tipo', width: 70 },
  { header: 'Combustível', width: 66 },
  { header: 'Posse', width: 50 },
  { header: 'Renavam', width: 60 },
  { header: 'Tanque', width: 44, align: 'right' },
  { header: 'Hodômetro', width: 62, align: 'right' },
  { header: 'Departamento', width: 77 },
  { header: 'Situação', width: 70 },
]

function years(manufacture: number | null, model: number | null): string {
  if (!manufacture && !model) return DASH
  return `${manufacture ?? DASH}/${model ?? DASH}`
}

function filterSubtitle(parts: (string | null | undefined)[]): string[] {
  const applied = parts.filter(Boolean)
  return [applied.length ? `Filtros: ${applied.join('; ')}` : 'Filtros: nenhum (todos os registros visíveis ao emissor)']
}

/** Nome do departamento filtrado — só se estiver no escopo de quem exporta. */
async function departmentName(scope: FleetScope, departmentId: string | undefined): Promise<string | null> {
  if (!departmentId) return null
  if (!scope.allDepartments && !scope.departmentIds.includes(departmentId)) return null
  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId: scope.organizationId },
    select: { name: true },
  })
  return department?.name ?? null
}

export const fleetExportService = {
  async vehicleList(scope: FleetScope, filters: ExportVehiclesBody): Promise<FleetExportResult> {
    const where = vehicleListWhere(scope, filters)
    assertExportSize(await prisma.fleetVehicle.count({ where }), 'veículos')

    const [rows, issuer, filterDepartment] = await Promise.all([
      prisma.fleetVehicle.findMany({ where, select: VEHICLE_SELECT, orderBy: { plate: 'asc' } }),
      loadIssuer(scope),
      departmentName(scope, filters.departmentId),
    ])
    const vehicles = rows.map(toPublicVehicle)

    const publicId = exportedDocumentService.newPublicId()
    const issuedAt = new Date()
    const { bytes } = await createTabularReportPdf({
      title: 'RELAÇÃO DA FROTA',
      organizationName: issuer.organizationName,
      publicId,
      logoPng: issuer.logoPng,
      exporterName: anonymizeName(issuer.exporterFullName),
      orientation: 'landscape',
      subtitles: [
        `Emitida em ${formatDateTime(issuedAt)}`,
        ...filterSubtitle([
          filters.search ? `busca "${filters.search}"` : null,
          filters.status ? `situação ${VEHICLE_STATUS[filters.status]}` : null,
          filterDepartment ? `departamento ${filterDepartment}` : null,
        ]),
      ],
      columns: VEHICLE_LIST_COLUMNS,
      rows: vehicles.map(v => [
        formatPlate(v.plate),
        v.assetTag ?? DASH,
        v.makeModel ?? DASH,
        years(v.manufactureYear, v.modelYear),
        VEHICLE_TYPE[v.vehicleType],
        FUEL[v.fuelType],
        OWNERSHIP[v.ownership],
        v.renavam ?? DASH,
        `${formatNumber(v.tankCapacityL)} L`,
        `${formatNumber(v.odometerKm)} km`,
        v.department?.name ?? GENERAL_FLEET,
        VEHICLE_STATUS[v.status],
      ]),
      emptyMessage: 'Nenhum veículo para os filtros informados.',
      summary: [
        { label: 'Total de veículos', value: String(vehicles.length) },
        { label: 'Por tipo', value: countBy(vehicles, v => VEHICLE_TYPE[v.vehicleType]) },
        { label: 'Por situação', value: countBy(vehicles, v => VEHICLE_STATUS[v.status]) },
        { label: 'Por departamento', value: countBy(vehicles, v => v.department?.name ?? GENERAL_FLEET) },
      ],
      signatures: [issuer.signature],
    })

    await finalize(scope, {
      documentType: EXPORTED_DOCUMENT_TYPES.FLEET_VEHICLE_LIST,
      publicId,
      bytes,
      issuer,
      action: 'FLEET_VEHICLE_LIST_EXPORTED',
      resource: 'FLEET_VEHICLE',
      resourceId: null,
      details: {
        count: vehicles.length,
        filters: {
          search: filters.search ?? null,
          status: filters.status ?? null,
          departmentId: filters.departmentId ?? null,
        },
      },
    })

    return { bytes, publicId, fileName: `relacao-frota-${todayIso(issuedAt)}.pdf` }
  },

  async vehicleSheet(scope: FleetScope, id: string): Promise<FleetExportResult> {
    const vehicle = await fleetVehicleService.getById(scope, id)
    const issuer = await loadIssuer(scope)
    const publicId = exportedDocumentService.newPublicId()
    const issuedAt = new Date()

    const field = (label: string, value: string): PdfField => ({ label, value })
    const { bytes } = await createSectionedReportPdf({
      title: 'FICHA DO VEÍCULO',
      organizationName: issuer.organizationName,
      publicId,
      logoPng: issuer.logoPng,
      exporterName: anonymizeName(issuer.exporterFullName),
      subtitles: [`${formatPlate(vehicle.plate)} · ${vehicle.makeModel ?? 'modelo não informado'}`, `Emitida em ${formatDateTime(issuedAt)}`],
      sections: [
        {
          heading: 'Identificação',
          fields: [
            field('Placa', formatPlate(vehicle.plate)),
            field('Nº de patrimônio', vehicle.assetTag ?? DASH),
            field('Renavam', vehicle.renavam ?? DASH),
            field('Chassi', vehicle.chassis ?? DASH),
            field('Marca/modelo', vehicle.makeModel ?? DASH),
            field('Ano fabricação/modelo', years(vehicle.manufactureYear, vehicle.modelYear)),
            field('Tipo', VEHICLE_TYPE[vehicle.vehicleType]),
          ],
        },
        {
          heading: 'Dados técnicos',
          fields: [
            field('Combustível', FUEL[vehicle.fuelType]),
            field('Usa ARLA 32', vehicle.usesArla32 ? 'Sim' : 'Não'),
            field('Capacidade do tanque', `${formatNumber(vehicle.tankCapacityL)} L`),
            field('Consumo de referência', vehicle.referenceKmPerL ? `${formatNumber(vehicle.referenceKmPerL)} km/L` : DASH),
            field('Regime de trabalho', WORK_REGIME[vehicle.workRegime]),
            field('Hodômetro', `${formatNumber(vehicle.odometerKm)} km`),
          ],
        },
        {
          heading: 'Situação e propriedade',
          fields: [
            field('Situação', VEHICLE_STATUS[vehicle.status]),
            field('Propriedade', OWNERSHIP[vehicle.ownership]),
            field('Entidade proprietária', vehicle.ownerEntity?.name ?? DASH),
            field('Valor de mercado', formatCurrency(vehicle.marketValue)),
          ],
        },
        { heading: 'Departamento', fields: [field('Departamento', vehicle.department?.name ?? GENERAL_FLEET)] },
        {
          heading: 'Registro',
          fields: [
            field('Cadastrado em', authorLine(vehicle.createdAt, vehicle.createdBy)),
            field('Última alteração', authorLine(vehicle.updatedAt, vehicle.updatedBy)),
          ],
        },
        HISTORY_SECTION,
      ],
      signatures: [issuer.signature],
    })

    await finalize(scope, {
      documentType: EXPORTED_DOCUMENT_TYPES.FLEET_VEHICLE_SHEET,
      publicId,
      bytes,
      issuer,
      action: 'FLEET_VEHICLE_SHEET_EXPORTED',
      resource: 'FLEET_VEHICLE',
      resourceId: vehicle.id,
      details: { plate: vehicle.plate },
    })

    return { bytes, publicId, fileName: `ficha-veiculo-${vehicle.plate}.pdf` }
  },

  // ─── Relação de motoristas ─────────────────────────────────────────────────

  async driverList(scope: FleetScope, filters: ExportDriversBody): Promise<FleetExportResult> {
    fleetPiiService.assertConfigured()
    const where = driverListWhere(scope, filters)
    assertExportSize(await prisma.fleetDriver.count({ where }), 'motoristas')

    const [rows, issuer, filterDepartment] = await Promise.all([
      prisma.fleetDriver.findMany({ where, select: DRIVER_SELECT, orderBy: { name: 'asc' } }),
      loadIssuer(scope),
      departmentName(scope, filters.departmentId),
    ])
    const drivers = rows.map(row => toPublicDriver(scope, row))
    const today = todayIso()
    const alerts = drivers.map(d => cnhExpiryAlert(d.cnhExpiry, today))

    const publicId = exportedDocumentService.newPublicId()
    const issuedAt = new Date()
    const { bytes } = await createTabularReportPdf({
      title: 'RELAÇÃO DE MOTORISTAS',
      organizationName: issuer.organizationName,
      publicId,
      logoPng: issuer.logoPng,
      exporterName: anonymizeName(issuer.exporterFullName),
      orientation: 'landscape',
      subtitles: [
        `Emitida em ${formatDateTime(issuedAt)} · CPF e nº da CNH mascarados (LGPD)`,
        ...filterSubtitle([
          // O termo de busca por nome não é impresso: é dado pessoal e o
          // documento circula fora do sistema.
          filters.search ? 'busca por nome' : null,
          // Termo também não é impresso: dígitos soltos podem ser início de CPF.
          filters.registration ? 'busca por matrícula' : null,
          filters.active !== undefined ? (filters.active ? 'somente ativos' : 'somente inativos') : null,
          filterDepartment ? `departamento ${filterDepartment}` : null,
        ]),
      ],
      // ~740 pt. "Situação CNH" e "Alerta CNH" com folga para os textos mais
      // longos ("Não verificada", "VENCE EM 30 DIAS") — truncar o alerta
      // esconderia justamente o que a relação existe para destacar.
      columns: [
        { header: 'Nome', width: 116 },
        { header: 'Matrícula', width: 56 },
        { header: 'CPF', width: 70 },
        { header: 'CNH nº', width: 62 },
        { header: 'Cat.', width: 28 },
        { header: 'Validade', width: 52 },
        { header: 'Situação CNH', width: 72 },
        { header: 'Vínculo', width: 66 },
        { header: 'Departamento', width: 92 },
        { header: 'Ativo', width: 34 },
        { header: 'Alerta CNH', width: 92 },
      ],
      rows: drivers.map((d, i) => [
        d.name,
        d.registrationNumber ?? DASH,
        d.cpfMasked,
        d.cnhMasked,
        d.cnhCategory,
        formatIsoDate(d.cnhExpiry),
        CNH_STATUS[d.cnhStatus],
        EMPLOYMENT[d.employmentKind],
        d.department?.name ?? GENERAL_FLEET,
        d.active ? 'Sim' : 'Não',
        alerts[i].level ? alerts[i].label : DASH,
      ]),
      rowHighlights: alerts.map(a => a.level),
      emptyMessage: 'Nenhum motorista para os filtros informados.',
      summary: [
        { label: 'Total de motoristas', value: String(drivers.length) },
        { label: 'Ativos', value: String(drivers.filter(d => d.active).length) },
        { label: 'CNH vencida', value: String(alerts.filter(a => a.level === 'alert').length) },
        { label: 'CNH vencendo em até 30 dias', value: String(alerts.filter(a => a.level === 'warning').length) },
        { label: 'Por vínculo', value: countBy(drivers, d => EMPLOYMENT[d.employmentKind]) },
      ],
      signatures: [issuer.signature],
    })

    await finalize(scope, {
      documentType: EXPORTED_DOCUMENT_TYPES.FLEET_DRIVER_LIST,
      publicId,
      bytes,
      issuer,
      action: 'FLEET_DRIVER_LIST_EXPORTED',
      resource: 'FLEET_DRIVER',
      resourceId: null,
      details: {
        count: drivers.length,
        // Só QUE filtros foram usados — o nome buscado é dado pessoal.
        filters: {
          bySearch: Boolean(filters.search),
          byRegistration: Boolean(filters.registration),
          active: filters.active ?? null,
          departmentId: filters.departmentId ?? null,
        },
      },
    })

    return { bytes, publicId, fileName: `relacao-motoristas-${todayIso(issuedAt)}.pdf` }
  },

  async driverSheet(scope: FleetScope, id: string): Promise<FleetExportResult> {
    const driver = await fleetDriverService.getById(scope, id)
    const issuer = await loadIssuer(scope)
    const alert = cnhExpiryAlert(driver.cnhExpiry)
    const publicId = exportedDocumentService.newPublicId()
    const issuedAt = new Date()

    const field = (label: string, value: string): PdfField => ({ label, value })
    const { bytes } = await createSectionedReportPdf({
      title: 'FICHA DO MOTORISTA',
      organizationName: issuer.organizationName,
      publicId,
      logoPng: issuer.logoPng,
      exporterName: anonymizeName(issuer.exporterFullName),
      subtitles: [driver.name, `Emitida em ${formatDateTime(issuedAt)} · CPF e nº da CNH mascarados (LGPD)`],
      sections: [
        {
          heading: 'Identificação',
          fields: [
            field('Nome', driver.name),
            field('Matrícula', driver.registrationNumber ?? DASH),
            field('CPF', driver.cpfMasked),
            field('Vínculo', EMPLOYMENT[driver.employmentKind]),
            field('Usuário do SIMP', driver.user?.name ?? 'Sem usuário vinculado'),
            field('Ativo', driver.active ? 'Sim' : 'Não'),
          ],
        },
        {
          heading: 'Habilitação',
          fields: [
            field('Nº da CNH', driver.cnhMasked),
            field('Categoria', driver.cnhCategory),
            field('Validade', `${formatIsoDate(driver.cnhExpiry)}${alert.level ? ` (${alert.label})` : ''}`),
            field('Situação da CNH', CNH_STATUS[driver.cnhStatus]),
          ],
        },
        { heading: 'Departamento', fields: [field('Departamento', driver.department?.name ?? GENERAL_FLEET)] },
        {
          heading: 'Registro',
          fields: [
            field('Cadastrado em', authorLine(driver.createdAt, driver.createdBy)),
            field('Última alteração', authorLine(driver.updatedAt, driver.updatedBy)),
          ],
        },
        HISTORY_SECTION,
      ],
      signatures: [issuer.signature],
    })

    await finalize(scope, {
      documentType: EXPORTED_DOCUMENT_TYPES.FLEET_DRIVER_SHEET,
      publicId,
      bytes,
      issuer,
      action: 'FLEET_DRIVER_SHEET_EXPORTED',
      resource: 'FLEET_DRIVER',
      resourceId: driver.id,
      details: { name: driver.name },
    })

    return { bytes, publicId, fileName: `ficha-motorista-${driver.id}.pdf` }
  },
}
