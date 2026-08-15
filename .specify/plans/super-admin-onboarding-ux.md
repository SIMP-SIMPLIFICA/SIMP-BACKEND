# Implementation Plan: Super Admin Onboarding & Navigation UX

**Feature**: `super-admin-onboarding-ux` | **Date**: 2026-07-17 | **Spec**: [.specify/specs/super-admin-onboarding-ux.md](../specs/super-admin-onboarding-ux.md)

**Input**: Feature specification from `.specify/specs/super-admin-onboarding-ux.md`

**Note**: Follows the flat-file convention established in `mobile-nav-fix` and `org-admin-onboarding`. No `.specify/extensions.yml` exists, so no hooks apply.

## Summary

This plan covers **only** User Story 2 (Sidebar navigation gating). User Story 1 (organization admin linkage) is fully planned in [`.specify/plans/org-admin-onboarding.md`](./org-admin-onboarding.md) — its Architecture Decisions, Constitution Check, and file list are inherited unchanged and are not repeated here. The reason it is not re-planned: it is the identical backend defect against the identical code, and duplicating the plan would create two documents that could drift out of sync with each other.

`Sidebar.tsx` currently renders the "Super Admin shortcut" block (Painel Admin, Suporte) unconditionally alongside the full `NAV_SECTIONS` list whenever `isSuperAdmin` is true — because `filterItems`'s module and permission checks are explicitly bypassed for super admins (`!isSuperAdmin && item.module …`, `item.anyOf && !isSuperAdmin`). This was presumably intended to let a super admin see everything while impersonating, but it also fires for a **native** super-admin session (no impersonation), which is the actual bug: every business-module and tenant-management nav item leaks into a context where none of it applies.

Verified: impersonation issues an access token representing the **impersonated admin's own identity** (`isSuperAdmin: false` is passed explicitly to `generateAccessToken` in `admin.controller.ts::impersonate`), not a client-side toggle on top of the super admin's session. This means the existing `isSuperAdmin` value from `useMe()` already correctly distinguishes "native super admin, no org" (`true`) from "impersonating" (`false`, because at that point the session *is* the target org's admin). No new state needs to be introduced — the fix is to stop bypassing the filters for `isSuperAdmin`, and instead gate the entire tenant-navigation block behind `!isSuperAdmin`.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19 (`SIMP-FRONTEND` only for this plan's scope)

**Primary Dependencies**: none new — reuses existing `useMe()`, existing `NAV_SECTIONS`/`filterItems` structures in `Sidebar.tsx`

**Storage**: N/A

**Testing**: Manual verification with three account types — native super admin, impersonated session, regular Org Admin/Org Member — per the spec's Success Criteria. `npm run type-check`/`lint` as regression gates.

**Target Platform**: Web SPA frontend only; no backend change for this user story

**Constraints**: Must not regress impersonation (FR-009) or non-super-admin navigation (FR-010) — both are existing, working behaviors that must be provably unchanged, not just "probably fine."

**Scale/Scope**: 1 file modified (`src/components/layout/Sidebar.tsx`); 0 new files; 0 backend files (this user story is frontend-only)

## Constitution Check

| Principle | Applicable? | Assessment |
|---|---|---|
| I. Local-First & Zero Cloud Credentials | No | Frontend-only, no infra/credential surface. |
| II. Supabase Prohibition | No | Not touched. |
| III. Municipal Domain Integrity | No | Not touched. |
| IV. Multi-Tenant & Module-Gated Architecture | **Yes** | This *is* the principle at stake: navigation must reflect module/permission scoping correctly, including the platform-vs-tenant boundary between Super Admin and Org Admin/Member — a boundary the current bypass logic blurs. |
| V. Spec-Driven Development | **Yes** | Third feature executed under the formal Spec Kit flow; first to explicitly reference and build on a prior feature's spec rather than duplicating it. |
| VI. Environment & Security Baseline | No | No env/config/secret handling involved. |

**Result**: PASS, no violations.

## Architecture Decisions

