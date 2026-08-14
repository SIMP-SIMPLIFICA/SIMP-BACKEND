# Feature Specification: Super Admin Onboarding & Navigation UX

**Feature Branch**: `super-admin-onboarding-ux`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Refatorar a experiência e o onboarding do Super Admin (Dono do Sistema). Sistema possui 3 camadas de acesso: Super Admin (dono do SaaS, gerencia organizações/assinaturas/suporte global), Org Admin (chefe do tenant), Org Member (usuário comum com permissões granulares). Problema 1: criação de organização permite ausência de admin vinculado ('Nenhum admin ativo encontrado'). Problema 2: Sidebar mostra itens de navegação de tenant (Dashboard, Financeiro, Processos Virtuais, Convênios, etc.) para o Super Admin, sem sentido no escopo global."

**Relationship to prior work**: Requirement 1 below is the same defect already fully specified in [`.specify/specs/org-admin-onboarding.md`](./org-admin-onboarding.md), planned in [`.specify/plans/org-admin-onboarding.md`](../plans/org-admin-onboarding.md), and broken into tasks in [`.specify/tasks/org-admin-onboarding.md`](../tasks/org-admin-onboarding.md) — not yet implemented at the time this document was written. It is restated here at summary level for completeness of this broader Super Admin UX initiative; **it is not re-specified or re-planned as separate work** — this document's own Plan/Tasks only cover Requirement 2 in full detail, and point back to the prior tasks for Requirement 1. Confirmed with the user: the "Nova Organização" form keeps auto-generating and emailing the temporary password (no manual password field is added) — this matches the design already approved in `org-admin-onboarding.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every newly created organization has a working administrator (Priority: P1)

*(Restated from `org-admin-onboarding.md` for completeness — see that document for full detail, edge cases, and acceptance scenarios.)*

A super admin creates a new organization; it must have a working administrator immediately, with the temporary password delivered by email and never exposed in any API response.

**Why this priority**: A broken organization-creation flow blocks everything else in this document — there would be no point refining the Super Admin's navigation if the core action they take (onboarding a new tenant) doesn't reliably work.

**Independent Test**: See `org-admin-onboarding.md`.

---

### User Story 2 - Super Admin sees only administrative navigation when operating globally (Priority: P2)

A Super Admin, when not impersonating any specific organization, is managing the SaaS platform itself — organizations, subscriptions, global support. They should not see navigation for tenant-specific business modules (Financeiro, Workspaces, Comunicação, Processos Virtuais, Biblioteca, Convênios, Protocolos, Conselhos, Utilidades) or tenant-management items (Usuários, Roles, Departamentos, Organização) that have no meaning without an organization to operate on.

**Why this priority**: This is a real clarity/UX defect, not a functional blocker — nothing crashes, but the navigation actively misrepresents what the Super Admin can meaningfully do in this context, and dilutes the (correctly scoped) admin-only actions among a wall of irrelevant tenant links.

**Independent Test**: Log in as a Super Admin (no active impersonation). The sidebar must show exactly the administrative items relevant to platform ownership, and nothing else. Independently testable without touching organization-creation at all.

**Acceptance Scenarios**:

1. **Given** a Super Admin is authenticated and is not currently impersonating any organization, **When** they view the sidebar, **Then** it shows only administrative items: "Painel Admin", "Suporte", and "Configurações Globais" — no business-module or tenant-management items are present.
2. **Given** a Super Admin has started impersonating a specific organization's administrator, **When** they view the sidebar, **Then** it shows the full navigation appropriate to that organization (exactly as an Org Admin/Org Member of that organization would see it, filtered by that organization's enabled modules and the impersonated user's permissions) — impersonation must continue to work exactly as it does today.
3. **Given** a regular Org Admin or Org Member (not a Super Admin) is authenticated, **When** they view the sidebar, **Then** their navigation is unaffected by this change — filtered by their own organization's enabled modules and their own permissions, exactly as today.

### Edge Cases

- What if a user somehow has both `isSuperAdmin = true` and a non-null organization assignment on their own account (not via impersonation)? By design and by every existing organization/user-creation path in this codebase, Super Admins are platform-level and are never assigned to an organization on their own profile — impersonation is the only mechanism by which a Super Admin session becomes organization-scoped. This spec relies on that existing invariant rather than introducing an additional check for a state the system does not otherwise produce.
- What happens to "Meu Perfil" (the user's own profile) for a Super Admin? It is intentionally not listed as one of the three administrative items — a Super Admin can still reach their own profile via the existing account/avatar control in the top bar, which is unaffected by this change. No sidebar link for it is needed in the Super Admin's restricted navigation.

## Requirements *(mandatory)*

### Functional Requirements

**Inherited from `org-admin-onboarding.md`** (unchanged, restated for traceability — see that document as the source of truth):

- **FR-001** … **FR-006**: see `.specify/specs/org-admin-onboarding.md`.

**New for this document**:

- **FR-007**: The system MUST hide every tenant/business-scoped navigation item (all items under "Principal", "Documentos", "Utilitários" sections, plus "Usuários", "Roles", "Departamentos", "Organização" under "Administração") WHEN the authenticated user is a Super Admin who is not impersonating an organization.
- **FR-008**: The system MUST show exactly three navigation items — "Painel Admin", "Suporte", "Configurações Globais" — WHEN the authenticated user is a Super Admin who is not impersonating an organization.
- **FR-009**: The system MUST continue to show the full tenant navigation, filtered by that organization's enabled modules and the acting user's permissions, WHEN a Super Admin is impersonating an organization's administrator — this is existing behavior and MUST NOT regress.
- **FR-010**: The system MUST NOT change navigation behavior for any authenticated user who is not a Super Admin (Org Admin or Org Member) — existing per-module, per-permission filtering continues unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Inherited**: see `org-admin-onboarding.md` SC-001 … SC-004.

**New**:

- **SC-005**: A native Super Admin session (no impersonation active) renders exactly 3 navigation items in the sidebar — 0 business-module items visible.
- **SC-006**: An impersonated session renders the same navigation an equivalent Org Admin/Org Member of that organization would see — no visible difference from today's impersonation experience.
- **SC-007**: No change in rendered navigation for any non-Super-Admin user, verified by comparing before/after for an Org Admin and an Org Member account.

## Assumptions

- "Configurações Globais" maps to the existing `/configuracoes` route, which is already permission-gated (`system:admin` bypass already included in its `PermissionGate`) but currently has no sidebar entry pointing to it and renders only a placeholder page. This feature adds the missing sidebar link; it does not build out the placeholder page's content — that remains a separate, future piece of work.
- The distinction between "Super Admin operating globally" and "Super Admin impersonating an organization" is already fully captured by the existing `isSuperAdmin` flag returned by the current-user endpoint, because impersonation issues a session that represents the impersonated organization admin's own identity (whose real account has `isSuperAdmin = false`) rather than a client-side view toggle on top of the Super Admin's own session. No new state or flag is introduced to distinguish the two.
