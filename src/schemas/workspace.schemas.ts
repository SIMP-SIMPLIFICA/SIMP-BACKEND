import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(3, "Nome deve ter no mínimo 3 caracteres"),
  description: z.string().optional(),
  departmentId: z.string().nullable().optional(),
}).strip();

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
}).strip();

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
}).strip();