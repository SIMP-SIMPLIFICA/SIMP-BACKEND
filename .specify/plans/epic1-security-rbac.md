# Implementation Plan: Epic 1 — Security, RBAC & Critical Bugs

**Feature**: `epic1-security-rbac` | **Date**: 2026-07-18 | **Spec**: [.specify/specs/epic1-security-rbac.md](../specs/epic1-security-rbac.md)

**Input**: Feature specification from `.specify/specs/epic1-security-rbac.md`

**Note**: Follows the flat-file convention established in prior features. No `.specify/extensions.yml` exists, so no hooks apply.

## Summary

Four independently-shippable fixes, investigated against current source and (where applicable) live local data:

1. **Communication leak** — `communication.routes.ts` defines its own inline `onRequest` auth hook, duplicating ~90% of the shared `authenticate()` middleware in `auth.middleware.ts` but **omitting** its `organizationId`/`isSuperAdmin` undefined-normalization. Prisma treats an `undefined` value in a `where` clause as "no filter on this field" (different from `null`, which filters for actual nulls) — so any code path where `request.user.organizationId` reaches the controller as `undefined` silently drops the org filter in `getRecipients`/`listInbox`/`listSent`. No leaked data exists yet in the local DB (verified — 0 rows in `document_recipients` joined against `communication_documents`), so this is a verified *code* defect, not one reproduced against live leaked data; it is nonetheless the single well-evidenced candidate and is fixed regardless, both by removing the duplicated hook and by making the queries fail closed.

2. **Workspaces broken for Org Admin** — two compounding causes, both verified:
   - `workspace.routes.ts` and `workspace.controller.ts` gate on `workspaces:read`/`workspaces:write`/`workspaces:manage`/`tasks:read`, none of which exist in `src/constants/permissions.ts`'s `AVAILABLE_PERMISSIONS`. No role — including the "admin" role built in the `org-admin-onboarding` feature — can ever be granted a permission that isn't in the catalog it's derived from.
   - Live DB query: `carlos@gmail.com` (admin of "PREFEITURA DE PEQUIZEIRO") has **zero** `UserRole` rows. That organization was created before the `org-admin-onboarding` fix; `ensureAdminRole()` only runs inside the *creation* transaction, so it never touched this pre-existing account. This is very likely the actual account being used to test this bug.

3. **Protocol generation** — `protocol.controller.ts::generate` reviewed end-to-end: the sequence upsert is inside a `Serializable` transaction keyed correctly against `SequenceControl`'s compound unique constraint, and `protocols:write`/`protocols:admin` already exist in the catalog. No code defect found. Leading hypothesis: same root cause as #2 — an admin with zero permissions (like `carlos@gmail.com`) gets a 403 from `requireAnyPermission(['protocols:write','protocols:admin'])`, which may read as "generation is broken" without inspecting the response. Secondary, lower-probability hardening target: an unhandled Postgres serialization-failure (`40001`) under concurrent submissions to the same sequence, which today falls through to a generic 500.

4. **Virtual Process date validation** — confirmed absent on both sides: `virtual-process.schemas.ts`'s `createVirtualProcessSchema` validates `startDate`/`endDate` independently (no `.refine()`); `ProcessosVirtuais.tsx`'s `handleSubmit` performs no date check before calling `create()`.

## Technical Context

**Language/Version**: TypeScript 5.9, Fastify 5, Prisma 6.19 (backend); React 19 (frontend, Story 4 only)

**Primary Dependencies**: existing `authenticate` middleware, existing `rbac.service.ts` (`userHasPermission`, `getUsersWithPermission`, `ensureAdminRole`), existing `constants/permissions.ts` (from `org-admin-onboarding`), Zod (schema validation)

**Storage**: PostgreSQL — no new tables; one data-repair script (Story 2 backfill) writing `UserRole` rows for existing users, no schema/migration change

**Testing**: Manual, evidence-based verification per story (two-org comparison for Story 1, existing-admin login for Story 2, generation-under-load smoke test for Story 3, boundary-date form/API tests for Story 4); `npm run type-check`/`lint` as regression gates in both repos

**Target Platform**: Backend for Stories 1–3; Backend + Frontend for Story 4

**Constraints**: Story 2's backfill must be idempotent (spec Edge Case) — safe to run more than once, must not duplicate `UserRole` rows for already-correctly-linked admins. Story 1's fix must not regress native super-admin cross-org visibility (spec Acceptance Scenario 3).

**Scale/Scope**: 4 backend files modified + 1 new one-time script (Story 1–3); 2 files modified, one frontend + one backend (Story 4)

## Constitution Check

