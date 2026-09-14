import { prisma } from '@/lib/prisma.js'
import {
  type ReportTableSection,
  createSectionedReportPdf,
} from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { departmentBrandingService } from '@/services/department-branding.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'
import { formatCnpj } from '@/utils/cnpj.util.js'
import { resolveChiefName } from '@/utils/department-chief.util.js'

/**
 * Dossiê do Setor (Épico 4, Fase 1).
 *
 * Retrato de tudo que está vinculado a um departamento, num documento só, para
 * responder a diligência do controle interno sem varrer quatro telas.
 *
 * Sai pelo MOTOR UNIVERSAL (`createSectionedReportPdf`), com QR Code e rodapé de
 * validação. Não há gerador próprio aqui: este arquivo monta seções e tabelas e
 * entrega ao motor.
 *
 * CADA SEÇÃO É UMA TABELA, com colunas de largura fixa e cabeçalho próprio.
 * Antes as listas saíam como pares rótulo/valor em texto corrido, e qualquer
 * lista acima de três itens virava um bloco ilegível.
 *
 * As seções são escolhidas por quem exporta. O que NÃO foi pedido não aparece —
 * nem como título vazio, porque um cabeçalho "Convênios" seguido de nada sugere
 * que o setor não tem convênio nenhum, quando na verdade não foi consultado.
 */

export const DOSSIER_SECTIONS = [
  'members',
  'cnpj',
  'councils',
  'qdd',
  'covenants',
  'virtualProcesses',
] as const

export type DossierSection = (typeof DOSSIER_SECTIONS)[number]

export class DepartmentDossierError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_SECTION',
    message: string
  ) {
    super(message)
    this.name = 'DepartmentDossierError'
  }
}

export interface DossierResult {
  bytes: Uint8Array
  publicId: string
  sha256Hash: string
  departmentCode: string
}

// ─── Formatação (conteúdo do PDF é pt-BR) ─────────────────────────────────────

