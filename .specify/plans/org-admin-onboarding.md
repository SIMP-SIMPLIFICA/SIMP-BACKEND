# Implementation Plan: Organization Admin Onboarding

**Feature**: `org-admin-onboarding` | **Date**: 2026-07-17 | **Spec**: [.specify/specs/org-admin-onboarding.md](../specs/org-admin-onboarding.md)

**Input**: Feature specification from `.specify/specs/org-admin-onboarding.md`

**Note**: Produced by manually following `.github/agents/speckit.plan.agent.md`, adapted to this project's flat-file convention under `.specify/{specs,plans,tasks}/org-admin-onboarding.md` (established in the `mobile-nav-fix` feature). No `.specify/extensions.yml` exists, so no hooks apply.

## Summary

Both organization-creation entry points (`admin.controller.ts::createOrganization`, used by the internal admin panel, and `organization.controller.ts::create`, a public self-service signup endpoint) already run a `prisma.$transaction` that creates the `Organization` and the admin `User` together — this part of the flow is not missing. The defect is that both transactions look up the "admin" `Role` via `tx.role.findFirst({ where: { name: 'admin' } })` and only link it with a conditional `if (adminRole) { ... }` — but **no code path anywhere in the system ever creates a `Role` named "admin"** (confirmed: not in `prisma/seeds/seed.ts`, not in any migration). The lookup always returns `null`, the conditional never fires, and the new user ends up with zero `UserRole` rows. This is what later surfaces as "Nenhum admin ativo encontrado nesta organização" in `admin.controller.ts`'s `impersonate` action, which explicitly filters on `roles: { some: { role: { name: 'admin' } } }`.

The fix replaces the silent `findFirst`/conditional pattern with an unconditional, transaction-safe `upsert` — self-healing regardless of whether any prior seed step has run — applied identically in both entry points.

## Technical Context