| Principle | Applicable? | Assessment |
|---|---|---|
| I. Local-First & Zero Cloud Credentials | No | No env/infra surface touched. |
| II. Supabase Prohibition | No | Not touched. |
| III. Municipal Domain Integrity | Partially | Protocol numbering (Story 3) has legal/auditability weight per the constitution — the fix must not introduce number-reuse or skipped sequence numbers under concurrency; the hardening in Decision 6 is designed specifically to preserve this. |
| IV. Multi-Tenant & Module-Gated Architecture | **Yes** | This epic *is* Principle IV enforcement: Story 1 closes a tenant-isolation gap, Story 2 closes an RBAC provisioning gap (continuing the `org-admin-onboarding` work), and both are exactly the "unify triplicated auth/RBAC logic" item already tracked in `TechStack.md` §11. |
| V. Spec-Driven Development | **Yes** | Fourth feature executed under the formal Spec Kit flow. |
| VI. Environment & Security Baseline | **Yes** | Story 1 is a direct security-baseline fix (data isolation); Story 2's fail-fast philosophy (every referenced permission must exist in the catalog) extends the same "no silent gaps" principle already applied to environment config in Fase 0. |

**Result**: PASS. No violations; Municipal Domain Integrity flagged for extra care in Story 3, not blocked.

## Architecture Decisions

### Decision 1 (Story 1) — Replace `communication.routes.ts`'s inline auth hook with the shared `authenticate` middleware

```ts
// before
app.addHook('onRequest', async (request, reply) => {
  try {
    await request.jwtVerify()
    const user = request.user as any
    if (user && user.sub && !user.id) user.id = user.sub
  } catch (err) { reply.send(err) }
})

// after
import { authenticate } from '@/middleware/auth.middleware.js'
app.addHook('preHandler', authenticate)
```

**Rationale**: `authenticate` already normalizes `organizationId`/`isSuperAdmin` and handles the SSE-query-token case; removing the duplicate is both the security fix and a direct instance of consolidating the triplicated-auth-logic debt already tracked in `TechStack.md` §11.

### Decision 2 (Story 1) — Fail closed on missing org context, defense-in-depth

In `communication.controller.ts`, replace the conditional-spread pattern:

```ts
// before (Prisma silently drops the filter if organizationId is undefined)
...(!request.user.isSuperAdmin && { organizationId: request.user.organizationId })

// after
const orgId = request.user.organizationId
if (!request.user.isSuperAdmin) {
  if (!orgId) return reply.code(403).send({ error: 'Forbidden', message: 'Organização não identificada.' })
}
const orgFilter = request.user.isSuperAdmin ? {} : { organizationId: orgId }
```

Applied to `getRecipients`, `listInbox`, `listSent` (the three read paths named in FR-001/FR-002). `create`, `getById`, `update`, `delete`, `downloadAttachment` already use the safe `isSuperAdmin ? {} : { organizationId }` ternary pattern (verified) and need no change.

**Rationale**: even after Decision 1, this makes the isolation guarantee independent of any one call site correctly normalizing the token — matching this epic's "fail closed, not silently unscoped" requirement (FR-002), and matching the pattern already used correctly elsewhere in the same file.

### Decision 3 (Story 2) — Add the missing permission categories to the catalog

In `src/constants/permissions.ts`, add:

```ts
workspaces: {
  displayName: 'Workspaces (Kanban)',
  permissions: [
    { key: 'workspaces:read',   description: 'Visualizar workspaces e suas tarefas', level: 'read' },
    { key: 'workspaces:write',  description: 'Criar novos workspaces',                level: 'write' },
    { key: 'workspaces:manage', description: 'Gerenciar membros e excluir workspaces', level: 'admin' },
  ]
},
tasks: {
  displayName: 'Tarefas',
  permissions: [
    { key: 'tasks:read', description: 'Ser listado como responsável atribuível em tarefas', level: 'read' },
  ]
},
```

Because `DEFAULT_ADMIN_PERMISSIONS` is *derived* from `AVAILABLE_PERMISSIONS` (`org-admin-onboarding`, Decision 1), this alone makes every future `ensureAdminRole()` upsert include the new keys — no change needed in `rbac.service.ts` itself. This directly satisfies FR-004 ("every permission a route references must exist in the catalog") for the keys this epic found; it does not attempt to design a complete future permission taxonomy (spec Assumptions).

### Decision 4 (Story 2) — One-time backfill script for existing admin-less accounts

New script `prisma/scripts/backfill-admin-roles.ts` (run manually via `tsx`, not part of the request path):

