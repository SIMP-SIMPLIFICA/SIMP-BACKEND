<!--
Sync Impact Report
===================
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: N/A (first concrete version — all six principles are new)
Added sections:
  - Core Principles I–VI (Local-First & Zero Cloud Credentials; Supabase Prohibition;
    Municipal Domain Integrity; Multi-Tenant & Module-Gated Architecture;
    Spec-Driven Development; Environment & Security Baseline)
  - Technology & Infrastructure Constraints (SECTION_2)
  - Development Workflow & Quality Gates (SECTION_3)
  - Governance (amendment procedure, versioning policy, compliance review)
Removed sections: none (template placeholders only)
Templates requiring updates:
  - .specify/templates/plan-template.md → ✅ compatible as-is; its "Constitution Check"
    section is filled dynamically per-plan from this file, no structural edit needed.
  - .specify/templates/spec-template.md → ✅ compatible as-is; no new mandatory spec
    sections introduced by these principles beyond existing User Stories /
    Functional Requirements / Success Criteria structure.
  - .specify/templates/tasks-template.md → ✅ compatible as-is; "Foundational" phase
    already accommodates Docker/Postgres/env-validation setup tasks.
  - .github/agents/speckit.*.agent.md (10 files) → ✅ reviewed, no agent-specific
    (CLAUDE-only, Copilot-only, etc.) references found that conflict with these
    generic, project-level principles.
  - SIMP-BACKEND/README.md → ⚠ PENDING (tracked as TechStack.md §11 P1 item;
    README's quickstart and route table still describe the retired Supabase flow
    and drifted route prefixes — must be corrected in a follow-up amendment/PR,
    out of scope for this constitution update).
Follow-up TODOs: none deferred within this file — all placeholders resolved.
-->

# SIMP Simplifica Constitution
<!-- Municipal management platform — Local-First MVP stabilization phase -->

## Core Principles

### I. Local-First & Zero Cloud Credentials (NON-NEGOTIABLE)
The full application stack — API, database, cache, mail, and database admin UI —
MUST run entirely on a developer's machine with **zero cloud credentials of any
kind**. The only required local infrastructure is Docker Compose
(`SIMP-BACKEND/docker-compose.yml`) provisioning PostgreSQL 16, Redis 7,
MailHog, and pgAdmin 4. `docker compose up -d` followed by `npm install` and
`npm run dev` in each repo MUST be sufficient to reach a fully working,
authenticated local environment. Any environment variable that would require a
live third-party credential (cloud database, cloud auth provider, cloud
storage) MUST be optional in the centralized config schema with a safe local
or mock default (e.g. `USE_MOCK_GOVBR=true`, local-disk fallback for uploads).
**Rationale**: the project previously scaled its cloud infrastructure
(Supabase, sized for 5,000+ concurrent users) before the MVP itself was
stable — this created three simultaneous, ambiguous Postgres targets (local
Docker, Supabase, Render) and blocked new contributors from running the app
without possessing production-grade secrets. Local-First removes that
ambiguity as the top structural priority of the current stabilization phase.

### II. Supabase Prohibition (ABSOLUTE RULE)
Supabase — as a database target, as an authentication provider, or as the
`@supabase/supabase-js` dependency — is **removed and obsolete**. It MUST NOT
be reintroduced into `SIMP-BACKEND` or `SIMP-FRONTEND` without a dedicated
Spec Kit specification that documents a concrete, evidenced scaling trigger
(not speculative future growth). Concretely and non-negotiably:
- `src/config/config.ts` MUST NOT declare `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_JWT_SECRET` as required fields.
- `src/controllers/user.controller.ts` MUST NOT call
  `supabaseAdmin.auth.admin.createUser` or any other Supabase Auth API —
  admin-driven user creation MUST use the local ID generation + `argon2` +
  `nodemailer`/MailHog invite flow that already exists in the codebase.
- `src/lib/supabase.ts` and the `@supabase/supabase-js` package MUST be
  deleted once no code path references them.
- PostgreSQL provisioned by local Docker Compose is the **only** authoritative
  database for every local development environment; the Render-managed
  Postgres remains solely for the separate, explicitly-labeled shared cloud
  "dev" deployment.
**Rationale**: this is a deliberate, documented reversal (see
`docs/ProjectGoals.md` §4), not an oversight — treating it as optional invites
the exact three-way database ambiguity this stabilization effort exists to
eliminate.

