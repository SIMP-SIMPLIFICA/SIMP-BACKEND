import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  createVirtualProcessCompanySchema,
  createVirtualProcessSourceSchema,
  updateVirtualProcessCompanySchema,
  updateVirtualProcessSourceSchema,
} from '../schemas/virtual-process.schemas.js'

// ─── Sources (Origens do Recurso) ────────────────────────────────────────────

export const sourceController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessSourceSchema.parse(request.body)
    const organizationId = request.user.organizationId
    if (!organizationId && !request.user.isSuperAdmin) {
      return reply.status(403).send({ message: 'Usuário sem organização' })
    }
    const source = await prisma.virtualProcessSource.create({
      data: { organizationId: organizationId, name: data.name },
    })
    return reply.status(201).send(source)
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const sources = await prisma.virtualProcessSource.findMany({
      where: orgFilter,
      orderBy: { name: 'asc' },
    })
    return reply.send(sources)
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessSourceSchema.parse(request.body)
    const source = await prisma.virtualProcessSource.findUnique({ where: { id } })
    if (!source) return reply.status(404).send({ message: 'Origem não encontrada' })
    if (!request.user.isSuperAdmin && source.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Origem não encontrada' })
    }
    const updated = await prisma.virtualProcessSource.update({ where: { id }, data })
    return reply.send(updated)
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const source = await prisma.virtualProcessSource.findUnique({ where: { id } })
    if (!source) return reply.status(404).send({ message: 'Origem não encontrada' })
    if (!request.user.isSuperAdmin && source.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Origem não encontrada' })
    }
    await prisma.virtualProcessSource.delete({ where: { id } })
    return reply.status(204).send()
  },
}

// ─── Companies (Empresas Contratadas) ────────────────────────────────────────

export const companyController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createVirtualProcessCompanySchema.parse(request.body)
    const organizationId = request.user.organizationId
    if (!organizationId && !request.user.isSuperAdmin) {
      return reply.status(403).send({ message: 'Usuário sem organização' })
    }
    const company = await prisma.virtualProcessCompany.create({
      data: { organizationId: organizationId, name: data.name, cnpj: data.cnpj ?? null },
    })
    return reply.status(201).send(company)
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: request.user.organizationId }
    const companies = await prisma.virtualProcessCompany.findMany({
      where: orgFilter,
      orderBy: { name: 'asc' },
    })
    return reply.send(companies)
  },

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateVirtualProcessCompanySchema.parse(request.body)
    const company = await prisma.virtualProcessCompany.findUnique({ where: { id } })
    if (!company) return reply.status(404).send({ message: 'Empresa não encontrada' })
    if (!request.user.isSuperAdmin && company.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }
    const updated = await prisma.virtualProcessCompany.update({ where: { id }, data })
    return reply.send(updated)
  },

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const company = await prisma.virtualProcessCompany.findUnique({ where: { id } })
    if (!company) return reply.status(404).send({ message: 'Empresa não encontrada' })
    if (!request.user.isSuperAdmin && company.organizationId !== request.user.organizationId) {
      return reply.status(404).send({ message: 'Empresa não encontrada' })
    }
    await prisma.virtualProcessCompany.delete({ where: { id } })
    return reply.status(204).send()
  },
}
