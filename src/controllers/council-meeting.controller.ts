import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { AgendaItemStatus, MeetingStatus } from '@prisma/client'
import {
  MEETING_FROZEN_ERROR,
  MEETING_FROZEN_MESSAGE,
  getMeetingFreezeAt,
  isMeetingFrozen,
} from '@/services/council-compliance.js'
import { HARD_QUERY_CAP } from '@/constants/pagination.js'

/**
 * Recusa padronizada quando o registro está congelado (>72h da reunião).
 * Devolve `true` quando bloqueou, para o chamador apenas retornar.
 */
function blockIfFrozen(reply: FastifyReply, scheduledAt: Date): boolean {
  if (!isMeetingFrozen(scheduledAt)) return false
  reply.code(403).send({ error: MEETING_FROZEN_ERROR, message: MEETING_FROZEN_MESSAGE })
  return true
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestUser {
  user: {
    id: string
    organizationId: string
    isSuperAdmin: boolean
    permissions?: string[]
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const createMeetingSchema = z.object({
  title:       z.string().min(3).max(300),
  description: z.string().max(2000).optional(),
  location:    z.string().max(500).optional(),
  scheduledAt: z.coerce.date(),
})

const updateMeetingSchema = createMeetingSchema.partial().extend({
  endedAt: z.coerce.date().optional(),
  quorum:  z.number().int().positive().optional(),
})

const updateStatusSchema = z.object({
  status: z.nativeEnum(MeetingStatus),
})

const addAgendaItemSchema = z.object({
  order:       z.number().int().positive(),
  title:       z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
})

const updateAgendaItemSchema = z.object({
  order:         z.number().int().positive().optional(),
  title:         z.string().min(1).max(300).optional(),
  description:   z.string().max(2000).optional(),
  status:        z.nativeEnum(AgendaItemStatus).optional(),
  votingRemarks: z.string().max(2000).optional().nullable(),
})

const saveAttendanceSchema = z.object({
  attendance: z.array(z.object({
    membershipId:     z.string().min(1),
    isPresent:        z.boolean(),
    justifiedAbsence: z.boolean().optional().nullable(),
  })),
})

const councilParam     = z.object({ councilId: z.string().min(1) })
const meetingParam     = z.object({ councilId: z.string().min(1), id: z.string().min(1) })
const agendaParam      = z.object({ councilId: z.string().min(1), id: z.string().min(1), itemId: z.string().min(1) })

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCouncil(councilId: string, orgFilter: Record<string, unknown>) {
  return prisma.council.findFirst({ where: { id: councilId, ...orgFilter } })
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const meetingController = {

  // ─── Reuniões ───────────────────────────────────────────────────────────────

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId } = councilParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meetings = await prisma.councilMeeting.findMany({
        // Teto de memoria: esta listagem nao expoe paginacao ao cliente.
        take: HARD_QUERY_CAP,
        where: { councilId, ...orgFilter },
        orderBy: { scheduledAt: 'desc' },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count:    { select: { agendaItems: true, documents: true } },
        },
      })

      // O servidor é a fonte da verdade do congelamento: a interface apenas
      // reflete. Se o frontend recalculasse, o relógio do navegador do usuário
      // entraria na decisão e um registro poderia parecer editável e ser recusado.
      return reply.send({
        data: meetings.map(m => ({
          ...m,
          isFrozen: isMeetingFrozen(m.scheduledAt),
          freezeAt: getMeetingFreezeAt(m.scheduledAt),
        })),
      })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'List Meetings Failed', message: (err as Error).message })
    }
  },

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId } = councilParam.parse(request.params)
      const body = createMeetingSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.create({
        data: {
          organizationId,
          councilId,
          createdById: userId,
          title:       body.title,
          description: body.description ?? null,
          location:    body.location    ?? null,
          scheduledAt: body.scheduledAt,
        },
      })

      return reply.code(201).send(meeting)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Create Meeting Failed', message: (err as Error).message })
    }
  },

  async get(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id } = meetingParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({
        where: { id, councilId, ...orgFilter },
        include: {
          createdBy:  { select: { id: true, firstName: true, lastName: true } },
          agendaItems: { orderBy: { order: 'asc' } },
          documents:   {
            include: {
              uploadedBy:       { select: { id: true, firstName: true, lastName: true } },
              signatureRequests: { select: { id: true, status: true, signedAt: true, requestedById: true } },
            },
          },
        },
      })

      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      // Veredito do congelamento vem pronto do servidor (ver comentário em `list`).
      return reply.send({
        ...meeting,
        isFrozen: isMeetingFrozen(meeting.scheduledAt),
        freezeAt: getMeetingFreezeAt(meeting.scheduledAt),
      })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Get Meeting Failed', message: (err as Error).message })
    }
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id } = meetingParam.parse(request.params)
      const body = updateMeetingSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const existing = await prisma.councilMeeting.findFirst({ where: { id, councilId, ...orgFilter } })
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, existing.scheduledAt)) return

      const updated = await prisma.councilMeeting.update({ where: { id }, data: body })
      return reply.send(updated)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Meeting Failed', message: (err as Error).message })
    }
  },

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id } = meetingParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const existing = await prisma.councilMeeting.findFirst({ where: { id, councilId, ...orgFilter } })
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, existing.scheduledAt)) return

      await prisma.councilMeeting.delete({ where: { id } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Meeting Failed', message: (err as Error).message })
    }
  },

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id } = meetingParam.parse(request.params)
      const { status } = updateStatusSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const existing = await prisma.councilMeeting.findFirst({ where: { id, councilId, ...orgFilter } })
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, existing.scheduledAt)) return

      const data: { status: MeetingStatus; endedAt?: Date } = { status }
      if (status === MeetingStatus.CONCLUIDA && !existing.endedAt) data.endedAt = new Date()

      const updated = await prisma.councilMeeting.update({ where: { id }, data })
      return reply.send(updated)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Status Failed', message: (err as Error).message })
    }
  },

  // ─── Pautas ─────────────────────────────────────────────────────────────────

  async addAgendaItem(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id: meetingId } = meetingParam.parse(request.params)
      const body = addAgendaItemSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, meeting.scheduledAt)) return

      const item = await prisma.meetingAgendaItem.create({
        data: {
          meetingId,
          order:       body.order,
          title:       body.title,
          description: body.description ?? null,
        },
      })

      return reply.code(201).send(item)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Add Agenda Item Failed', message: (err as Error).message })
    }
  },

  async updateAgendaItem(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id: meetingId, itemId } = agendaParam.parse(request.params)
      const body = updateAgendaItemSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, meeting.scheduledAt)) return

      const item = await prisma.meetingAgendaItem.findFirst({ where: { id: itemId, meetingId } })
      if (!item) return reply.code(404).send({ error: 'Not Found', message: 'Item de pauta não encontrado.' })

      const updated = await prisma.meetingAgendaItem.update({ where: { id: itemId }, data: body })
      return reply.send(updated)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Update Agenda Item Failed', message: (err as Error).message })
    }
  },

  async removeAgendaItem(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id: meetingId, itemId } = agendaParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, meeting.scheduledAt)) return

      const item = await prisma.meetingAgendaItem.findFirst({ where: { id: itemId, meetingId } })
      if (!item) return reply.code(404).send({ error: 'Not Found', message: 'Item de pauta não encontrado.' })

      await prisma.meetingAgendaItem.delete({ where: { id: itemId } })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Remove Agenda Item Failed', message: (err as Error).message })
    }
  },

  // ─── Presença ────────────────────────────────────────────────────────────────

  async getAttendance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id: meetingId } = meetingParam.parse(request.params)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })

      const [activeMembers, attendanceRecords] = await Promise.all([
        prisma.councilMembership.findMany({
          where:   { councilId, isActive: true },
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { role: 'asc' },
        }),
        prisma.meetingAttendance.findMany({ where: { meetingId } }),
      ])

      const attendanceMap = new Map(attendanceRecords.map((a) => [a.membershipId, a]))

      const data = activeMembers.map((m) => {
        const record = attendanceMap.get(m.id)
        return {
          membershipId:     m.id,
          userId:           m.userId,
          firstName:        m.user.firstName,
          lastName:         m.user.lastName,
          role:             m.role,
          isPresent:        record?.isPresent ?? false,
          justifiedAbsence: record?.justifiedAbsence ?? null,
        }
      })

      return reply.send({ data })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Get Attendance Failed', message: (err as Error).message })
    }
  },

  async saveAttendance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
      const { councilId, id: meetingId } = meetingParam.parse(request.params)
      const { attendance } = saveAttendanceSchema.parse(request.body)
      const orgFilter = isSuperAdmin ? {} : { organizationId }

      const council = await resolveCouncil(councilId, orgFilter)
      if (!council) return reply.code(404).send({ error: 'Not Found', message: 'Conselho não encontrado.' })

      const meeting = await prisma.councilMeeting.findFirst({ where: { id: meetingId, councilId, ...orgFilter } })
      if (!meeting) return reply.code(404).send({ error: 'Not Found', message: 'Reunião não encontrada.' })
      if (blockIfFrozen(reply, meeting.scheduledAt)) return

      await Promise.all(
        attendance.map((entry) =>
          prisma.meetingAttendance.upsert({
            where:  { meetingId_membershipId: { meetingId, membershipId: entry.membershipId } },
            create: { meetingId, membershipId: entry.membershipId, isPresent: entry.isPresent, justifiedAbsence: entry.justifiedAbsence ?? null },
            update: { isPresent: entry.isPresent, justifiedAbsence: entry.justifiedAbsence ?? null },
          }),
        ),
      )

      return reply.send({ success: true })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Save Attendance Failed', message: (err as Error).message })
    }
  },
}
