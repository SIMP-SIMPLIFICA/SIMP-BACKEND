import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  createVirtualProcessSourceSchema,
  updateVirtualProcessSourceSchema,
  createVirtualProcessCompanySchema,
  updateVirtualProcessCompanySchema,
} from '../schemas/virtual-process.schemas.js'

async function assertMember(workspaceId: string, userId: string, reply: FastifyReply) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) {
    reply.status(403).send({ message: 'Acesso negado ao workspace' })
    return false
  }
  return true
}

// ─── Sources (Origens do Recurso) ────────────────────────────────────────────

export const sourceController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessSourceSchema.parse(request.body)
    if (!await assertMember(data.workspaceId, request.user.id, reply)) return
    const source = await prisma.virtualProcessSource.create({
      data: { workspaceId: data.workspaceId, name: data.name },
    })
    return reply.status(201).send(source)
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params)
    if (!await assertMember(workspaceId, request.user.id, reply)) return
    const sources = await prisma.virtualProcessSource.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    })
    return reply.send(sources)
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessSourceSchema.parse(request.body)
    const source = await prisma.virtualProcessSource.findUnique({ where: { id } })
    if (!source) return reply.status(404).send({ message: 'Origem não encontrada' })
    if (!await assertMember(source.workspaceId, request.user.id, reply)) return
    const updated = await prisma.virtualProcessSource.update({ where: { id }, data })
    return reply.send(updated)
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const source = await prisma.virtualProcessSource.findUnique({ where: { id } })
    if (!source) return reply.status(404).send({ message: 'Origem não encontrada' })
    if (!await assertMember(source.workspaceId, request.user.id, reply)) return
    await prisma.virtualProcessSource.delete({ where: { id } })
    return reply.status(204).send()
  },
}

// ─── Companies (Empresas Contratadas) ────────────────────────────────────────

export const companyController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessCompanySchema.parse(request.body)
    if (!await assertMember(data.workspaceId, request.user.id, reply)) return
    const company = await prisma.virtualProcessCompany.create({
      data: { workspaceId: data.workspaceId, name: data.name, cnpj: data.cnpj ?? null },
    })
    return reply.status(201).send(company)
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params)
    if (!await assertMember(workspaceId, request.user.id, reply)) return
    const companies = await prisma.virtualProcessCompany.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    })
    return reply.send(companies)
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessCompanySchema.parse(request.body)
    const company = await prisma.virtualProcessCompany.findUnique({ where: { id } })
    if (!company) return reply.status(404).send({ message: 'Empresa não encontrada' })
    if (!await assertMember(company.workspaceId, request.user.id, reply)) return
    const updated = await prisma.virtualProcessCompany.update({ where: { id }, data })
    return reply.send(updated)
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const company = await prisma.virtualProcessCompany.findUnique({ where: { id } })
    if (!company) return reply.status(404).send({ message: 'Empresa não encontrada' })
    if (!await assertMember(company.workspaceId, request.user.id, reply)) return
    await prisma.virtualProcessCompany.delete({ where: { id } })
    return reply.status(204).send()
  },
}