### III. Municipal Domain Integrity
SIMP is legal/administrative infrastructure for Brazilian municipalities, not
a generic CRUD app. Every feature touching financial records (`empenho`,
`liquidação`, NFe-linked entries), official document numbering
(`SequenceControl`/`OfficialDocument`), council meeting governance
(`CouncilMeeting`, `MeetingAgendaItem`, `SignatureRequest`), or Gov.br digital
signature flows MUST preserve auditability: no silent renumbering of official
protocols, no bypassing `SequenceControl`, no mutation of signed council
documents. Every such feature's acceptance criteria MUST be written in
testable, falsifiable form (see `docs/AppFeatures.md` for the current
baseline per module) before implementation begins.
**Rationale**: these records have legal weight for the municipalities using
SIMP; correctness and traceability here are not negotiable engineering
trade-offs the way they might be in a generic SaaS product.

### IV. Multi-Tenant & Module-Gated Architecture
Every domain model MUST be scoped by `organizationId` with `onDelete: Cascade`
back to `Organization` — no new model may omit tenant scoping. Optional
capabilities (currently: `tasks`, `finance`, `communication`,
`virtual_processes`, `calendar`, `notes`, `departments`, `library`,
`covenants`, `protocols`, `councils`, `support`) MUST be gated through the
`OrganizationModule` table and enforced via the `requireModule()` middleware —
never hardcoded as globally available or checked only in the frontend.
Permission logic (RBAC) MUST resolve consistently regardless of entry point;
the current existence of three independent, divergence-prone permission
implementations (`rbac.service.ts`, `utils/database.ts`,
`middleware/auth.middleware.ts`) is a known violation of this principle and
MUST be consolidated to a single source of truth (tracked in
`docs/TechStack.md` §11, P1).
**Rationale**: tenant isolation and consistent authorization are the
foundation of a multi-municipality SaaS platform; divergent permission checks
are a direct security risk, not just tech debt.

### V. Spec-Driven Development
Once `.specify/` is active in a repo, no new module or materially significant
feature change MAY be implemented without a corresponding spec
(`/speckit.specify` → `/speckit.plan` → `/speckit.tasks`). Cross-cutting,
full-stack features (the majority of real feature work — a feature touching
both API and UI) MUST be specified canonically in `SIMP-BACKEND/.specify/`,
since the backend defines the contract (routes, Prisma schema, RBAC/module
gating) that the frontend consumes. `SIMP-FRONTEND/.specify/` is reserved for
frontend-only specs that require no backend contract change. Every spec MUST
be consistent with `docs/AppFeatures.md` (existing behavior) and
`docs/TechStack.md` (architectural constraints) or MUST explicitly document
that it supersedes them.
**Rationale**: prior feature work was captured in ad-hoc, per-session design
docs (`docs/superpowers/`) with no enforced structure or falsifiability —
useful historical context, but not a repeatable process. Spec Kit replaces
that with a structured, auditable workflow.

### VI. Environment & Security Baseline
All environment variables MUST be declared and validated through the
centralized Zod schema in `src/config/config.ts`, which MUST fail fast
(`process.exit(1)`) on invalid or missing required configuration at boot —
no module may read `process.env` directly as a way to bypass this validation
(current violations in `src/lib/r2.ts` and
`src/controllers/govbr-signing.controller.ts` are tracked as P0 in
`docs/TechStack.md` §11 and must be closed, not expanded). API responses MUST
NOT leak internal error detail (stack traces, raw exception objects) to
clients, and MUST NOT return generated secrets (e.g. admin-issued temporary
passwords) in the response body — such secrets are delivered exclusively via
the email/notification channel.
**Rationale**: fail-fast, centrally-validated configuration is what makes the
Local-First guarantee (Principle I) actually enforceable rather than aspirational —
a config path that silently tolerates missing values can silently reintroduce
a cloud dependency or a broken local environment.

## Technology & Infrastructure Constraints

**Local infrastructure (mandatory, via `SIMP-BACKEND/docker-compose.yml`)**:
PostgreSQL 16 (`postgres:16-alpine`), Redis 7 (`redis:7-alpine`, password-protected),
MailHog (local SMTP catcher), pgAdmin 4 (`dpage/pgadmin4`, pre-configured
connection to the local Postgres service — replaces the previous Adminer
service). The `docker/postgres/init.sql` bind-mount MUST be a real `.sql`
file (not an empty directory) that at minimum ensures the `unaccent`
extension exists.