```ts
// Pseudocode — full implementation in tasks.md
const orgAdmins = await prisma.user.findMany({
  where: { isSuperAdmin: false, organizationId: { not: null }, roles: { none: {} } },
})
for (const user of orgAdmins) {
  const adminRole = await ensureAdminRole(prisma) // same helper, called outside a $transaction wrapper this time
  await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id, assignedBy: 'backfill-epic1' } })
}
```

**Rationale**: `ensureAdminRole()` (from `org-admin-onboarding`) only ever runs inside the org-creation transaction — it has no reason to run for existing users. This script is the explicit, auditable, one-time reconciliation the spec's FR-006 requires. It targets `roles: { none: {} }` (zero `UserRole` rows) specifically — not "every non-super-admin," so it is idempotent by construction (a user who already has *any* role, correct or not, is left alone rather than double-assigned). `assignedBy: 'backfill-epic1'` makes the origin of these specific assignments auditable later, distinct from `'super-admin'`/`'system'` used by the live creation flows.

**Scope note**: this backfill grants the full "admin" role to every currently admin-less org member. This is intentional and matches the spec (these accounts are, by construction, meant to be their organization's administrator) — it is not a general-purpose "give everyone admin" script, and it only touches users with zero existing role rows.

### Decision 5 (Story 3) — No code change to `generate()`'s core logic; verification only

Per the spec, Story 3 is verification-led: once Decision 4's backfill lands, re-test protocol generation as an existing admin (e.g. `carlos@gmail.com`). If it now succeeds, FR-007 is satisfied with zero additional code change.

### Decision 6 (Story 3) — Harden the Serializable transaction against concurrent-conflict errors

```ts
// protocol.controller.ts::generate, wrapping the existing $transaction call
async function withSerializableRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() }
    catch (err) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
      if (!isSerializationConflict || i === attempts - 1) throw err
    }
  }
  throw new Error('unreachable')
}
```

Prisma surfaces a Postgres serialization failure as `P2034` ("Transaction failed due to a write conflict or a deadlock. Please retry your transaction") specifically for interactive transactions — retrying a handful of times is the documented, standard mitigation, and is safe here because the transaction is a pure upsert-and-increment with no side effects outside itself. This satisfies FR-008 without weakening the atomicity guarantee that keeps protocol numbers legally sound (Constitution Principle III).

### Decision 7 (Story 4) — Cross-field date validation, both layers

Backend (`virtual-process.schemas.ts`), source of truth:

```ts
export const createVirtualProcessSchema = z.object({
  // ...existing fields unchanged...
}).strip().refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: 'A data de início não pode ser posterior à data de encerramento.', path: ['startDate'] }
)
```

Frontend (`ProcessosVirtuais.tsx`'s `handleSubmit`), fail-fast UX before any network call:

```ts
if (startDate && endDate && startDate > endDate) {
  toast({ title: 'Datas inválidas', description: 'A data de início não pode ser posterior à data de encerramento.', variant: 'destructive' })
  return
}
```

**Rationale**: backend `.refine()` is the actual guarantee (FR-009/FR-010, matches every other cross-field rule pattern already used with Zod elsewhere in this codebase); the frontend check is UX-only, matching the constitution's testable-requirements bar without duplicating validation logic beyond a simple, obviously-correct comparison.

## Project Structure

### Documentation (this feature)

```text
.specify/specs/epic1-security-rbac.md
.specify/plans/epic1-security-rbac.md   # this file
.specify/tasks/epic1-security-rbac.md   # Phase 2 output
```

### Source Code

```text
SIMP-BACKEND/
├── src/middleware/auth.middleware.ts          # unchanged — reused, not modified
├── src/routes/communication.routes.ts         # MODIFIED — Decision 1
├── src/controllers/communication.controller.ts # MODIFIED — Decision 2
├── src/constants/permissions.ts               # MODIFIED — Decision 3
├── prisma/scripts/backfill-admin-roles.ts     # NEW — Decision 4
├── src/controllers/protocol.controller.ts     # MODIFIED — Decision 6
├── src/schemas/virtual-process.schemas.ts     # MODIFIED — Decision 7 (backend half)

SIMP-FRONTEND/
└── src/pages/processos-virtuais/ProcessosVirtuais.tsx  # MODIFIED — Decision 7 (frontend half)
```

**Structure Decision**: no new directories except `prisma/scripts/` (a natural home for one-time maintenance scripts, parallel to `prisma/seeds/`); no schema/migration change anywhere in this epic.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.* Decision 6's retry wrapper is a small, bounded, well-precedented pattern (documented Prisma mitigation for `P2034`), not treated as a complexity violation.
