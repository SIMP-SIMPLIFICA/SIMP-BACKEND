---
description: "Task list for feature: Super Admin Onboarding & Navigation UX"
---

# Tasks: Super Admin Onboarding & Navigation UX

**Input**: Design documents from `.specify/specs/super-admin-onboarding-ux.md` and `.specify/plans/super-admin-onboarding-ux.md`

**Tests**: Not included as dedicated automated-test tasks — manual, account-type-based verification is used instead (native super admin / impersonated / regular user), matching the spec's Success Criteria.

**Organization**: Tasks are grouped by user story, and each task is explicitly labeled **[Backend]** or **[Frontend]** per the user's request.

---

## Backend tasks (User Story 1) — inherited, not duplicated

User Story 1 ("every organization has a working administrator") is fully planned and broken into tasks already in [`.specify/tasks/org-admin-onboarding.md`](./org-admin-onboarding.md). Its 9 tasks (T001–T009) are reproduced here **by reference only** — implementing them satisfies User Story 1 of both this document and `org-admin-onboarding.md`; there is only one implementation to do, not two.

| Task (from org-admin-onboarding.md) | File |
|---|---|
| T001 Extract `AVAILABLE_PERMISSIONS` + `DEFAULT_ADMIN_PERMISSIONS` | `[Backend]` `src/constants/permissions.ts` (new) |
| T002 Import catalog in `role.controller.ts` | `[Backend]` `src/controllers/role.controller.ts` |
| T003 Add `ensureAdminRole(tx)` | `[Backend]` `src/services/rbac.service.ts` |
| T004 Unconditional role linkage in admin flow | `[Backend]` `src/controllers/admin.controller.ts` |
| T005 Unconditional role linkage in self-service flow | `[Backend]` `src/controllers/organization.controller.ts` |
| T006 Verify no-password-in-response + email still hold | `[Backend]` (verification only) |
| T007 Verify self-service flow's role linkage | `[Backend]` (verification only) |
| T008 `type-check` + `lint` (backend) | `[Backend]` |
| T009 Update `TechStack.md` §11 | `[Backend]` `docs/TechStack.md` |

**No form changes are required** — confirmed with the user: `AdminNewOrganizationPage.tsx` already collects Nome/Sobrenome/E-mail and correctly leaves password generation to the backend; no manual password field is added.

---

## Frontend tasks (User Story 2) — new work in this feature

### Phase 1: Setup / Foundational

*(None needed — no new hook, no new dependency; this is a targeted edit to existing render logic in one file.)*

### Phase 2: User Story 2 - Super Admin sees only administrative navigation when operating globally (Priority: P2)

**Goal**: Native super-admin sessions show exactly 3 admin items; impersonated and regular sessions are unaffected.

**Independent Test**: Log in as the seeded super admin (no impersonation) → sidebar shows only "Painel Admin", "Suporte", "Configurações Globais". Start impersonating an org → full tenant nav appears. Log in as a regular org user → nav unchanged from before this feature.

- [ ] [Frontend] T010 [US2] In `SIMP-FRONTEND/src/components/layout/Sidebar.tsx`, add a third `NavLink` to the existing "Super Admin shortcut" `<div>` block (same style as the existing "Painel Admin"/"Suporte" links), pointing to `/configuracoes`, labeled "Configurações Globais"
- [ ] [Frontend] T011 [US2] In `SIMP-FRONTEND/src/components/layout/Sidebar.tsx`, wrap the `{NAV_SECTIONS.map((section) => { ... })}` block in `{!isSuperAdmin && ( ... )}` so it never renders for a native super-admin session
- [ ] [Frontend] T012 [US2] In `SIMP-FRONTEND/src/components/layout/Sidebar.tsx`, simplify `filterItems`: remove the now-unreachable `!isSuperAdmin &&` guards — the `/organizacao` special case becomes `return !!orgName ? item : null`, the module check becomes `if (item.module && !enabledModules.includes(item.module)) return null`, the permission check becomes `if (item.anyOf) { ... }` (drop the `&& !isSuperAdmin`), and the children-module filter becomes `(c) => !c.module || enabledModules.includes(c.module)` (drop `isSuperAdmin ||`)

**Checkpoint**: User Story 2 independently functional and testable across all three account types.

### Phase 3: Polish

- [ ] [Frontend] T013 [P] Run `npm run type-check` and `npm run lint` in `SIMP-FRONTEND` and confirm no new errors
- [ ] [Frontend] T014 Manually verify the three scenarios in the spec's Acceptance Scenarios (native super admin, impersonated, regular Org Admin/Member) side by side before marking this feature done

---

## Dependencies & Execution Order

- **Backend (T001–T009)** and **Frontend (T010–T014)** are fully independent of each other — different repos, different files, no shared code path. They can be implemented in either order or in parallel.
- Within Frontend: T010 and T011 both edit `Sidebar.tsx` but in different, non-overlapping regions (the shortcut block vs. the `NAV_SECTIONS` wrapper) — do them in either order, but **T012 should come after T011** conceptually, since T012's simplifications only make sense once T011 has made the bypassed branches provably unreachable (implementing T012 first, before T011 exists, would remove filtering that is still momentarily load-bearing).
- T013/T014 depend on T010–T012 being complete.

## Notes

- **Total new tasks in this document**: 5 (T010–T014), all Frontend, all in one file (`Sidebar.tsx`)
- **Total tasks across the whole initiative** (this feature + inherited `org-admin-onboarding`): 14 (T001–T014) — 9 Backend (already approved, not yet implemented), 5 Frontend (new, this document)
- Suggested execution order given they're independent: **Backend first** (closes the more severe, functional "no admin found" bug), then **Frontend** (closes the UX/clarity defect) — but either order is safe to implement
- No Prisma migration, no new dependency, no new file in the frontend half of this initiative
