import { prisma } from '@/lib/prisma.js'
import { type PdfSection, createOfficialPdf } from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'
import { formatCnpj } from '@/utils/cnpj.util.js'

/**
 * Dossiê do Setor (Épico 4, Fase 1).
 *
 * Retrato de tudo que está vinculado a um departamento, num documento só, para
 * responder a diligência do controle interno sem varrer quatro telas.
 *
 * Sai pelo MOTOR UNIVERSAL (`createOfficialPdf`), com QR Code e rodapé de
 * validação, como todo documento do sistema. Não há gerador próprio aqui: este
 * arquivo monta seções e entrega ao motor.
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
      select: { id: true, name: true, code: true, cnpj: true, chiefName: true, isActive: true },
    })

    if (!department) {
      throw new DepartmentDossierError('NOT_FOUND', 'Departamento não encontrado.')
    }

    // Cada lista numa consulta própria, disparadas em paralelo e SÓ quando a
    // seção foi pedida: um setor com 300 processos não deve pagar essa consulta
    // para exportar um dossiê de duas seções. (Um `include` condicional faria o
    // mesmo, mas o tipo inferido pelo Prisma colapsa no ramo `false`.)
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
            select: { council: { select: { name: true, acronym: true } } },
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
            select: { number: true, processObject: true, transferValue: true },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      wanted.has('virtualProcesses')
        ? prisma.virtualProcess.findMany({
            where: { departmentId, organizationId: scope.organizationId },
            select: { processNumber: true, subject: true, companyName: true },
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
      organizationBrandingService.getLogoBytes(scope.organizationId),
    ])

    const pdfSections: PdfSection[] = [
      {
        heading: 'Identificação',
        fields: [
          { label: 'Setor', value: `${department.code} - ${department.name}` },
          { label: 'Situação', value: department.isActive ? 'Ativo' : 'Inativo' },
          {
            label: 'Ordenador de despesa',
            value: department.chiefName || 'Não informado',
          },
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
        heading: `Servidores lotados (${members.length})`,
        fields: listOrEmpty(
          members.map(member => ({
            label: [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Sem nome',
            // Os servidores lotados NÃO são ofuscados: a lotação é informação
            // pública de organograma, e é justamente o que o dossiê atesta. A
            // ofuscação da LGPD recai sobre quem EXPORTOU, no rodapé.
            value: member.email,
          })),
          'Nenhum servidor lotado neste setor.'
        ),
      })
    }

    if (wanted.has('councils')) {
      pdfSections.push({
        heading: `Conselhos vinculados (${councilLinks.length})`,
        fields: listOrEmpty(
          councilLinks.map(link => ({
            label: link.council.acronym || 'Conselho',
            value: link.council.name,
          })),
          'Nenhum conselho vinculado.'
        ),
      })
    }

    if (wanted.has('qdd')) {
      pdfSections.push({
        heading: `Dotações do QDD (${qddItems.length})`,
        fields: listOrEmpty(
          qddItems.map(item => ({
            label: `Ficha ${item.ficha} · ${item.year}`,
            value:
              `Fonte ${item.fonte} · ${item.naturezaDespesa} · ` +
              `${item.projetoAtividade} · ${formatCurrency(item.valorOrcado)}`,
          })),
          'Nenhuma dotação cadastrada.'
        ),
      })
    }

    if (wanted.has('covenants')) {
      pdfSections.push({
        heading: `Convênios (${covenants.length})`,
        fields: listOrEmpty(
          covenants.map(covenant => ({
            label: covenant.number,
            value:
              covenant.processObject +
              (covenant.transferValue ? ` · ${formatCurrency(covenant.transferValue)}` : ''),
          })),
          'Nenhum convênio vinculado.'
        ),
      })
    }

    if (wanted.has('virtualProcesses')) {
      pdfSections.push({
        heading: `Processos virtuais (${virtualProcesses.length})`,
        fields: listOrEmpty(
          virtualProcesses.map(process => ({
            label: process.processNumber,
            value: [process.subject, process.companyName].filter(Boolean).join(' · '),
          })),
          'Nenhum processo virtual vinculado.'
        ),
      })
    }

    const publicId = exportedDocumentService.newPublicId()

    const { bytes, sha256Hash } = await createOfficialPdf({
      title: 'DOSSIÊ DO SETOR',
      logoPng,
      organizationName: organization?.name ?? 'Organização',
      publicId,
      exporterName: anonymizeUserName(exporter?.firstName, exporter?.lastName),
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

// ─── Apoio ────────────────────────────────────────────────────────────────────

/**
 * A lista, ou uma linha dizendo que está vazia.
 *
 * Uma seção pedida e sem conteúdo precisa dizer isso em palavras: um título
 * seguido de espaço em branco parece falha de impressão, e a diferença entre
 * "não tem" e "não imprimiu" importa num documento de consulta.
 */
function listOrEmpty(
  fields: { label: string; value: string }[],
  emptyMessage: string
): { label: string; value: string }[] {
  return fields.length > 0 ? fields : [{ label: 'Situação', value: emptyMessage }]
}

function formatCurrency(value: { toString(): string } | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}
