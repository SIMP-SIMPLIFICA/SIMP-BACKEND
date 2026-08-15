# Feature Specification: Mobile Navigation Drawer Fix

**Feature Branch**: `mobile-nav-fix`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Refatoração da Navegação Mobile (Drawer) — tornar o sistema responsivo em telas menores, garantindo que o menu lateral seja acessível via botão 'hamburger' quando o viewport for < 1024px."

**Constitution alignment**: this spec has no dependency on Principles I/II (Local-First / Supabase Prohibition) — it is a frontend-only interaction fix with no backend, database, or credential surface. It is governed by Principle IV (module/permission parity between desktop and mobile nav must be preserved) and Principle V (this is the first feature to go through the formal Spec Kit workflow).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open navigation via hamburger on small screens (Priority: P1)

A user accessing SIMP on a phone or narrow tablet (viewport narrower than 1024px) needs a way to open the app's navigation menu, since the persistent sidebar used on desktop is not shown at this width.

**Why this priority**: Today there is no way to open navigation at all below 1024px — this is a full functional blocker (users cannot reach any module except the one they landed on directly via URL), not a cosmetic issue. It is the MVP of this feature; everything else is refinement on top of it.

**Independent Test**: On a viewport narrower than 1024px, tap the hamburger icon in the top bar. The navigation drawer slides in from the left showing the same sections and items as the desktop sidebar. This can be verified in isolation without any other change in this spec.

**Acceptance Scenarios**:

1. **Given** a user on a viewport narrower than 1024px viewing any authenticated page, **When** they tap the hamburger icon in the top bar, **Then** the navigation drawer slides in from the left edge showing the full navigation (all sections/items the user has access to).
2. **Given** the drawer is open, **When** the user taps outside the drawer (on the dimmed backdrop), **Then** the drawer closes.
3. **Given** the drawer is open, **When** the user taps the close ("X") control inside the drawer, **Then** the drawer closes.

---

### User Story 2 - Drawer closes automatically after choosing a destination (Priority: P2)

Having opened the drawer and picked a destination, the user expects to land on that page without an extra step to dismiss the now-irrelevant drawer.

**Why this priority**: Real usability issue, but secondary to Story 1 — without Story 1 there is nothing to close in the first place.

**Independent Test**: With the drawer open, tap any navigation link. Verify the drawer closes and the app navigates to the selected page, testable independently of the rest of the feature once the drawer can be opened at all.

**Acceptance Scenarios**:

1. **Given** the drawer is open, **When** the user taps any navigation link inside it, **Then** the drawer closes and the app navigates to the selected page.

---

### User Story 3 - Correct navigation pattern at every breakpoint (Priority: P3)

The fix must not regress desktop behavior, and must behave predictably as the viewport crosses the 1024px boundary (window resize, device rotation, external monitor connect/disconnect).

**Why this priority**: Regression protection and edge-case robustness — valuable, but only meaningful once Stories 1 and 2 exist to protect.

**Independent Test**: Verify navigation pattern at 375px, 768px, 1023px, 1024px, and 1280px viewport widths independently, without depending on any specific page's content.

**Acceptance Scenarios**:

1. **Given** a viewport of 1024px or wider, **When** the page loads, **Then** the persistent desktop sidebar (collapsible rail) is shown and no hamburger icon is present.
2. **Given** a viewport narrower than 1024px, **When** the page loads, **Then** no persistent sidebar is shown, the hamburger icon is visible in the top bar, and the drawer starts closed.
3. **Given** the drawer is open on a narrow viewport, **When** the viewport is resized to 1024px or wider (e.g., rotating a tablet, docking to an external monitor), **Then** the drawer stops being presented as an overlay and the persistent desktop sidebar takes over cleanly, with no leftover open/closed state causing unexpected drawer behavior if the viewport later narrows again.

### Edge Cases

- What happens if the viewport is resized from narrow to wide while the drawer is open? → Covered by User Story 3, Acceptance Scenario 3: the drawer's open/closed state must not "leak" across the breakpoint.
- What happens on a deep link directly into a narrow-viewport session (e.g., opening `/financeiro/lancamentos` on a phone for the first time, no prior navigation in-app)? → The hamburger must be present and functional immediately; it cannot depend on any prior interaction having occurred.
- What happens if the user's role/organization hides most navigation items (module gating, RBAC)? → The drawer must reflect the exact same filtered set of items the desktop sidebar would show for that same user; it must not show items the user cannot access, and must not hide items the user can.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a control ("hamburger" menu button) that opens the navigation drawer, WHEN the viewport width is less than 1024px.
- **FR-002**: The system MUST hide the hamburger menu control WHEN the viewport width is 1024px or greater.
- **FR-003**: The system MUST open the navigation drawer WHEN the user activates the hamburger control.
- **FR-004**: The system MUST close the navigation drawer WHEN the user (a) taps the backdrop behind it, (b) taps its close control, or (c) selects a navigation link inside it.
- **FR-005**: The system MUST NOT render the persistent desktop sidebar WHEN the viewport width is less than 1024px (no duplicate or conflicting navigation surfaces).
- **FR-006**: The navigation drawer MUST present the same sections, items, and permission/module filtering as the persistent desktop sidebar — no feature or access gap between the two presentations of navigation.
- **FR-007**: The system MUST re-evaluate which navigation pattern to present (persistent sidebar vs. hamburger+drawer) WHEN the viewport crosses the 1024px boundary at runtime, without requiring a page reload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users on a viewport narrower than 1024px can reach any navigation destination available on desktop within 2 interactions (open drawer, tap destination).
- **SC-002**: A functional way to open navigation is present and verified at viewport widths of 375px, 768px, and 1023px.
- **SC-003**: No regression at desktop widths (≥1024px): the existing collapse/expand and hover-flyout behavior of the sidebar continues to work exactly as before this feature.
- **SC-004**: Opening and closing the drawer completes within a single, non-janky animation cycle (no layout jump, no flash of the wrong navigation pattern).

## Assumptions

- 1024px (Tailwind's `lg` breakpoint) is the correct, already-established threshold — it already appears (unused today) throughout the existing sidebar/layout code, so this spec adopts it rather than introducing a new one.
- No new backend endpoint, database field, or credential is required — this is a pure frontend interaction-state fix, consistent with the Constitution's Local-First scope (this feature does not touch SIMP-BACKEND at all).
- The drawer's existing visual design (width, backdrop, slide animation) is accepted as-is; this feature is about making it reachable, not about redesigning it.
- Hover-triggered flyout submenus (used only in the collapsed desktop rail) are out of scope for the mobile drawer; the drawer always presents items in their expanded form.
