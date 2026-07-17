# SIMP Simplifica — App Features

**Status:** Active | **Version:** 1.0 | **Last updated:** 2026-07-16
**Owns:** the "what" — a living inventory of what SIMP does today, at the module/route/page level, rewritten as testable requirements. Paired with [`ProjectGoals.md`](./ProjectGoals.md) (the "why") and [`TechStack.md`](./TechStack.md) (the "how").

## 1. Purpose & Scope

This document is the ground truth for existing behavior. Any new Spec Kit spec (`/specify`) that touches an existing module must be consistent with what's documented here, or must explicitly call out that it's changing documented behavior. Sources for this inventory: `SIMP-BACKEND/prisma/schema.prisma`, `SIMP-BACKEND/src/config/routes.ts` + `src/index.ts`, `SIMP-BACKEND/src/constants/modules.ts`, and `SIMP-FRONTEND/src/router.tsx`.

**Known drift warning:** `SIMP-BACKEND/README.md`'s "Módulos da API" table documents all routes as `/api/v1/<module>` — this does not match the actual registration in `src/config/routes.ts`/`src/index.ts` (see §5 below). Treat this document's route tables, not the README, as authoritative until the README is corrected.

## 2. System Overview

SIMP is a **multi-tenant** application. Every tenant is an `Organization`. Almost every domain model carries an `organizationId` foreign key with `onDelete: Cascade`, so deleting an organization cascades through all of its data. Access to optional modules is controlled per-tenant by the `OrganizationModule` table, checked at request time via the `requireModule()` middleware (`src/middleware/auth.middleware.ts`, 5-minute in-memory cache per organization). The canonical list of module keys lives in `src/constants/modules.ts`:

```
tasks, finance, communication, virtual_processes, calendar,
notes, departments, library, covenants, protocols, councils, support
```

Of these, `tasks, finance, communication, calendar, notes, departments, library, covenants` are enabled by default for a newly created organization (`DEFAULT_MODULES`). `virtual_processes, protocols, councils, support` require manual enablement by a super admin — the codebase's own comment describes this as "enabled after validation/contracting," i.e. these are treated as premium/opt-in modules.

Authorization is layered: JWT authentication (issued/verified as described in `TechStack.md` §3) → organization membership → RBAC permission check → module-enablement check. RBAC (roles/permissions) is **not module-gating** — a user can have a role that grants `finance:write` but still be blocked from the Finance module entirely if their organization hasn't enabled it.

## 3. Core / Always-On Modules

These are not gated by `OrganizationModule` — every organization has them.

### 3.1 Authentication
- **Requirement:** Users authenticate via email/password (hashed with `@node-rs/argon2`); the system issues short-lived access tokens and longer-lived refresh tokens (via `jose`), supports 2FA (TOTP via `speakeasy`), email verification, and password reset — all individually feature-flaggable via `ENABLE_2FA`/`ENABLE_EMAIL_VERIFICATION`/`ENABLE_PASSWORD_RESET` env vars.
- **Routes:** `/api/v1/auth/*` (`auth.routes.ts` → `auth.controller.ts`).
- **Acceptance:** a user with valid credentials and (if enabled) a valid 2FA code receives a working access+refresh token pair; an invalid credential or expired token is rejected with a 401 that does not leak internal error detail (currently a known gap — see `TechStack.md` §11 P0).

### 3.2 Organizations
- **Requirement:** Super admins can create/manage `Organization` records, each representing one município tenant, and toggle which `OrganizationModule`s are enabled.
- **Routes:** `/api/v1/organizations/*`.

### 3.3 Users
- **Requirement:** Org-scoped CRUD for user accounts, admin-driven user creation with a generated temporary password.
- **Routes:** `/api/v1/users/*` (`user.controller.ts`, 649 lines — largest controller in the codebase).
- **Acceptance:** an admin-created user's temporary password must reach the user **only** via email, never in the API response body (currently violated — see `TechStack.md` §11 P0).

### 3.4 Roles / RBAC
- **Requirement:** Permission-based roles, assignable per user, per organization.
- **Routes:** `/api/v1/roles/*` (`role.controller.ts`, 498 lines).
- **Acceptance:** permission resolution must be consistent regardless of which code path evaluates it. Currently there are three independent implementations (`rbac.service.ts`, `utils/database.ts`, `middleware/auth.middleware.ts`) that can disagree — e.g. a `system:admin` bypass exists in one path and not another. This must not silently diverge; see `TechStack.md` §11 P1.

### 3.5 Admin (super-admin panel)
- **Requirement:** Cross-organization management: create/inspect organizations, toggle modules, and **impersonate** a user in any organization for support purposes.
- **Routes:** `/api/v1/admin/*` (`admin.controller.ts`, 332 lines, includes `POST /organizations/:id/impersonate`).
- **Frontend pages:** `src/pages/admin/{AdminPanel,AdminNewOrganizationPage,AdminOrganizationDetailPage,SupportAdminPage}.tsx`.

