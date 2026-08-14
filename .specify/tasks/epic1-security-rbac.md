---
description: "Task list for feature: Epic 1 — Security, RBAC & Critical Bugs"
---

# Tasks: Epic 1 — Security, RBAC & Critical Bugs

**Input**: Design documents from `.specify/specs/epic1-security-rbac.md` and `.specify/plans/epic1-security-rbac.md`

**Tests**: No dedicated automated-test tasks. Manual, evidence-based verification per story (two-organization comparison, existing-admin login, concurrent-generation smoke test, boundary-date checks) — matching the spec's Success Criteria. `npm run type-check`/`lint` remain mandatory regression gates in both repos.

**Organization**: Grouped by user story; every task is explicitly labeled **[Backend]** or **[Frontend]** per request.

---

## Phase 1: Setup / Foundational

*(None required — every story reuses existing infrastructure: shared `authenticate` middleware, existing `rbac.service.ts` helpers, existing permission-catalog file. No new dependency, no schema change.)*

---

## Phase 2: User Story 1 - Communications never cross organization boundaries (Priority: P1)

**Goal**: Close the tenant-isolation gap in the Communication module; fail closed if org context is ever missing.

**Independent Test**: Two-organization comparison — Org A user must never see Org B's people or messages via `/recipients`, `/inbox`, `/sent`.

- [ ] [Backend] T001 [US1] In `src/routes/communication.routes.ts`, delete the inline `onRequest` auth hook and register the shared `authenticate` middleware from `@/middleware/auth.middleware.js` instead (as a `preHandler` hook, matching the convention used by `workspace.routes.ts`/`protocol.routes.ts`)
- [ ] [Backend] T002 [US1] In `src/controllers/communication.controller.ts::getRecipients`, replace the conditional-spread org filter with an explicit fail-closed check: if `!request.user.isSuperAdmin` and `request.user.organizationId` is falsy, return `403`; otherwise build `orgFilter` from the confirmed-present `organizationId`
- [ ] [Backend] T003 [US1] Apply the identical fail-closed pattern from T002 to `listInbox` and `listSent` in the same file
- [ ] [Backend] T004 [US1] Manually verify: seed or use two organizations with distinct users; as a non-super-admin in Org A, call `/recipients`, `/inbox`, `/sent` and confirm zero Org B data is returned; confirm a native super admin (no impersonation) still sees cross-org data as before (spec Acceptance Scenario 3 — no regression)

**Checkpoint**: US1 independently verified — Communication module is tenant-isolated and fails closed.

---

## Phase 3: User Story 2 - Organization Admins can use the features their role grants (Priority: P1)

**Goal**: Every permission a route references exists in the catalog; every existing admin-tier user has a working role.

**Independent Test**: Log in as `carlos@gmail.com` (existing admin with zero role rows today) and create a Workspace — must succeed.

- [ ] [Backend] T005 [US2] In `src/constants/permissions.ts`, add a `workspaces` category (`workspaces:read`, `workspaces:write`, `workspaces:manage`) and a `tasks` category (`tasks:read`) to `AVAILABLE_PERMISSIONS`, matching every permission key already referenced in `workspace.routes.ts` and `workspace.controller.ts`/`task.controller.ts` (confirmed complete via full-codebase grep — no other `workspaces:*`/`tasks:*` keys exist uncatalogued)
- [ ] [Backend] T006 [US2] Create `prisma/scripts/backfill-admin-roles.ts`: find every `User` where `isSuperAdmin: false`, `organizationId` is not null, and `roles` is empty (`{ none: {} }`); for each, call `ensureAdminRole()` (from `rbac.service.ts`) and create a `UserRole` linking them, with `assignedBy: 'backfill-epic1'`; log a summary (count fixed, emails) to stdout
- [ ] [Backend] T007 [US2] Run `npx tsx prisma/scripts/backfill-admin-roles.ts` against the local database and confirm `carlos@gmail.com` (and any other admin-less account) now has a `UserRole` row
- [ ] [Backend] T008 [US2] Manually verify: log in as `carlos@gmail.com`, create a Workspace — must succeed and set the creator as `OWNER`; confirm running the backfill script a second time makes no further changes (idempotency, spec Edge Case)

**Checkpoint**: US2 independently verified — both the catalog gap and the existing-data gap are closed.

---

## Phase 4: User Story 3 - Protocol number generation works for every legitimately authorized user (Priority: P2)

**Goal**: Confirm US2's fix resolves protocol generation for existing admins; harden against concurrent-request failures.

**Independent Test**: As `carlos@gmail.com` (fixed by US2), generate a protocol number — must succeed. Fire two near-simultaneous generation requests for the same sector/type/year — neither may return an unhandled 500.

