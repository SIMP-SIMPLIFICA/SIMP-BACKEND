/**
 * SIMP – Minimal bootstrap seed
 *
 * Creates a single Super Admin user (auth local: argon2 + Postgres).
 * Run after a fresh migration or when wiping test data.
 *
 * Usage:
 *   npx tsx prisma/seeds/seed.ts
 *
 * Environment variables required:
 *   DATABASE_URL
 */

import { randomUUID } from 'node:crypto'
import { PrismaClient, AppRole } from '@prisma/client'
import { authService } from '../../src/services/auth.service.js'

// ── Clients ──────────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

// ── Super Admin credentials (override via env vars in CI/CD) ─────────────────

const SUPER_ADMIN_EMAIL    = process.env.SEED_SUPER_ADMIN_EMAIL    ?? 'superadmin@simp.gov.br'
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Simp@SuperAdmin2026!'
const SUPER_ADMIN_FIRST    = process.env.SEED_SUPER_ADMIN_FIRST    ?? 'Super'
const SUPER_ADMIN_LAST     = process.env.SEED_SUPER_ADMIN_LAST     ?? 'Admin'

// ── 1. FULL WIPE ─────────────────────────────────────────────────────────────

async function wipe() {
  console.log('\n🧹 Wiping all data…')

  await prisma.department.updateMany({ data: { managerId: null } })

  // Leaf tables first — order respects FK constraints
  await prisma.meetingAttendance.deleteMany()
  await prisma.meetingAgendaItem.deleteMany()
  await prisma.signatureRequest.deleteMany()
  await prisma.councilDocument.deleteMany()
  await prisma.councilMeeting.deleteMany()
  await prisma.councilMembership.deleteMany()
  await prisma.council.deleteMany()
  await prisma.supportMessage.deleteMany()
  await prisma.supportRequest.deleteMany()
  await prisma.officialDocument.deleteMany()
  await prisma.libraryDocument.deleteMany()
  await prisma.documentCategory.deleteMany()
  await prisma.covenant.deleteMany()
  await prisma.covenantType.deleteMany()
  await prisma.convenente.deleteMany()
  await prisma.concedente.deleteMany()
  await prisma.virtualProcessDocument.deleteMany()
  await prisma.virtualProcess.deleteMany()
  await prisma.virtualProcessCategory.deleteMany()
  await prisma.virtualProcessSource.deleteMany()
  await prisma.virtualProcessCompany.deleteMany()
  await prisma.financeAttachment.deleteMany()
  await prisma.financeEntry.deleteMany()
  await prisma.financeCategory.deleteMany()
  await prisma.bankAccount.deleteMany()
  await prisma.communicationAttachment.deleteMany()
  await prisma.documentRecipient.deleteMany()
  await prisma.communicationDocument.deleteMany()
  await prisma.calendarAttachment.deleteMany()
  await prisma.calendarEvent.deleteMany()
  await prisma.note.deleteMany()
  // Task subtables (must come before Task and User)
  await prisma.taskNote.deleteMany()
  await prisma.taskHistory.deleteMany()
  await prisma.taskAssignee.deleteMany()
  await prisma.taskAttachment.deleteMany()
  await prisma.checklistItem.deleteMany()
  await prisma.task.deleteMany()
  // Notifications
  await prisma.notification.deleteMany()
  // Workspaces
  await prisma.workspaceMember.deleteMany()
  await prisma.workspace.deleteMany()
  // Misc
  await prisma.govBrOAuthState.deleteMany()
  await prisma.sequenceControl.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.revokedToken.deleteMany()
  await prisma.userSession.deleteMany()
  await prisma.userRole.deleteMany()
  await prisma.department.deleteMany()
  await prisma.user.deleteMany()
  await prisma.role.deleteMany()
  await prisma.organizationModule.deleteMany()
  await prisma.organization.deleteMany()
  await prisma.setting.deleteMany()

  console.log('  ✅ All tables cleared')
}

// ── 2. SEED ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Seeding Super Admin…')

  const hashedPassword = await authService.hashPassword(SUPER_ADMIN_PASSWORD)

  await prisma.user.create({
    data: {
      id:           randomUUID(),
      email:        SUPER_ADMIN_EMAIL,
      password:     hashedPassword,
      firstName:    SUPER_ADMIN_FIRST,
      lastName:     SUPER_ADMIN_LAST,
      role:         AppRole.superadmin,
      isSuperAdmin: true,
      isActive:     true,
      isVerified:   true,
      // organizationId intentionally null — super admins are platform-level
    },
  })

  console.log('\n✅ Seed complete!\n')
  console.log('  ┌─────────────────────────────────────────────┐')
  console.log('  │  Super Admin credentials                    │')
  console.log(`  │  Email:    ${SUPER_ADMIN_EMAIL.padEnd(33)}│`)
  // Nunca imprimir a senha: logs de CI/CD e de terminal são persistidos e
  // frequentemente coletados por ferramentas de observabilidade (CodeQL:
  // clear-text logging of sensitive information).
  console.log(`  │  Password: ${'[REDACTED]'.padEnd(33)}│`)
  console.log('  └─────────────────────────────────────────────┘')
  console.log('  Defina SEED_SUPER_ADMIN_PASSWORD no .env para escolher a senha;')
  console.log('  sem essa variável, é usada a senha padrão do seed.')
  console.log('\n  ⚠️  Change the password immediately after first login.\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await wipe()
  await seed()
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