**Backend**: Fastify 5 (MUST be declared as an explicit direct dependency, not
resolved transitively), TypeScript 5.9, Prisma 6.x targeting PostgreSQL 16,
Zod as the single validation library for both environment config and
request/response schemas, `jose` for JWT issuance with `@fastify/jwt` for
verification only, `@node-rs/argon2` for password hashing, BullMQ (backed by
`ioredis`) for job queues, Cloudflare R2 for object storage, Gov.br OAuth2
with a mandatory local mock mode (`USE_MOCK_GOVBR=true`), Sentry/Betterstack
for observability, Vitest for testing. Node.js version MUST be **22**
consistently across `.nvmrc`, `Dockerfile`, `package.json` `engines`, and CI —
version drift between these is a constitution violation, not a cosmetic
issue.

**Frontend**: React 19, Vite 7, react-router-dom 7, TanStack Query 5 as the
sole server-state layer, shadcn/ui (Radix primitives) + Tailwind as the sole
UI/component system, the existing CSS-variable design-token system as the
sole source of color/spacing/radius values (raw hex literals and untokenized
Tailwind palette classes — e.g. `slate-*` — in feature/page code are
prohibited outside `src/components/ui/*` primitives), React Hook Form +
`@hookform/resolvers` + Zod as the standard form/validation layer going
forward. Navigation MUST be functional and reachable at all viewport widths,
including below the desktop breakpoint (mobile drawer + trigger required, not
optional).

**Deploy topology**: exactly two non-Supabase environments exist —
local Docker (development, source of truth) and Render-managed Postgres
(shared cloud "dev" deployment, `develop` branch). Frontend deploys to
Vercel. No third database target may be introduced without amending this
constitution.

## Development Workflow & Quality Gates

Work discovered during the stabilization audit (see `docs/TechStack.md` §11)
is triaged as P0 (blocks local stabilization or is security-sensitive — MUST
be resolved before or alongside any new feature work in the affected area),
P1 (correctness/tech-debt — SHOULD be resolved promptly, tracked explicitly
rather than silently accumulating), and P2 (cleanup — resolved opportunistically).
This triage is the shared vocabulary for prioritizing Spec Kit-tracked work
going forward.

Every repo's existing CI (lint, typecheck, tests against ephemeral
Postgres/Redis containers, CodeQL, secret scanning) remains a hard merge gate
and is not weakened by this constitution — it is a documented strength to be
preserved, not renegotiated. New specs that touch authentication, RBAC, or
tenant-scoping logic MUST include verification steps proving the change does
not introduce a new divergent permission path (Principle IV) or a new
mandatory-cloud-credential requirement (Principle I).

`docs/superpowers/{specs,plans}/` in both repos predate this constitution and
Spec Kit adoption; they remain valid historical reference for domain
rationale (see `docs/AppFeatures.md` §7) but MUST NOT be treated as live,
authoritative specs going forward.

## Governance

This constitution supersedes `README.md`, `.env.example`, and any other
informal documentation wherever they conflict with it — those files MUST be
corrected to match this constitution, not the reverse. `docs/ProjectGoals.md`,
`docs/AppFeatures.md`, and `docs/TechStack.md` are this constitution's
canonical source material; substantive changes to those documents that affect
a Core Principle MUST be accompanied by a constitution amendment in the same
change set.

**Amendment procedure**: propose the change via `/speckit.constitution` with
the specific principle(s) affected and rationale; the Sync Impact Report at
the top of this file MUST be regenerated on every amendment, listing the
version change, modified/added/removed sections, and any templates flagged
for follow-up. Amendments to Principle I or Principle II (the two
NON-NEGOTIABLE / ABSOLUTE rules) require explicit, documented justification
tied to evidence (e.g. real production scale data), not speculative planning.

**Versioning policy** (semantic versioning): MAJOR for backward-incompatible
principle removals or redefinitions (e.g. reversing the Supabase prohibition);
MINOR for new principles or materially expanded guidance; PATCH for wording
clarifications and non-semantic refinements.

**Compliance review**: every `/speckit.plan` MUST pass the Constitution Check
gate against the principles above before Phase 0 research begins, and MUST
re-check after Phase 1 design. Any violation MUST be justified in the plan's
Complexity Tracking table or the plan MUST be revised to comply. Reviewers on
pull requests implementing a spec are expected to verify the delivered code
matches what the plan's Constitution Check claimed, not just that tests pass.

**Version**: 1.0.0 | **Ratified**: 2026-07-16 | **Last Amended**: 2026-07-16