- [ ] [Backend] T009 [US3] Manually verify, after T007–T008: as `carlos@gmail.com`, generate a sequential Comunicação protocol number — expected to now succeed with zero code change, confirming the shared root cause with US2
- [ ] [Backend] T010 [US3] In `src/controllers/protocol.controller.ts`, wrap the existing `prisma.$transaction(..., { isolationLevel: 'Serializable' })` call in `generate()` with a small retry helper that catches Prisma's `P2034` (serialization/write conflict) error code and retries up to 3 times before rethrowing; import `Prisma` from `@prisma/client` for the error-code check
- [ ] [Backend] T011 [US3] Manually verify: submit two protocol-generation requests for the same organization/sector/documentType/year in quick succession (e.g. two terminal `curl` calls fired back-to-back) and confirm both resolve (either succeeding with distinct sequential numbers, or the rare remaining failure returns a clear message, not a bare 500)

**Checkpoint**: US3 independently verified.

---

## Phase 5: User Story 4 - Virtual Process date range must be logically valid (Priority: P3)

**Goal**: Reject an inverted start/end date range, both server-side (source of truth) and client-side (fail-fast UX).

**Independent Test**: Attempt to create a Virtual Process with start date after end date via the API and via the modal — both must reject; valid/partial ranges must still be accepted.

- [ ] [Backend] T012 [US4] In `src/schemas/virtual-process.schemas.ts`, add `.refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, { message: 'A data de início não pode ser posterior à data de encerramento.', path: ['startDate'] })` to `createVirtualProcessSchema`
- [ ] [Frontend] T013 [US4] In `SIMP-FRONTEND/src/pages/processos-virtuais/ProcessosVirtuais.tsx::handleSubmit`, add a check before calling `create(...)`: if both `startDate` and `endDate` are set and `startDate > endDate`, show a destructive toast and return without submitting
- [ ] [Backend] T014 [US4] Manually verify via direct API call: create a Virtual Process with `startDate` after `endDate` → rejected with a validation error; create one with only `startDate`, only `endDate`, or neither → accepted
- [ ] [Frontend] T015 [US4] Manually verify in the "autuar processo" modal: entering an inverted range blocks submission with the toast from T013 before any network request fires (confirm via browser devtools network tab)

**Checkpoint**: US4 independently verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] [Backend] T016 [P] Run `npm run type-check` in `SIMP-BACKEND` and confirm no new errors (`npm run lint` remains blocked — eslint is not installed in this project, a pre-existing gap noted in a prior session)
- [ ] [Frontend] T017 [P] Run `npm run type-check` and `npm run lint` in `SIMP-FRONTEND` and confirm no new errors introduced by T013
- [ ] [Backend] T018 Update `docs/TechStack.md` §11: mark the "RBAC provisioning" line as further closed (existing-account backfill, not just new-account creation) and add a new entry noting the Communication module's duplicated-auth-hook fix, referencing `.specify/specs/epic1-security-rbac.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **US1 (Communications)**, **US2 (Workspaces/RBAC)**, and **US4 (Virtual Process dates)** are fully independent of each other — different files, different modules. Any order, or parallel.
- **US3 (Protocols)** depends on **US2** being complete first (T009 explicitly verifies US2's backfill resolved it before any US3 code change is made).

### Within Each Story

- US1: T001 before T002/T003 (only meaningful to test the controller-level fix once the route no longer has the incomplete duplicate hook) — T004 last.
- US2: T005 before T006 (script needs the new permission keys to exist so `ensureAdminRole()`'s upsert picks them up) — T007 before T008.
- US3: T009 before T010 (confirm the hypothesis before writing hardening code for a problem that might already be solved) — T011 last.
- US4: T012 and T013 can be done in either order (different repos) — T014/T015 last, after both.

### Parallel Opportunities

- US1, US2, and US4 can be implemented in parallel by different people/sessions — no shared files.
- T016 and T017 are `[P]` relative to each other (different repos) but both depend on all implementation tasks being complete.

---

## Notes

- **Total tasks**: 18 (T001–T018) — **14 Backend**, **2 Frontend**, **2 Polish** (one per repo)
- **Per-story breakdown**: US1 (P1, security) 4 tasks · US2 (P1, RBAC) 4 tasks · US3 (P2, verification+hardening) 3 tasks · US4 (P3, validation) 4 tasks · Polish 3 tasks
- **Suggested execution order given priorities**: US1 and US2 first (both P1 — one is a live data-isolation risk, the other blocks real existing admin accounts), then US3 (depends on US2), then US4 (fully independent, lowest severity, can slot in anytime)
- **No Prisma migration in this epic** — Story 2's permission catalog change is a TypeScript constant, not a schema change; the backfill script writes ordinary rows through the existing `UserRole` table
- `prisma/scripts/backfill-admin-roles.ts` is a one-time operational script, not part of the request-serving code path — it is safe to leave in the repo for future re-runs against any environment (e.g. staging) that accumulated pre-fix organizations, since it is idempotent (T008)