function formatCurrency(value: { toString(): string } | number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

function formatDate(value: Date | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(value)
}

export const departmentDossierService = {
  async generate(
    departmentId: string,
    sections: DossierSection[],
    scope: { organizationId: string; userId: string }
  ): Promise<DossierResult> {
    if (sections.length === 0) {
      throw new DepartmentDossierError(
        'NO_SECTION',
        'Escolha ao menos uma seção para compor o dossiê.'
      )
    }

    const wanted = new Set(sections)

    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: scope.organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        cnpj: true,
        isActive: true,
        manager: { select: { firstName: true, lastName: true } },
      },
    })

    if (!department) {
      throw new DepartmentDossierError('NOT_FOUND', 'Departamento não encontrado.')
    }

    // Cada lista numa consulta própria, disparadas em paralelo e SÓ quando a
    // seção foi pedida: um setor com 300 processos não deve pagar essa consulta
    // para exportar um dossiê de duas seções.
    const [members, councilLinks, qddItems, covenants, virtualProcesses] = await Promise.all([
      wanted.has('members')
        ? prisma.user.findMany({
            // A lotação é N:N (`DepartmentMembers`), não campo do usuário.
            where: { departments: { some: { id: departmentId } } },
            select: { firstName: true, lastName: true, email: true },
            orderBy: { firstName: 'asc' },
          })
        : Promise.resolve([]),
      wanted.has('councils')
        ? prisma.councilDepartment.findMany({
            where: { departmentId, organizationId: scope.organizationId },
            select: { council: { select: { name: true, acronym: true, isActive: true } } },
            orderBy: { council: { name: 'asc' } },
          })
        : Promise.resolve([]),
      wanted.has('qdd')
        ? prisma.qddItem.findMany({
            where: { departmentId, organizationId: scope.organizationId },
            orderBy: [{ year: 'desc' }, { ficha: 'asc' }],
          })
        : Promise.resolve([]),
      wanted.has('covenants')
        ? prisma.covenant.findMany({
            where: { departmentId, organizationId: scope.organizationId },
            select: {
              number: true,
              processObject: true,
              transferValue: true,
              validityEndDate: true,
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      wanted.has('virtualProcesses')
        ? prisma.virtualProcess.findMany({
            where: { departmentId, organizationId: scope.organizationId },
            select: {
              processNumber: true,
              subject: true,
              companyName: true,
              status: true,
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ])

    const [organization, exporter, logoPng] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: scope.organizationId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: scope.userId },
        select: { firstName: true, lastName: true },
      }),
      // Cascata: logo do SETOR primeiro; sem ela, a da prefeitura.
      departmentBrandingService.getLogoBytes(departmentId, scope.organizationId),
    ])

    // ── Seções ──
    const pdfSections: ReportTableSection[] = [
      {
        heading: 'Identificação do Setor',
        fields: [
          { label: 'Denominação', value: department.name },
          { label: 'Sigla', value: department.code },
          { label: 'Situação', value: department.isActive ? 'Ativo' : 'Inativo' },
          // O Ordenador é o chefe do setor, derivado do gestor — ver
          // `department-chief.util.ts`.
          { label: 'Ordenador de Despesa', value: resolveChiefName(department.manager) },
        ],
      },
    ]

    if (wanted.has('cnpj')) {
      pdfSections.push({
        heading: 'Inscrição',
        fields: [
          { label: 'CNPJ', value: formatCnpj(department.cnpj) || 'Não informado' },
        ],
      })
    }

    if (wanted.has('members')) {
      pdfSections.push({
        heading: `Servidores Lotados (${members.length})`,
        columns: [
          { header: 'Nome', width: 230 },
          { header: 'E-mail', width: 265 },
        ],
        // Os servidores lotados NÃO são ofuscados: a lotação é informação
        // pública de organograma, e é justamente o que o dossiê atesta. A
        // ofuscação da LGPD recai sobre quem EXPORTOU, no rodapé.
        rows: members.map(member => [
          [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Sem nome',
          member.email,
        ]),
        emptyMessage: 'Nenhum servidor lotado neste setor.',
      })
    }

    if (wanted.has('councils')) {
      pdfSections.push({
        heading: `Conselhos Vinculados (${councilLinks.length})`,
        columns: [
          { header: 'Sigla', width: 80 },
          { header: 'Denominação', width: 335 },
          { header: 'Situação', width: 80 },
        ],
        rows: councilLinks.map(link => [
          link.council.acronym ?? '—',
          link.council.name,
          link.council.isActive ? 'Ativo' : 'Inativo',
        ]),
        emptyMessage: 'Nenhum conselho vinculado.',
      })
    }

    if (wanted.has('qdd')) {
      const total = qddItems.reduce((sum, item) => sum + Number(item.valorOrcado), 0)

      pdfSections.push({
        heading: `Dotações do QDD (${qddItems.length})`,
        columns: [
          { header: 'Exercício', width: 55 },
          { header: 'Ficha', width: 50 },
          { header: 'Fonte', width: 50 },
          { header: 'Natureza', width: 75 },
          { header: 'Projeto / Atividade', width: 165 },
          { header: 'Valor orçado', width: 100, align: 'right' },
        ],
        rows: [
          ...qddItems.map(item => [
            String(item.year),
            item.ficha,
            item.fonte,
            item.naturezaDespesa,
            item.projetoAtividade,
            formatCurrency(item.valorOrcado),
          ]),
          // Totalizador como última linha da própria tabela: quem confere
          // dotação quer o somatório junto das parcelas, não numa página à
          // parte.
          ...(qddItems.length > 0
            ? [['', '', '', '', 'TOTAL ORÇADO', formatCurrency(total)]]
            : []),
        ],
        emptyMessage: 'Nenhuma dotação cadastrada para este setor.',
      })
    }

    if (wanted.has('covenants')) {
      pdfSections.push({
        heading: `Convênios (${covenants.length})`,
        columns: [
          { header: 'Número', width: 90 },
          { header: 'Objeto', width: 225 },
          { header: 'Vigência até', width: 80 },
          { header: 'Valor', width: 100, align: 'right' },
        ],
        rows: covenants.map(covenant => [
          covenant.number,
          covenant.processObject,
          formatDate(covenant.validityEndDate),
          formatCurrency(covenant.transferValue),
        ]),
        emptyMessage: 'Nenhum convênio vinculado.',
      })
    }

    if (wanted.has('virtualProcesses')) {
      pdfSections.push({
        heading: `Processos Virtuais (${virtualProcesses.length})`,
        columns: [
          { header: 'Número', width: 85 },
          { header: 'Assunto', width: 200 },
          { header: 'Empresa', width: 130 },
          { header: 'Situação', width: 80 },
        ],
        rows: virtualProcesses.map(process => [
          process.processNumber,
          process.subject,
          process.companyName ?? '—',
          process.status,
        ]),
        emptyMessage: 'Nenhum processo virtual vinculado.',
      })
    }

    const publicId = exportedDocumentService.newPublicId()

    const { bytes, sha256Hash } = await createSectionedReportPdf({
      title: 'DOSSIÊ DO SETOR',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId,
      exporterName: anonymizeUserName(exporter?.firstName, exporter?.lastName),
      subtitles: [
        `${department.code} - ${department.name}`,
        `Emitido em ${new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Sao_Paulo',
        }).format(new Date())}`,
      ],
      sections: pdfSections,
      footNote:
        'Documento de consulta. Reflete a situação do setor no momento da ' +
        'exportação e contempla apenas as seções selecionadas.',
    })

    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.DEPARTMENT_DOSSIER,
      publicId,
      bytes,
      exporterFullName: [exporter?.firstName, exporter?.lastName].filter(Boolean).join(' '),
    })

    return { bytes, publicId, sha256Hash, departmentCode: department.code }
  },
}
