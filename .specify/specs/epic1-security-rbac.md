# Feature Specification: Epic 1 — Security, RBAC & Critical Bugs

**Feature Branch**: `epic1-security-rbac`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "Épico 1: Segurança, RBAC e Bugs Críticos. (1) Vazamento de dados na aba de Comunicações — usuários veem nomes/e-mails de outras organizações. (2) Org Admin não consegue criar Workspaces — RBAC deve ser avaliado e atualizado. (3) Gerador de Protocolos falhando na criação. (4) Modal de autuar Processo Virtual permite datas de início/encerramento incoerentes."

**Investigation note**: all four problems were verified against the current codebase (controllers, routes, Zod schemas) and, where relevant, against live data in the local database — not assumed from the report alone. Findings are summarized per story below; full technical detail is in `.specify/plans/epic1-security-rbac.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Communications never cross organization boundaries (Priority: P1)

A user composing or reading messages in the Comunicação module must only ever see people, message content, and attachments belonging to their own organization — never another tenant's.

**Why this priority**: This is a tenant-isolation failure — the single most severe class of bug this platform can have, since SIMP is explicitly multi-tenant (Constitution Principle IV) and this module handles internal correspondence between municipal staff.

**Independent Test**: As a regular (non-super-admin) user in Organization A, search for message recipients and list the inbox/sent folders. Every person, message, and organization reference returned must belong to Organization A — verified by comparing against a second organization (B) seeded with distinct users and messages.

**Acceptance Scenarios**:

1. **Given** a non-super-admin user authenticated as a member of Organization A, **When** they search for message recipients, **Then** only active users belonging to Organization A are returned — never a user from any other organization.
2. **Given** the same user, **When** they list their inbox or sent messages, **Then** only messages belonging to Organization A are returned.
3. **Given** a super admin who is not currently impersonating any organization, **When** they use the same endpoints (for platform-wide support purposes), **Then** cross-organization visibility is preserved exactly as it is today — this scenario protects against over-correcting into a regression.
4. **Given** the authenticated user's session is missing or malformed organization context for any reason, **When** any Communication endpoint is called, **Then** the request is rejected (fails closed) rather than silently returning unscoped, cross-tenant data.

---

### User Story 2 - Organization Admins can use the features their role grants (Priority: P1)

An Org Admin — the highest non-platform role that exists for a tenant — must be able to perform the core actions their role implies, starting with creating Workspaces, without hitting a permission wall that no role in the system can ever pass.

**Why this priority**: This blocks a core, everyday action for the exact account tier meant to administer a tenant. It also affects organizations that already exist today, not just ones created going forward.

**Independent Test**: Log in as an existing Org Admin (including one whose organization was created before this fix) and create a Workspace. It must succeed.

**Acceptance Scenarios**:

1. **Given** an Org Admin account, **When** they create a Workspace, **Then** it succeeds and they are set as its owner.
2. **Given** an Org Admin account that was created *before* this fix (i.e., an existing organization whose admin currently has no working role at all), **When** this fix is applied, **Then** that admin gains the same working access as a newly created one — this guarantee must not apply only to organizations created from now on.
3. **Given** the permission catalog used to build the "admin" role, **When** a new module's actions are added to any route as a permission requirement, **Then** that permission must already exist in the catalog — this scenario documents the standing rule that caused this bug, so it is not repeated for the next module.

---

### User Story 3 - Protocol number generation works for every legitimately authorized user (Priority: P2)

A user with protocol-related permissions must be able to generate an official document number without failure.

**Why this priority**: Lower priority than Stories 1–2 because investigation found the generation logic itself to be structurally sound and already correctly permissioned in the catalog — the leading hypothesis is that this is the *same* underlying cause as Story 2 (an admin account with no working role at all gets rejected by the permission gate). This story exists to explicitly verify that hypothesis and close the gap if any distinct issue remains.

**Independent Test**: As an Org Admin whose role was just fixed by Story 2, generate a sequential protocol number for a Comunicação-category document. It must succeed and produce a correctly incremented, unique number.

**Acceptance Scenarios**:

1. **Given** an Org Admin with a working "admin" role (per Story 2), **When** they generate a sequential protocol number, **Then** the request succeeds and returns a properly formatted, incremented number.
2. **Given** two protocol-generation requests for the same organization, sector, document type, and year submitted at nearly the same time, **When** both are processed, **Then** neither fails with an unhandled server error — each either succeeds with a distinct sequential number or receives a clear, retryable error.

---

### User Story 4 - Virtual Process date range must be logically valid (Priority: P3)

When authuing (autuar) a Virtual Process, the start date and the end date entered must form a coherent range — the system must not silently accept a start date that comes after the end date.

**Why this priority**: A real data-integrity defect, but it neither exposes data across tenants nor blocks a whole module — the lowest severity of the four in this epic.

**Independent Test**: Attempt to create a Virtual Process with a start date later than the end date, both via the API directly and via the "autuar processo" modal. Both must reject the input with a clear message; a valid range (start ≤ end, or either field omitted) must continue to be accepted.

**Acceptance Scenarios**:

1. **Given** the "autuar processo" modal, **When** a user enters a start date later than the end date and attempts to submit, **Then** the form blocks submission with a clear validation message before any network request is made.
2. **Given** a direct API request to create a Virtual Process with a start date later than the end date, **When** it is submitted, **Then** the request is rejected with a validation error, regardless of what the client sent.
3. **Given** a Virtual Process with only a start date, only an end date, or neither, **When** it is submitted, **Then** it is accepted — this rule only rejects an actually-inverted range, not incomplete data.

### Edge Cases

- What happens to organizations whose admin already has a role, correctly linked (created after last session's fix)? Story 2's backfill must be idempotent — it must not create a duplicate or conflicting role assignment for accounts that are already correctly set up.
- What happens for a user who legitimately belongs to no organization and is not a super admin (a data anomaly, not an expected state)? Communication endpoints must still fail closed (Story 1, Scenario 4) rather than default to "no filter."
- What happens to a Virtual Process's date fields on update (not just creation)? The same start ≤ end rule must apply — Story 4 is not limited to the creation path.

## Requirements *(mandatory)*

### Functional Requirements

**Communications (Story 1)**

- **FR-001**: The system MUST scope every Communication read (recipient search, inbox, sent, message detail, attachment download) to the requesting user's own organization, for every non-super-admin user.
- **FR-002**: The system MUST reject a Communication request rather than silently return unscoped data WHEN the requesting non-super-admin user's organization context cannot be determined.
- **FR-003**: The system MUST preserve existing cross-organization visibility for a native super admin (not impersonating) — this is intentional, existing behavior, not a defect.

**RBAC / Workspaces (Story 2)**

- **FR-004**: Every permission key referenced by a route or controller as an access requirement MUST exist in the system's permission catalog, so that it is assignable to a role.
- **FR-005**: An Org Admin MUST be able to create, read, and manage Workspaces belonging to their own organization.
- **FR-006**: Every existing user who is an active, non-super-admin organization member with no working administrative role linkage MUST be reconciled to have one, as a one-time corrective action — not only new admins created going forward.

**Protocols (Story 3)**

- **FR-007**: Protocol number generation MUST succeed for any user whose role grants the relevant permission (already-catalog-defined `protocols:write`/`protocols:admin`).
- **FR-008**: Concurrent protocol-generation requests for the same sequence MUST NOT surface as an unhandled server error — each request either succeeds or fails with a clear, actionable error.

**Virtual Processes (Story 4)**

- **FR-009**: The system MUST reject a Virtual Process create or update WHEN both a start date and an end date are provided and the start date is later than the end date.
- **FR-010**: The system MUST continue to accept a Virtual Process with only one or neither of the two date fields provided.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero instances of a non-super-admin user retrieving another organization's user or message data, verified across all Communication endpoints with a two-organization test.
- **SC-002**: 100% of existing Org Admin accounts (not just newly created ones) can successfully create a Workspace after this epic ships.
- **SC-003**: 100% of protocol-generation attempts by a correctly-permissioned user succeed; concurrent attempts produce zero unhandled 500-class errors.
- **SC-004**: Zero Virtual Processes can be created or updated with an inverted date range, verified via both the API and the UI form.

## Assumptions

- "A data de início... permitindo valores menores que a data de encerramento" is understood to mean the system currently accepts an *incoherent* range (start after end) — i.e., the missing guarantee is `startDate ≤ endDate`, not a restriction on how early a start date may be. This document's requirements (FR-009/FR-010) are written against that interpretation.
- Story 3 (Protocols) is planned as a verification-and-hardening story rather than a rewrite, because code review found the generation logic itself already correct and already using catalog-defined permissions — the primary fix is shared with Story 2 (the role backfill).
- The permission catalog gap in Story 2 is scoped to what current routes/controllers already reference (`workspaces:read`, `workspaces:write`, `workspaces:manage`); it does not attempt to design a complete permission set for future Workspace/Task features beyond what already exists in code today.