**Language/Version**: TypeScript 5.9, Fastify 5, Prisma 6.19 (`SIMP-BACKEND` only — no frontend changes; `AdminNewOrganizationPage.tsx` already collects the administrator's name and email correctly)

**Primary Dependencies**: existing `@prisma/client` transaction API (`Prisma.TransactionClient`), existing `emailService.sendTempPasswordEmail` (wired in Fase 0), existing `authService.hashPassword`/`generateTempPassword`

**Storage**: PostgreSQL (local Docker). No schema or migration change — `Role`, `UserRole`, `User`, `Organization` already model everything required; this is a data/logic defect, not a schema gap.

**Testing**: Manual verification — create an org, immediately impersonate its admin (must succeed); check MailHog for the temp-password email; check the API response contains no password. `npm run type-check` / `npm run lint` as regression gates.

**Target Platform**: Backend API only

**Constraints**: Must not weaken multi-tenant isolation (Constitution Principle IV) — the "admin" `Role` row is a shared, global **system role** definition (`isSystem: true`, `organizationId: null`), matching the existing schema design (`Role.name` is globally unique; `Role.organizationId` is nullable specifically to support org-independent system roles alongside org-specific custom roles created via the Roles UI). Scoping to "only this organization's data" is enforced the same way it already is everywhere else in the codebase: via `User.organizationId` and per-request org-filtering — not by creating a separate Role per organization.

**Scale/Scope**: 1 new file (`src/constants/permissions.ts`), 1 new helper function (`rbac.service.ts`), 2 controllers updated (`admin.controller.ts`, `organization.controller.ts`), 1 controller updated to remove now-duplicated inline data (`role.controller.ts`)

## Constitution Check

*Gate: evaluated before task generation.*

| Principle | Applicable? | Assessment |
|---|---|---|
| I. Local-First & Zero Cloud Credentials | No | No environment/infra surface touched. |
| II. Supabase Prohibition | No | Not touched. |
| III. Municipal Domain Integrity | No | No financial/protocol/council/signature logic touched. |
| IV. Multi-Tenant & Module-Gated Architecture | **Yes** | This *is* a Principle IV fix: it closes a real gap in the RBAC provisioning path. It also directly serves the already-registered `TechStack.md` §11 P1 item about consolidating triplicated RBAC logic — that item was about permission *resolution* (`rbac.service.ts` vs. `utils/database.ts` vs. `auth.middleware.ts`); this plan additionally consolidates permission *provisioning* (the "admin" role definition, previously inlined ad hoc — and silently broken — in two separate controllers) into one shared, transaction-safe helper. |
| V. Spec-Driven Development | **Yes** | Second feature executed under the formal `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` flow. |
| VI. Environment & Security Baseline | **Yes** | Directly protects the "no secrets in API responses" guarantee (already enforced in `admin.controller.ts` since Fase 0) by construction — the fix does not touch response shaping, only role linkage, so this guarantee is preserved, not re-litigated. |

**Result**: PASS, no violations. No entries required in Complexity Tracking.

## Architecture Decisions

### Decision 1 — Extract shared permission catalog to `src/constants/permissions.ts`

`AVAILABLE_PERMISSIONS` currently lives inline inside `role.controller.ts` (used to power the Roles management UI). Move it, unchanged, into a new `src/constants/permissions.ts`, and add a derived export:

```ts
export const DEFAULT_ADMIN_PERMISSIONS: string[] = /* every key from AVAILABLE_PERMISSIONS except 'system:admin' */
```

**Rationale**: `system:admin` is explicitly documented in its own definition as "Acesso de Super Administrador" — reserved for SIMP's own operators (Constitution Principle IV distinguishes org-level admin from platform-level super admin). Every other permission key is safe and expected for a full organization administrator. Centralizing this avoids a second, drifting copy of the permission catalog appearing in the org-creation code path.

### Decision 2 — Add `ensureAdminRole` to `src/services/rbac.service.ts`

```ts
import { Prisma } from '@prisma/client'
import { DEFAULT_ADMIN_PERMISSIONS } from '@/constants/permissions.js'

export async function ensureAdminRole(tx: Prisma.TransactionClient): Promise<{ id: string }> {
  return tx.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      displayName: 'Administrador',
      isSystem: true,
      permissions: DEFAULT_ADMIN_PERMISSIONS,
    },
    select: { id: true },
  })
}
```

**Rationale**: `rbac.service.ts` is already the codebase's home for RBAC logic (permission resolution). Takes the caller's `Prisma.TransactionClient` (not the global `prisma` singleton) so the role upsert participates in the same atomic transaction as the `Organization`/`User` creation — if the transaction rolls back, the role upsert rolls back with it (though in practice the row becomes permanent and reused after the first successful call, by design). `update: {}` on an existing row means an already-upserted role is left untouched by subsequent calls — this is a one-time bootstrap that then behaves as a plain lookup.

### Decision 3 — `admin.controller.ts::createOrganization`

Replace:
```ts
const adminRole = await tx.role.findFirst({ where: { name: 'admin' } })
if (adminRole) {
  await tx.userRole.create({ data: { userId: adminUser.id, roleId: adminRole.id, assignedBy: 'super-admin' } })
}
```
with:
```ts
const adminRole = await ensureAdminRole(tx)
await tx.userRole.create({ data: { userId: adminUser.id, roleId: adminRole.id, assignedBy: 'super-admin' } })
```
Unconditional — there is no longer a valid "role doesn't exist" case to silently tolerate.

### Decision 4 — `organization.controller.ts::create`

Identical replacement, using `assignedBy: 'system'` (matching the current literal already used in that file, since this is the unauthenticated public flow — there is no acting super-admin to attribute the assignment to).

### Decision 5 — `role.controller.ts` unchanged in behavior, changed in source

Import `AVAILABLE_PERMISSIONS` from `@/constants/permissions.js` instead of the inline object. No behavior change — the Roles management UI continues to see the exact same catalog.

### Decision 6 — No email change for either controller

`admin.controller.ts` already generates and emails a temporary password (Fase 0) — FR-002/FR-003 are already satisfied there and are unaffected by this fix. `organization.controller.ts`'s public signup flow uses a self-chosen password (`data.adminPassword` from the request), so there is no temporary password to email — per the spec's Assumptions, this is a deliberate difference in how the two flows obtain a password, not a gap to close. No welcome-email requirement was requested for the self-service flow; none is added.

## Project Structure

### Documentation (this feature)

```text
.specify/specs/org-admin-onboarding.md
.specify/plans/org-admin-onboarding.md    # this file
.specify/tasks/org-admin-onboarding.md    # Phase 2 output
```

### Source Code (SIMP-BACKEND)

```text
src/
├── constants/
│   └── permissions.ts          # NEW — AVAILABLE_PERMISSIONS (moved) + DEFAULT_ADMIN_PERMISSIONS
├── services/
│   └── rbac.service.ts          # MODIFIED — + ensureAdminRole(tx)
└── controllers/
    ├── admin.controller.ts      # MODIFIED — unconditional ensureAdminRole call
    ├── organization.controller.ts  # MODIFIED — identical fix
    └── role.controller.ts       # MODIFIED — import catalog instead of inline definition
```

**Structure Decision**: Existing directories (`src/constants/`, `src/services/`, `src/controllers/`) — no new architectural pattern, no schema/migration change.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.*