### 3.6 Profile & Settings
- **Requirement:** Users manage their own profile; organizations manage org-level public/private settings.
- **Routes:** `/api/v1/settings/*`. **Frontend:** `src/pages/Profile.tsx`.

## 4. Optional / Flag-Gated Modules

### 4.1 Workspaces & Tasks (Kanban)
- **Purpose:** Kanban-style task/board management with checklists, assignees, attachments, notes, and history.
- **Routes:** `/workspaces/*` (`workspace.controller.ts`), `/tasks/*` (`task.controller.ts`, 623 lines) — **note: mounted at root, not under `/api/v1`**.
- **Frontend:** `src/pages/workspaces/{WorkspacesPage,WorkspaceDetailPage}.tsx`, drag-and-drop via `@dnd-kit`.
- **Data model:** `Workspace`, `WorkspaceMember`, `Task`, `TaskAssignee`, `ChecklistItem`, `TaskAttachment`, `TaskNote`, `TaskHistory`, plus `Notification` (mounted separately at `/notifications`, includes an SSE stream at `GET /stream`).
- **Acceptance:** a task's checklist, assignees, and history must be scoped to its parent workspace and organization; moving a task between board columns must persist and produce a `TaskHistory` entry.

### 4.2 Finance (Financeiro)
- **Purpose:** Brazilian public-sector bookkeeping — bank accounts, categories, and entries with `empenho`/`liquidação`/NFe-related fields.
- **Routes:** `/finance/*` (`finance-bank-account.controller.ts`, `finance-category.controller.ts`, `finance-entry.controller.ts`, 319 lines) — **root-mounted, not under `/api/v1`**.
- **Frontend:** `src/pages/financeiro/{FinanceiroOverview,Lancamentos,Relatorios,Inteligencia,Contas,Categorias}.tsx`.
- **Data model:** `BankAccount`, `FinanceCategory`, `FinanceEntry`, `FinanceAttachment`.
- **Acceptance:** every `FinanceEntry` must belong to a `BankAccount` and a `FinanceCategory`, both scoped to the entry's organization; the overview dashboard's metric cards must reflect the same aggregation logic used in `Relatorios`.
- **Known tech debt:** `FinanceiroOverview.tsx` implements its own bespoke stat-card markup and chart styling, separate from `Dashboard.tsx`'s implementation of the same "cards + chart" pattern — see `TechStack.md` §11 P1 for the planned consolidation.

### 4.3 Communication (Comunicação)
- **Purpose:** Internal official document exchange (ofícios/memorandos) between departments/users, inbox/sent views, attachments.
- **Routes:** `/api/v1/communication/*` (`communication.controller.ts`, 395 lines).
- **Frontend:** `src/pages/Communication.tsx`.
- **Data model:** `CommunicationDocument`, `DocumentRecipient`, `CommunicationAttachment`.

### 4.4 Virtual Processes (Processos Virtuais)
- **Purpose:** Digital case/process tracking with configurable categories, sources, and companies.
- **Routes:** `/virtual-processes/*` (`virtual-process.controller.ts` 460 lines, `virtual-process-category.controller.ts`, `virtual-process-config.controller.ts`) — **root-mounted**.
- **Frontend:** `src/pages/processos-virtuais/{ProcessosVirtuais,Configuracoes}.tsx`.
- **Data model:** `VirtualProcess`, `VirtualProcessCategory`, `VirtualProcessSource`, `VirtualProcessCompany`, `VirtualProcessDocument`.
- **Gating note:** not enabled by default — requires manual super-admin activation per organization.

### 4.5 Calendar & Notes (Utilidades)
- **Purpose:** Personal/org calendar events and freeform notes.
- **Routes:** `/api/v1/utilities/calendar/*`, `/api/v1/utilities/notes/*`.
- **Frontend:** `src/pages/utilidades/{Calendar,Notes}.tsx`.
- **Data model:** `CalendarEvent`, `CalendarAttachment`, `Note`.

### 4.6 Library / GED (Biblioteca Digital)
- **Purpose:** Document repository with access-level control and OCR'd text content for search.
- **Routes:** `/api/v1/library/*` (`library.controller.ts`, 429 lines).
- **Frontend:** `src/pages/library/LibraryPage.tsx`.
- **Data model:** `LibraryDocument`, `DocumentCategory`.

### 4.7 Convênios (Covenants)
- **Purpose:** Tracking of formal covenant agreements between the município and concedente/convenente entities (state/federal transfer agreements), including transfer and counterpart values.
- **Routes:** `/covenants/*` (`covenant.controller.ts`, 399 lines) — **root-mounted**.
- **Frontend:** `src/pages/convenios/{CovenantsPage,CovenantDetailSheet,CovenantFormDialog}.tsx`.
- **Data model:** `CovenantType`, `Convenente`, `Concedente`, `Covenant`.
- **Acceptance:** a `Covenant`'s transfer/counterpart values must be traceable to its `Concedente` and `Convenente` records for audit purposes.

