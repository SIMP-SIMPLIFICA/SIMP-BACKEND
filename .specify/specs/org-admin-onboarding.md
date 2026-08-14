# Feature Specification: Organization Admin Onboarding

**Feature Branch**: `org-admin-onboarding`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "O fluxo atual de criação de organização está incompleto. Ao criar uma nova organização, o sistema exige que ela já tenha um administrador, mas atualmente ele permite a criação sem vincular nenhum usuário com role admin, resultando no erro 'Nenhum admin ativo encontrado nesta organização'."

**Investigation note**: the organization-creation form and the Organization+User transaction already exist and already collect the administrator's name and email. The verified root cause is that role *linkage* silently fails — not that the flow is missing steps. See `.specify/plans/org-admin-onboarding.md` for the technical mechanism; this document states the required behavior only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every newly created organization has a working administrator (Priority: P1)

A super admin creates a new organization through the internal admin panel. Immediately afterward, that organization must have an administrator who can actually authenticate and act with administrative authority over the organization — not just a user record that looks right.

**Why this priority**: This is the core defect. Without it, every new organization is born broken — nobody can manage it, and support actions (like impersonation) fail outright. Everything else in this spec is refinement around this guarantee.

**Independent Test**: Create an organization via the admin panel, then immediately attempt to impersonate its administrator. This must succeed without any extra manual step.

**Acceptance Scenarios**:

1. **Given** a super admin submits the "New Organization" form (organization name, slug, administrator's name and email), **When** the organization is created, **Then** a user exists for that organization with full administrative authority over it.
2. **Given** an organization was just created, **When** a super admin uses the "impersonate" action for that organization, **Then** it succeeds immediately and returns the newly created administrator's identity — the "no active admin found" error must not occur for a freshly created organization.
3. **Given** the organization being created is the very first one ever created on a given deployment (nothing has been set up beforehand), **When** it is created, **Then** the outcome is identical to Scenario 1 — the guarantee must not depend on any prior manual setup step having been performed.

---

### User Story 2 - The new administrator receives usable credentials securely (Priority: P2)

Once an organization and its first administrator exist, that person needs a way to actually log in — without the system ever exposing their password in a place it shouldn't be.

**Why this priority**: Directly required by this project's security baseline (Constitution Principle VI): generated secrets must never appear in API responses, only in the delivery channel meant for them.

**Independent Test**: Create an organization, inspect the API response (must contain no password of any kind), then check the administrator's email inbox for a message containing a working temporary password.

**Acceptance Scenarios**:

1. **Given** an organization is created through the internal admin flow, **When** the response is returned to the caller, **Then** it contains no password field of any kind.
2. **Given** an organization is created through the internal admin flow, **When** the operation completes, **Then** an email containing a working temporary password is sent to the administrator's email address, and the administrator account is already active (no separate activation step required before first login).

---

### User Story 3 - The same guarantee applies to public self-service organization signup (Priority: P3)

A second, independent entry point exists for creating an organization: a public, unauthenticated self-service signup (used for future customer onboarding, not yet exposed in the frontend UI). It must not be left with the same defect just because it is less visible today.

**Why this priority**: Lower priority only because it currently has no UI consumer — but it is a live, reachable backend endpoint, and shipping a fix that covers only the internally-used entry point while leaving an identical defect in a second, publicly reachable one would not actually close the underlying gap.

**Independent Test**: Call the public signup endpoint directly (organization details + administrator details, including a self-chosen password) and verify the resulting administrator has full administrative authority over the new organization immediately, with no separate manual step.

**Acceptance Scenarios**:

1. **Given** a request is submitted to the public self-service organization signup endpoint with a self-chosen administrator password, **When** the organization is created, **Then** the administrator has full administrative authority over that organization immediately.

### Edge Cases

- What happens when this is the first organization ever created on a completely fresh deployment (Scenario 1.3)? Covered above — must succeed on the very first attempt.
- What happens when a second, later organization is created? Its administrator must be scoped only to that organization's own data — no cross-organization access leaks between the first and second organization's administrators, even though the underlying administrative authority they're granted is defined once and reused (Constitution Principle IV — Multi-Tenant & Module-Gated Architecture).
- What happens if the internal admin-created flow and the public self-service flow are used interleaved (one org via each path)? Both must independently satisfy User Story 1's guarantee; neither path may depend on the other having run first.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST ensure the newly created user has full administrative authority over the newly created organization, WHEN an organization is created — regardless of whether any organization has ever been created before on that deployment.
- **FR-002**: The system MUST NOT include any password (temporary or otherwise) in the API response WHEN an organization and its administrator are created via the internal (super-admin) flow.
- **FR-003**: The system MUST deliver the generated temporary password to the new administrator's email address WHEN an organization is created via the internal (super-admin) flow.
- **FR-004**: The newly created administrator account MUST be active and able to authenticate immediately after organization creation, with no separate activation step.
- **FR-005**: The guarantee in FR-001 MUST also hold for organizations created via the public self-service signup entry point, not only the internal super-admin flow.
- **FR-006**: An organization's administrator MUST only have access scoped to that organization — never to another organization's data (Constitution Principle IV).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly created organizations have a working, immediately-usable administrator (verified via successful impersonation/login right after creation).
- **SC-002**: Creating the first-ever organization on a completely fresh deployment succeeds on the first attempt, with zero manual setup steps performed beforehand.
- **SC-003**: Zero occurrences of a temporary password appearing in an HTTP response body, across both organization-creation entry points.
- **SC-004**: The new administrator's temporary password email arrives within seconds of organization creation in the local development environment (MailHog).

## Assumptions

- "Full administrative authority" for a newly created organization's administrator means complete access to that organization's own modules and data — not access to other organizations' data, and not the separate, more powerful super-admin/system-level privileges held by SIMP's own operators (Constitution Principle IV).
- The public self-service signup endpoint accepts a self-chosen administrator password (the signee sets their own password during signup); it does not generate or email a temporary password, since none is generated in that flow. FR-003's email requirement therefore applies only to the internal (super-admin-created) flow, not to self-service signup — this is a difference in how each flow obtains a password, not a gap in FR-005's role-authority guarantee, which applies to both.
- Building a frontend page for the public self-service signup endpoint is explicitly out of scope for this feature; only its backend correctness (FR-005) is in scope.
