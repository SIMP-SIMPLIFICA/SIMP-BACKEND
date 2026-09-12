import { prisma } from '@/lib/prisma.js'
import { EXPORTED_DOCUMENT_TYPES } from '@/constants/exported-document-types.js'
import {
  type ReportColumn,
  type ReportSignature,
  createTabularReportPdf,
} from '@/services/document-pdf.service.js'
import { exportedDocumentService } from '@/services/exported-document.service.js'
import { organizationBrandingService } from '@/services/organization-branding.service.js'
import { anonymizeUserName } from '@/utils/lgpd-anonymizer.util.js'

/**
 * Calendário Anual de Reuniões de um conselho, em PDF.
 *
 * MOVIDO DO FRONTEND PARA O BACKEND nesta entrega. Antes era gerado no navegador
 * com jsPDF, o que tornava impossível hashear o arquivo de forma confiável: o
 * servidor não controlaria os bytes e o hash registrado não significaria nada.
 * Gerando aqui, o calendário entra na validação universal como qualquer outro
 * documento oficial.
 */

export class CouncilCalendarError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_ORGANIZATION',
    message: string
  ) {
    super(message)
    this.name = 'CouncilCalendarError'
  }
}

export interface CalendarScope {
  organizationId: string
  userId: string
}

/** Cargos da Mesa Diretora — só estes assinam o calendário. */
const BOARD_ROLES = ['PRESIDENTE', 'VICE_PRESIDENTE', 'SECRETARIO'] as const

const ROLE_LABELS: Record<string, string> = {
  PRESIDENTE: 'Presidente',
  VICE_PRESIDENTE: 'Vice-Presidente',
  SECRETARIO: 'Secretário',
  MEMBRO_TITULAR: 'Membro Titular',
  MEMBRO_SUPLENTE: 'Membro Suplente',
}

const STATUS_LABELS: Record<string, string> = {
  AGENDADA: 'Agendada',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
}

/** Larguras somam 495pt — faixa útil da página A4 com margem de 50. */
const COLUMNS: ReportColumn[] = [
  { header: 'Data e hora', width: 110 },
  { header: 'Pauta / Tema', width: 300 },
  { header: 'Situação', width: 85 },
]

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}

export const councilCalendarReportService = {
  /**
   * Gera o calendário do exercício e registra o hash para validação pública.
   *
   * Um ano sem reuniões ainda produz documento: "nada agendado" é informação
   * legítima para publicação e arquivo.
   */
  async generate(councilId: string, year: number, scope: CalendarScope) {
    const council = await prisma.council.findFirst({
      where: { id: councilId, organizationId: scope.organizationId },
      select: { id: true, name: true },
    })

    if (!council) {
      throw new CouncilCalendarError('NOT_FOUND', 'Conselho não encontrado.')
    }

    // Limites do exercício em hora local, para que uma reunião de 31/12 à noite
    // não escape para o ano seguinte.
    const start = new Date(year, 0, 1, 0, 0, 0, 0)
    const end = new Date(year, 11, 31, 23, 59, 59, 999)

    const [meetings, board, organization, issuer] = await Promise.all([
      prisma.councilMeeting.findMany({
        where: { councilId, scheduledAt: { gte: start, lte: end } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true, title: true, status: true },
      }),
      prisma.councilMembership.findMany({
        where: { councilId, isActive: true, role: { in: [...BOARD_ROLES] } },
        select: { role: true, user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.organization.findUnique({
        where: { id: scope.organizationId },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where: { id: scope.userId },
        select: { firstName: true, lastName: true },
      }),
    ])

    // Ordena pela hierarquia da Mesa, não pela ordem do banco: um calendário
    // oficial assina de cima para baixo.
    const signatures: ReportSignature[] = BOARD_ROLES.flatMap(role =>
      board
        .filter(member => member.role === role)
        .map(member => ({
          name:
            [member.user?.firstName, member.user?.lastName].filter(Boolean).join(' ') || '—',
          role: ROLE_LABELS[role] ?? role,
        }))
    )

    const rows = meetings.map(meeting => [
      formatDateTime(meeting.scheduledAt),
      meeting.title,
      STATUS_LABELS[meeting.status] ?? meeting.status,
    ])

    const publicId = exportedDocumentService.newPublicId()

    const { bytes, sha256Hash } = await createTabularReportPdf({
      title: 'CALENDÁRIO ANUAL DE REUNIÕES',
      organizationName: organization?.name ?? 'Organização',
      publicId,
      exporterName: anonymizeUserName(issuer?.firstName, issuer?.lastName),
      subtitles: [council.name, `Exercício de ${year}`],
      columns: COLUMNS,
      rows,
      summary: [{ label: 'Total de reuniões', value: String(meetings.length) }],
      signatures,
      emptyMessage: 'Nenhuma reunião registrada para este exercício.',
      logoPng: await organizationBrandingService.getLogoBytes(scope.organizationId),
    })

    await exportedDocumentService.register({
      organizationId: scope.organizationId,
      documentType: EXPORTED_DOCUMENT_TYPES.COUNCIL_CALENDAR,
      publicId,
      bytes,
      exporterFullName: [issuer?.firstName, issuer?.lastName].filter(Boolean).join(' '),
    })

    return { bytes, publicId, sha256Hash, councilName: council.name, total: meetings.length }
  },
}
