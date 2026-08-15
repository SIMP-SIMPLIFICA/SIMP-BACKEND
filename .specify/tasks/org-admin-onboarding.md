---
description: "Task list for feature: Organization Admin Onboarding"
---

# Tasks: Organization Admin Onboarding

**Input**: Design documents from `.specify/specs/org-admin-onboarding.md` and `.specify/plans/org-admin-onboarding.md`

**Prerequisites**: plan.md (required, present), spec.md (required, present)

**Tests**: Not included as dedicated automated-test tasks. Manual verification tasks are used instead (create org → impersonate → check email/response), matching the spec's Success Criteria. Automated regression is covered by the existing `npm run type-check`/`lint` gates.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are relative to `SIMP-BACKEND/`

---

## Phase 1: Setup

**Purpose**: Establish a single, shared permission catalog before any controller is touched.

- [ ] T001 Create `src/constants/permissions.ts`: move `AVAILABLE_PERMISSIONS` out of `src/controllers/role.controller.ts` unchanged, export it, and add `export const DEFAULT_ADMIN_PERMISSIONS: string[]` containing every permission key from `AVAILABLE_PERMISSIONS` except `system:admin`
- [ ] T002 Update `src/controllers/role.controller.ts` to `import { AVAILABLE_PERMISSIONS } from '@/constants/permissions.js'` and delete the now-duplicated inline object

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Provide the one transaction-safe helper both org-creation controllers will call.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Add `export async function ensureAdminRole(tx: Prisma.TransactionClient): Promise<{ id: string }>` to `src/services/rbac.service.ts`, upserting the global `admin` system role (`name: 'admin'`, `displayName: 'Administrador'`, `isSystem: true`, `permissions: DEFAULT_ADMIN_PERMISSIONS` from T001) via `tx.role.upsert(...)`

**Checkpoint**: The shared role-provisioning helper exists and is unit-testable in isolation via `npm run type-check`, but nothing calls it yet.

---

## Phase 3: User Story 1 - Every newly created organization has a working administrator (Priority: P1) 🎯 MVP

**Goal**: Both organization-creation entry points guarantee a fully-permissioned admin `UserRole` linkage, unconditionally.

**Independent Test**: Create an organization via the admin panel; immediately impersonate its admin — must succeed with no "no active admin found" error.

### Implementation for User Story 1

- [ ] T004 [US1] In `src/controllers/admin.controller.ts::createOrganization`, replace `const adminRole = await tx.role.findFirst({ where: { name: 'admin' } })` + the `if (adminRole) { ... }` conditional around the `tx.userRole.create(...)` call with an unconditional `const adminRole = await ensureAdminRole(tx)` followed by the same `tx.userRole.create(...)` call (no longer inside a conditional); import `ensureAdminRole` from `@/services/rbac.service.js`
- [ ] T005 [US1] In `src/controllers/organization.controller.ts::create`, apply the identical replacement (same import, same unconditional pattern, keep the existing `assignedBy: 'system'` literal)

**Checkpoint**: User Story 1 is independently testable — create an org via either entry point, then impersonate/log in as its admin.

---

## Phase 4: User Story 2 - Admin receives credentials securely (Priority: P2)

**Goal**: Confirm the existing (Fase 0) no-password-in-response and email-delivery guarantees still hold after T004.

**Independent Test**: Create an org via the admin panel; inspect the HTTP response body (no password field); check MailHog for the temp-password email.

### Implementation for User Story 2

- [ ] T006 [US2] Manually verify, after T004, that `admin.controller.ts::createOrganization`'s response still omits any password field and that `emailService.sendTempPasswordEmail` is still called — no code change expected; if either regressed, fix it in `src/controllers/admin.controller.ts`

**Checkpoint**: User Story 2 confirmed — this story requires no new code if T004 was applied as a pure replacement (it does not touch the email/response-shaping lines already in place since Fase 0).

---

## Phase 5: User Story 3 - Same guarantee for public self-service signup (Priority: P3)

**Goal**: Confirm the public, unauthenticated signup endpoint independently satisfies User Story 1's guarantee.

**Independent Test**: Call `POST /api/v1/organizations` directly (e.g. via curl/Postman, since no frontend page exists yet) with a self-chosen admin password; verify the resulting admin has a working `UserRole` → `admin` linkage.

### Implementation for User Story 3

- [ ] T007 [US3] Manually verify, after T005, that a request to `POST /api/v1/organizations` produces an admin user with a `UserRole` row pointing at the `admin` role, by inspecting the database (e.g. via pgAdmin at `http://localhost:5050`) immediately after the call

**Checkpoint**: All three user stories independently functional and verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T008 [P] Run `npm run type-check` and `npm run lint` in `SIMP-BACKEND` and confirm no new errors
- [ ] T009 Update `docs/TechStack.md` §11's RBAC-consolidation P1 entry to note that role *provisioning* (not just *resolution*) has been consolidated, referencing `.specify/specs/org-admin-onboarding.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001 (needs `DEFAULT_ADMIN_PERMISSIONS`) — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2
- **User Story 2 (Phase 4)**: Depends on T004 specifically (verifies behavior around the same code T004 touches)
- **User Story 3 (Phase 5)**: Depends on T005 specifically
- **Polish (Phase 6)**: Depends on all user stories being complete

### Within Each Phase

- T001 before T002 (constants file must exist before `role.controller.ts` can import from it)
- T001 before T003 (helper needs `DEFAULT_ADMIN_PERMISSIONS`)
- T003 before T004 and T005 (both controllers call the helper)
- T004 and T005 touch different files and have no dependency on each other — either order is fine

### Parallel Opportunities

- T004 and T005 touch different files (`admin.controller.ts` vs. `organization.controller.ts`) and could be marked `[P]` relative to each other, but both strictly require T003 first
- T008 is marked `[P]` (independent of T009) but both depend on all prior phases

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003) — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T004–T005)
4. **STOP and VALIDATE**: create an organization via the admin panel and confirm impersonation succeeds immediately
5. This alone closes the reported defect ("Nenhum admin ativo encontrado")

### Incremental Delivery

1. Setup + Foundational → shared role-provisioning helper ready, nothing user-visible yet
2. User Story 1 → MVP: every new organization gets a working admin (the core fix)
3. User Story 2 → confirm security guarantees untouched (expected to require zero new code)
4. User Story 3 → confirm the public signup entry point independently benefits from the same fix
5. Polish → type-check/lint gate + documentation closure

## Notes

- Total tasks: **9** (T001–T009)
- Per-story breakdown: Setup 2, Foundational 1, US1 2, US2 1 (verification), US3 1 (verification), Polish 2
- Suggested MVP scope: **User Story 1** (T001–T005) — 5 tasks, 4 files touched (1 new)
- No Prisma schema change and no new migration in this feature — confirmed in `plan.md` as a data/logic defect, not a schema gap
- Commit after each task or logical group, per standard project practice