### 4.8 Protocolos (Official Document Numbering)
- **Purpose:** Sequential or randomized official protocol/document numbering for legal traceability.
- **Routes:** `/protocols/*` (`protocol.controller.ts`, 336 lines) — **root-mounted**.
- **Frontend:** `src/pages/protocolos/OfficialProtocolsPage.tsx` (includes a print stylesheet for official document printing).
- **Data model:** `SequenceControl`, `OfficialDocument`.
- **Gating note:** not enabled by default.

### 4.9 Conselhos Municipais (Councils)
- **Purpose:** The newest module — municipal council management: councils, memberships, meetings, agenda items, attendance, council documents, and Gov.br-integrated digital signature requests.
- **Routes:** `/councils/*` (two separate registrations — `council.controller.ts` 316 lines + `council-meeting.controller.ts` 376 lines for authenticated routes, plus `councilPublicRoutes` for public/signature-callback routes), `council-document.controller.ts`, `govbr-signing.controller.ts` (270 lines).
- **Frontend:** `src/pages/councils/{CouncilsPage,CouncilDetailPage,MeetingDetailPage,CouncilSignReturnPage}.tsx`.
- **Data model:** `Council`, `CouncilMembership`, `CouncilMeeting`, `MeetingAgendaItem`, `MeetingAttendance`, `CouncilDocument`, `SignatureRequest`, `GovBrOAuthState`.
- **Gating note:** not enabled by default; requires manual activation.
- **Known open gaps (from code TODOs):**
  - `src/router.tsx:179` (frontend) — Councils routes are currently gated only by module flag, not fine-grained permission, unlike every other module. **Acceptance to close this gap:** wrap Councils routes in `PermissionGate anyOf={["councils:read","councils:write","councils:admin"]}` once those permission keys are defined in the RBAC seed data.
  - `src/pages/councils/CouncilsPage.tsx:188` (frontend) — the council list endpoint does not return associated meetings; the meeting list is only populated from the detail page today. **Acceptance to close this gap:** the list endpoint should either eager-load meeting counts or the list page should fetch them lazily per row.

### 4.10 Departamentos (Departments)
- **Purpose:** Organizational department structure and membership.
- **Routes:** `/departments/*` (`department.controller.ts`) — **root-mounted**.
- **Frontend:** `src/pages/Departments.tsx`.

### 4.11 Suporte (In-App Support)
- **Purpose:** In-app support ticket/chat between tenant users and the SIMP team.
- **Routes:** `/support/*` (`support.controller.ts`) — **root-mounted**.
- **Frontend:** `src/pages/admin/SupportAdminPage.tsx` (admin side).
- **Data model:** `SupportRequest`, `SupportMessage`.

## 5. Route Mounting Reference (as implemented, not as documented in README)

| Prefix | Modules |
|---|---|
| `/api/v1/*` | auth, organizations, users, roles, admin, communication, settings, utilities/calendar, utilities/notes, upload, library |
| **root (no `/api/v1`)** | workspaces, tasks, notifications, finance, virtual-processes, covenants, protocols, departments, councils (×2 registrations), support |
| `/public/*` | public hash-validation endpoints (e.g. verifying signed/protocol documents) |
| `/api/sentry-tunnel` | Sentry envelope proxy for the frontend (dodges ad-blockers) |
| `/health` | health check (used by Docker `HEALTHCHECK` and Render) |

**Acceptance for future work:** this inconsistency (some modules prefixed, some not) should be resolved — either all modules move under `/api/v1`, or the README is corrected to match reality and the inconsistency is accepted as-is. Either way, `README.md`'s current table must not continue silently disagreeing with `src/config/routes.ts`. Tracked as a P1 item in `TechStack.md` §11.

## 6. Known Gaps / Stub Features

- **`/configuracoes`** exists in both the frontend router and the sidebar navigation (`AppLayout.tsx`'s `titleByPath` map includes it), but resolves to a bare, unbuilt `Placeholder` component with no functionality. **Acceptance:** either build this page out or remove it from nav until it is.
- **Conselhos permission wiring** — see §4.9 above.

## 7. Feature Backlog Pointer

Once Spec Kit is initialized (`TechStack.md` §9), new feature requests and changes to the modules above should be tracked as specs under `SIMP-BACKEND/.specify/specs/` (cross-cutting/full-stack features) or `SIMP-FRONTEND/.specify/specs/` (frontend-only changes), not as ad-hoc documents. The existing `docs/superpowers/{specs,plans}/` folders in both repos predate this convention and should be treated as historical reference material when writing new specs for these modules (e.g. the prior `protocols-refactor-design.md`, `councils-govbr-integration.md`, and `communication-threads-*.md` docs contain design rationale relevant to §4.4, §4.8, §4.9, and §4.3 respectively).
