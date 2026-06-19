/**
 * SIMP – Minimal bootstrap seed
 *
 * Creates a single Super Admin user (Supabase Auth + profiles row).
 * Run after a fresh migration or when wiping test data.
 *
 * Usage:
 *   npx tsx prisma/seeds/seed.ts
 *
 * Environment variables required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 */

import { PrismaClient, AppRole } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'

// ── Clients ──────────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Super Admin credentials (override via env vars in CI/CD) ─────────────────

const SUPER_ADMIN_EMAIL    = process.env.SEED_SUPER_ADMIN_EMAIL    ?? 'superadmin@simp.gov.br'
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Simp@SuperAdmin2026!'
const SUPER_ADMIN_FIRST    = process.env.SEED_SUPER_ADMIN_FIRST    ?? 'Super'
const SUPER_ADMIN_LAST     = process.env.SEED_SUPER_ADMIN_LAST     ?? 'Admin'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertSupabaseUser(email: string, password: string): Promise<string> {
  const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existing = (listData as any)?.users?.find((u: { email?: string }) => u.email === email)

  if (existing) {
    await supabaseAdmin.auth.admin.deleteUser(existing.id)
    console.log(`  ↺ Deleted existing Supabase user: ${email}`)
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`Supabase createUser failed for ${email}: ${error?.message}`)
  }

  return data.user.id
}

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

  // Wipe all Supabase Auth users
  const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const authUsers = (authList as any)?.users as Array<{ id: string }> ?? []
  for (const u of authUsers) {
    await supabaseAdmin.auth.admin.deleteUser(u.id)
  }
  console.log(`  ✅ Deleted ${authUsers.length} Supabase Auth user(s)`)
}

// ── 2. SEED ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Seeding Super Admin…')

  const superAdminId = await upsertSupabaseUser(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)

  await prisma.user.create({
    data: {
      id:           superAdminId,
      email:        SUPER_ADMIN_EMAIL,
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
  console.log(`  │  Password: ${SUPER_ADMIN_PASSWORD.padEnd(33)}│`)
  console.log('  └─────────────────────────────────────────────┘')
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