### Decision 1 — Gate `NAV_SECTIONS` rendering behind `!isSuperAdmin`, not inside `filterItems`

In the render body, wrap the existing `{NAV_SECTIONS.map((section) => { ... })}` block in `{!isSuperAdmin && ( ... )}`. A native super admin sees only the (extended) "Super Admin shortcut" block; everyone else — including an impersonated super-admin session, where `isSuperAdmin` is already `false` — sees `NAV_SECTIONS` exactly as today.

**Rationale**: gating at the top level, rather than inside `filterItems`, makes the access-tier boundary explicit and easy to audit (`grep` for `NAV_SECTIONS.map` finds exactly one call site, now visibly conditioned) instead of relying on several scattered `!isSuperAdmin &&` checks whose combined effect was easy to get wrong (as the current bug demonstrates).

### Decision 2 — Simplify `filterItems` by removing the now-dead super-admin bypasses

Once `NAV_SECTIONS` is only ever passed through `filterItems` for non-super-admin sessions, the `!isSuperAdmin &&` guards inside it (module check, permission check, the `/organizacao` special case, and the children-module filter's `isSuperAdmin ||` clause) are unreachable for `isSuperAdmin === true`. Remove them:

```ts
// before
if (item.to === "/organizacao") return (!!orgName && !isSuperAdmin) ? item : null;
if (!isSuperAdmin && item.module && !enabledModules.includes(item.module)) return null;
if (item.anyOf && !isSuperAdmin) { ... }
...c.module || isSuperAdmin || enabledModules.includes(c.module)

// after
if (item.to === "/organizacao") return !!orgName ? item : null;
if (item.module && !enabledModules.includes(item.module)) return null;
if (item.anyOf) { ... }
...c.module || enabledModules.includes(c.module)
```

**Rationale**: dead conditional branches left in place are exactly the kind of stale logic that caused this bug's sibling issues to be hard to reason about; removing them is a direct, minimal application of "código limpo," not a speculative refactor — the function's only remaining caller path is the non-super-admin one.

### Decision 3 — Extend the Super Admin shortcut block with "Configurações Globais"

Add a third `NavLink` to the existing shortcut block (same visual treatment as "Painel Admin"/"Suporte" already there), pointing to `/configuracoes` (existing route, already permission-gated with a `system:admin` bypass, currently only reachable by direct URL with no sidebar entry).

**Rationale**: satisfies FR-008 without inventing a new page — the destination already exists as a stub; this feature only adds the missing navigational path to it.

### Decision 4 — No backend change in this plan

User Story 1's backend fix (`ensureAdminRole`, transaction updates in `admin.controller.ts`/`organization.controller.ts`) is entirely covered by the already-approved `org-admin-onboarding.md` plan and tasks. This plan adds nothing to it and does not duplicate its file list.

## Project Structure

### Documentation (this feature)

```text
.specify/specs/super-admin-onboarding-ux.md
.specify/plans/super-admin-onboarding-ux.md   # this file
.specify/tasks/super-admin-onboarding-ux.md   # Phase 2 output
```

### Source Code

```text
SIMP-FRONTEND/src/components/layout/Sidebar.tsx   # MODIFIED — only file touched by this plan

# Inherited from org-admin-onboarding.md (not re-touched by this plan, referenced only):
SIMP-BACKEND/src/constants/permissions.ts          # (new, per org-admin-onboarding tasks)
SIMP-BACKEND/src/services/rbac.service.ts           # (modified, per org-admin-onboarding tasks)
SIMP-BACKEND/src/controllers/admin.controller.ts    # (modified, per org-admin-onboarding tasks)
SIMP-BACKEND/src/controllers/organization.controller.ts  # (modified, per org-admin-onboarding tasks)
SIMP-BACKEND/src/controllers/role.controller.ts     # (modified, per org-admin-onboarding tasks)
```

**Structure Decision**: No new files, no new directories for User Story 2. User Story 1's file list is unchanged from the prior plan.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.*
