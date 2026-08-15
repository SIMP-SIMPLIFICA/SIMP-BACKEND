# Implementation Plan: Mobile Navigation Drawer Fix

**Feature**: `mobile-nav-fix` | **Date**: 2026-07-17 | **Spec**: [.specify/specs/mobile-nav-fix.md](../specs/mobile-nav-fix.md)

**Input**: Feature specification from `.specify/specs/mobile-nav-fix.md`

**Note**: This plan was produced by manually following `.github/agents/speckit.plan.agent.md`'s workflow. The feature-directory/branch automation in that file (`setup-plan.sh`, numbered `specs/NNN-name/` folders) assumes the full Spec Kit CLI; per explicit instruction this feature uses flat files under `.specify/{specs,plans,tasks}/mobile-nav-fix.md` instead. No `.specify/extensions.yml` exists in this repo, so no pre/post hooks apply.

## Summary

Wire up navigation on viewports narrower than 1024px. The mobile drawer UI in `Sidebar.tsx` is already fully built (backdrop, slide-in panel, close button, route-change auto-close) but is unreachable because `AppLayout.tsx` never supplies the `mobileOpen`/`setMobileOpen` props it accepts, and `Topbar.tsx` has no control to open it. The technical approach is pure wiring: a new `useMediaQuery` hook, `mobileOpen` state lifted to `AppLayout`, and a hamburger trigger added to `Topbar`. `Sidebar.tsx` itself requires no code changes.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19 (SIMP-FRONTEND)

