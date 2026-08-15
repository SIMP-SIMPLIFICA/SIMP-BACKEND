---
description: "Task list for feature: Mobile Navigation Drawer Fix"
---

# Tasks: Mobile Navigation Drawer Fix

**Input**: Design documents from `.specify/specs/mobile-nav-fix.md` and `.specify/plans/mobile-nav-fix.md`

**Prerequisites**: plan.md (required, present), spec.md (required, present)

**Tests**: Not included as dedicated automated-test tasks — see `plan.md` Complexity Tracking for rationale (manual, viewport-based verification tasks are used instead, per the spec's Success Criteria).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All paths are relative to `SIMP-FRONTEND/`

## Path Conventions

- Frontend only: `src/hooks/`, `src/components/layout/` — no backend paths involved in this feature

---

## Phase 1: Setup

**Purpose**: Add the missing hook boundary needed for JS-level breakpoint awareness.

- [ ] T001 Create `src/hooks/useMediaQuery.ts` exporting `useMediaQuery(query: string): boolean`, wrapping `window.matchMedia(query)`, subscribing to its `change` event, and cleaning up the listener on unmount

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Lift shared drawer state into `AppLayout.tsx` so both `Sidebar` and `Topbar` can be wired to it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 In `src/components/layout/AppLayout.tsx`, add `const [mobileOpen, setMobileOpen] = useState(false)` and `const isDesktop = useMediaQuery('(min-width: 1024px)')` (from T001), plus a `useEffect(() => { if (isDesktop) setMobileOpen(false) }, [isDesktop])`
- [ ] T003 In `src/components/layout/AppLayout.tsx`, pass `mobileOpen` and `setMobileOpen` as props to `<Sidebar>` (props already declared in `SidebarProps`, currently unsupplied)

**Checkpoint**: Foundation ready — `Sidebar`'s existing drawer logic now receives real state, but nothing can open it yet (that's User Story 1).

---

## Phase 3: User Story 1 - Open navigation via hamburger on small screens (Priority: P1) 🎯 MVP

**Goal**: A visible, functional hamburger control opens the existing drawer below 1024px.

**Independent Test**: At a viewport narrower than 1024px, tap the hamburger icon in the top bar; the drawer slides in showing full navigation; tapping the backdrop or the drawer's own "X" closes it (both already implemented in `Sidebar.tsx`).

### Implementation for User Story 1

- [ ] T004 [US1] In `src/components/layout/Topbar.tsx`, add an optional `onMenuClick?: () => void` prop to the `Topbar` component's props type
- [ ] T005 [US1] In `src/components/layout/Topbar.tsx`, render a button with lucide-react's `Menu` icon before the title in the header, classed `lg:hidden` (mirrors the existing `hidden lg:block` / `lg:hidden` breakpoint pattern in `Sidebar.tsx`), calling `onMenuClick` on click
- [ ] T006 [US1] In `src/components/layout/AppLayout.tsx`, pass `onMenuClick={() => setMobileOpen(true)}` to `<Topbar>`

**Checkpoint**: User Story 1 is fully functional and independently testable — hamburger opens the drawer; the drawer's pre-existing backdrop-click and close-button handlers (unchanged, `Sidebar.tsx`) close it.

---

## Phase 4: User Story 2 - Drawer closes automatically after choosing a destination (Priority: P2)

**Goal**: Selecting a nav link inside the open drawer closes it and navigates.

**Independent Test**: With the drawer open (after Phase 3), tap any navigation link; verify the drawer closes and the correct page loads.

### Implementation for User Story 2

- [ ] T007 [US2] Manually verify that `Sidebar.tsx`'s existing route-change `useEffect` (`useEffect(() => { if (setMobileOpen) setMobileOpen(false) }, [location.pathname, setMobileOpen])`) now closes the drawer correctly, since `setMobileOpen` is a real function as of T003. If it does not fire as expected, fix the effect's dependency array in `src/components/layout/Sidebar.tsx` — this is the only condition under which this story requires a code change.

**Checkpoint**: User Story 2 verified. In the expected case this requires no new code — the closing logic was already correct and only needed a real `setMobileOpen` to call, which Phase 2 provided.

---

## Phase 5: User Story 3 - Correct navigation pattern at every breakpoint (Priority: P3)

**Goal**: No desktop regression; clean behavior when the viewport crosses the 1024px boundary.

**Independent Test**: Verify navigation pattern at 375px, 768px, 1023px, 1024px, and 1280px viewport widths.

### Implementation for User Story 3

- [ ] T008 [US3] Manually verify at viewport ≥1024px that the persistent desktop `<aside>` sidebar renders, no hamburger icon is present, and collapse/expand + hover-flyout behavior in `src/components/layout/Sidebar.tsx` is unchanged from before this feature
- [ ] T009 [US3] Manually verify at viewport <1024px (test at 375px and 768px) that no persistent sidebar renders, the hamburger is visible and functional, and — with the drawer open — resizing the window past 1024px closes the drawer cleanly with no stale state on subsequent narrowing (validates the `isDesktop` effect from T002)

**Checkpoint**: All three user stories independently functional and verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regression gates and documentation closure.

- [ ] T010 [P] Run `npm run type-check` and `npm run lint` in `SIMP-FRONTEND` and confirm no new errors
- [ ] T011 Update the "sidebar mobile drawer disconnected" P0 entry in `SIMP-BACKEND/docs/TechStack.md` §11 to reflect it is resolved, referencing this feature's spec at `.specify/specs/mobile-nav-fix.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001 — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — delivers the MVP
- **User Story 2 (Phase 4)**: Depends on Phase 3 (needs a real trigger to open the drawer before its closing behavior can be exercised)
- **User Story 3 (Phase 5)**: Depends on Phases 3 and 4 (verifies the complete behavior set)
- **Polish (Phase 6)**: Depends on all user stories being complete

### Within Each Phase

- T002 before T003 (same file, state must exist before it can be passed as a prop)
- T004 before T005 before T006 (prop type → rendered control → wired callback)

### Parallel Opportunities

- T001 has no dependencies and can start immediately on its own
- T010 is marked [P] (independent of T011, different concern) but both depend on all prior phases being complete
- No other tasks are parallelizable — this feature touches only 2 files (`AppLayout.tsx`, `Topbar.tsx`) sequentially plus 1 new file (`useMediaQuery.ts`)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002-T003) — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T004-T006)
4. **STOP and VALIDATE**: confirm the hamburger opens/closes the drawer at <1024px per the Independent Test in Phase 3
5. This alone resolves the P0 "no navigation below 1024px" blocker from the constitution/audit

### Incremental Delivery

1. Setup + Foundational → foundation ready, nothing user-visible yet
2. User Story 1 → MVP: navigation is reachable on mobile (the core fix)
3. User Story 2 → verify/confirm auto-close on navigation (likely free, from existing code)
4. User Story 3 → verify no regressions and clean breakpoint-crossing behavior
5. Polish → type-check/lint gate + documentation closure

## Notes

- Total tasks: **11** (T001–T011)
- Per-story breakdown: Setup 1, Foundational 2, US1 3, US2 1 (verification), US3 2 (verification), Polish 2
- Suggested MVP scope: **User Story 1** (T001–T006) — 6 tasks, 3 files
- `Sidebar.tsx` is touched by **zero** implementation tasks — confirmed already correct in `plan.md` Decision 4; T007 only asks to *verify* its existing behavior, with a fallback fix path if verification fails
- Commit after each task or logical group, per standard project practice