**Primary Dependencies**: Vite 7, Tailwind CSS 3.4 (existing `lg:` breakpoint utilities), lucide-react (existing icon set — `Menu` icon for the trigger, matching the `X` icon already used for the drawer's close button)

**Storage**: N/A — no persisted state; drawer open/closed is transient UI state

**Testing**: Manual browser verification at defined viewport widths (375px, 768px, 1023px, 1024px, 1280px), per Success Criteria in the spec; `npm run type-check` / `npm run lint` as automated regression gates. No new automated UI tests are introduced — see Complexity Tracking for why this is not a constitution violation.

**Target Platform**: Web SPA (all modern browsers), responsive from 375px up

**Project Type**: web — frontend only (`SIMP-FRONTEND`); **no changes to `SIMP-BACKEND`**

**Performance Goals**: Drawer open/close animation completes within the existing 300ms `transition-transform` already coded in `Sidebar.tsx` (unchanged); no additional network or render-blocking work introduced

**Constraints**: Must not modify `SIMP-BACKEND` (this is a pure frontend fix); must not regress existing desktop sidebar behavior (collapse/expand rail, hover flyout submenus); must preserve exact module/permission filtering parity between mobile and desktop nav (Constitution Principle IV)

**Scale/Scope**: 2 files modified (`AppLayout.tsx`, `Topbar.tsx`), 1 file added (`useMediaQuery.ts`), 0 files touched in `Sidebar.tsx` or in the backend

## Constitution Check

*Gate: evaluated before task generation.*

| Principle | Applicable? | Assessment |
|---|---|---|
| I. Local-First & Zero Cloud Credentials | No | Pure frontend interaction fix; no environment variable, credential, or infra surface touched. |
| II. Supabase Prohibition | No | No auth, database, or Supabase-adjacent code touched. |
| III. Municipal Domain Integrity | No | No financial, protocol-numbering, council, or signature logic touched. |
| IV. Multi-Tenant & Module-Gated Architecture | **Yes** | The drawer reuses the exact same `sidebarContent` JSX (and its `filterItems` module/permission logic) as the desktop sidebar — see Decision 4 below. This is what makes FR-006 (parity) satisfied by construction rather than by parallel reimplementation. |
| V. Spec-Driven Development | **Yes** | This is the first feature executed under the formal `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` flow, per the ratified constitution. |
| VI. Environment & Security Baseline | No | No env/config change. |

**Result**: PASS, no violations. No entries required in Complexity Tracking.

## Architecture Decisions

### Decision 1 — New hook: `src/hooks/useMediaQuery.ts`

```ts
function useMediaQuery(query: string): boolean
```

Wraps `window.matchMedia(query)`, subscribes to its `change` event, and returns the current match state; cleans up the listener on unmount. No such hook exists anywhere in the codebase today — this is the missing "hook boundary" identified in the earlier audit that explains why the already-built drawer markup was never wired to a trigger.

**Rationale**: needed for more than just hiding/showing the hamburger button (that part is pure CSS, `lg:hidden`, same pattern already used in `Sidebar.tsx`). It is needed to reset stale `mobileOpen` state when the viewport crosses back into desktop width (see User Story 3 / Edge Cases in the spec) — a correctness concern, not decoration.

### Decision 2 — Lift `mobileOpen` state to `AppLayout.tsx`

`AppLayout` is the common parent of `Sidebar` and `Topbar`, so it is the natural owner of state shared between the two siblings (the trigger lives in `Topbar`, the drawer lives in `Sidebar`).

```tsx
const [mobileOpen, setMobileOpen] = useState(false);
const isDesktop = useMediaQuery('(min-width: 1024px)');
useEffect(() => { if (isDesktop) setMobileOpen(false); }, [isDesktop]);
```

`mobileOpen`/`setMobileOpen` are passed to `<Sidebar>` (props it already declares and consumes — `SidebarProps` in `Sidebar.tsx` — but which `AppLayout` never supplied). `onMenuClick={() => setMobileOpen(true)}` is passed to `<Topbar>`.

### Decision 3 — Hamburger trigger in `Topbar.tsx`

New optional prop `onMenuClick?: () => void`. Renders a button with lucide-react's `Menu` icon before the title, class `lg:hidden` (mirrors the `hidden lg:block` / `lg:hidden` pattern `Sidebar.tsx` already uses for the same breakpoint), calling `onMenuClick` on click.

### Decision 4 — No changes to `Sidebar.tsx`

Confirmed by direct source read: `Sidebar.tsx` already correctly implements the mobile drawer (backdrop click → `setMobileOpen?.(false)`, close button → same, route-change `useEffect` → same) gated entirely behind the `mobileOpen`/`setMobileOpen` props it declares. It was never broken — it was simply never given real values for those props, and nothing ever set them to `true`. Because the drawer renders the same `sidebarContent` JSX used by the desktop `<aside>`, module/permission filtering (`filterItems`, Constitution Principle IV) is automatically identical between the two — there is no separate mobile nav data source to keep in sync.

## Project Structure

### Documentation (this feature)

```text
.specify/specs/mobile-nav-fix.md    # Phase 0 output (this feature's spec)
.specify/plans/mobile-nav-fix.md    # This file
.specify/tasks/mobile-nav-fix.md    # Phase 2 output (/speckit.tasks)
```

### Source Code (SIMP-FRONTEND)

```text
src/
├── hooks/
│   └── useMediaQuery.ts        # NEW
└── components/layout/
    ├── AppLayout.tsx            # MODIFIED — mobileOpen state + isDesktop effect + prop wiring
    ├── Topbar.tsx                # MODIFIED — onMenuClick prop + hamburger button
    └── Sidebar.tsx               # UNCHANGED — already correct, see Decision 4
```

**Structure Decision**: Standard SIMP-FRONTEND layout (`src/hooks/`, `src/components/layout/`) — no new directories, no new architectural pattern introduced.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.* The decision to skip automated component tests for this feature is a scope choice, not a constitution violation: the spec's Success Criteria are manually-verifiable, viewport-based visual/interaction outcomes, and Tailwind breakpoint rendering is low-value/brittle to cover with component tests; `npm run type-check`/`lint` remain mandatory regression gates (see `tasks.md` Polish phase).
