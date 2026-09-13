<!--
Sync Impact Report
===================
Version change: 1.0.0 → 1.1.0 (MINOR — two new principles, no redefinition)
Modified principles: none redefined; I–VI unchanged in meaning and wording
Added sections:
  - Core Principle VII (Structured Observability & Layered Error Handling)
  - Core Principle VIII (Domain Exceptions, File Safety & Transactional Integrity)
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md → ✅ compatible as-is; the Constitution
    Check section is filled per-plan from this file and needs no structural edit.
  - .specify/templates/spec-template.md → ✅ compatible as-is; VII/VIII constrain
    HOW code is written, not what a spec must declare.
  - .specify/templates/tasks-template.md → ✅ compatible as-is.
Known violations recorded at amendment time (tracked, not waived):
  - Principle VIII (PDF single source of truth / LGPD): daily-allowance.service.ts
    and fleet-fueling.service.ts still print the issuer's FULL name in the document
    body ('Emitido por' / 'Registrado por') without passing it through
    lgpd-anonymizer.util.ts, and neither passes exporterName to the universal
    footer. SIMP-FRONTEND still generates the council calendar locally with jsPDF
    (src/utils/councilCalendarPdf.ts), bypassing the engine and producing a PDF
    with no QR Code and no ExportedDocument record.
  - Principle IV (tenant scoping): Department.organizationId is OPTIONAL
    (String?), unlike every other domain model. New relations pointing at
    Department inherit that weaker isolation.
Follow-up TODOs: the two violations above must be closed by the retrofit task
that precedes Épico 4 implementation (see .specify/plans/epic4-budget-daily-allowances.md).
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

### VII. Structured Observability & Layered Error Handling
**Logging.** Pino, via `src/utils/logger.ts`, is the only logging channel;
`console.log`/`console.error` in application code is prohibited (scripts under
`prisma/seeds/` and `scripts/` are exempt). Every entry MUST carry timestamp,
level, message and a structured context object, and error entries MUST carry the
stack. Levels are used with fixed meaning: **DEBUG** (local diagnosis, never
enabled in production), **INFO** (business milestone worth auditing), **WARN**
(degraded but recovered — the operation still succeeded), **ERROR** (the
operation failed). Fastify's `requestId` MUST be present in request-scoped logs
so a user-reported failure can be traced to a single request.
**Secrets MUST NEVER be logged**: passwords and their hashes, JWTs, refresh
tokens, seed credentials, Gov.br tokens, or a full CPF. Request bodies MUST be
redacted field-by-field, never logged wholesale.

**Layered handling.** Each layer has one job and MUST NOT do the next layer's:
- the **data layer** converts technical exceptions into domain meaning (e.g.
  Prisma `P2002` → "already registered"), never leaking Prisma error codes upward;
- the **business layer** decides recovery — retry, documented fallback, or
  propagate — and is the only layer allowed to make that call;
- the **HTTP layer** maps a domain error to a status code plus a machine-readable
  `error` code in English and a `message` in pt-BR;
- the **UI** shows the pt-BR message and MUST offer to open a support ticket
  (`SupportRequest`, `support` module) carrying the `requestId`, so a failure the
  user cannot solve becomes a traceable request instead of an abandoned screen.
  This is also the groundwork for the future public forum.

**Empty catch is prohibited.** A `catch` MAY swallow an error only when it (a)
logs it with context and (b) the swallowing is a documented resilience decision
— the audit ledger, behavioral security alerts and tenant logo loading are the
established cases, and they exist precisely so a side effect never breaks the
business operation the user asked for. Swallowing silently, or swallowing a
failure of the operation itself, is a violation.
**Rationale**: in a system whose records carry legal weight, an error that
vanishes is worse than an error that fails loudly — and a municipal servant with
no path to report a failure is a servant who stops using the system.

### VIII. Domain Exceptions, File Safety & Transactional Integrity
**Domain exceptions.** Each domain declares its own error class extending the
native `Error`, exposing a `code` union of meaningful names — the established
pattern of `DailyAllowanceError`, `FleetFuelingError`, `BeneficiaryError`,
`BrandingError` and `CouncilCalendarError`. The HTTP layer maps `code` → status.
Exceptions MUST NOT be used for normal flow control (an empty result set is a
value, not an exception).

**File safety.** `src/services/storage.service.ts` is the only path to the
filesystem: no module may call `fs` directly for stored content. Every resolved
path MUST pass through `resolveSafePath` (path traversal), stored filenames MUST
be system-generated (a client-supplied name never touches the filesystem), and
uploads MUST be validated by real binary signature via `assertAllowedFile` —
never by the declared MIME type, which the client controls.

**Hash and signature integrity (NON-NEGOTIABLE).** A document already registered
with a `sha256Hash` MUST NOT be re-generated, re-saved, recompressed or
otherwise byte-altered. Any byte change invalidates the published hash and makes
the Public Validation Portal accuse a legitimate document of tampering. When
bundling such documents (ZIP, e-mail attachment, archive), the file MUST be
stored verbatim; compression that rewrites the stream is prohibited for any
document carrying a hash or a digital signature.

**One PDF engine.** `src/services/document-pdf.service.ts` is the **single
source of truth** for document generation. Creating an isolated PDF generator —
in the backend or in the browser — is prohibited. Every exported document MUST
pass through `applyUniversalValidationFooter` (discreet QR Code, `publicId`,
issuer, date) and MUST be registered in `ExportedDocument` so it is verifiable in
the Public Portal.

**LGPD.** Any person's name that leaves the system inside an exported document or
a public registry MUST pass through `src/utils/lgpd-anonymizer.util.ts` first,
and the obfuscation MUST happen **before persistence**, never on read — a full
name that never enters the database cannot leak from it. The single exception is
the **signatory of an official act**, who signs publicly in the exercise of
office and is therefore named in full.

**Database and transactions.** Prisma manages connection pooling; no module may
instantiate a second `PrismaClient` (`src/lib/prisma.ts` is the singleton). Every
input MUST be validated with Zod before reaching a query, and queries MUST rely
on Prisma's prepared statements — string-concatenated SQL is prohibited.
`$executeRawUnsafe` is permitted only with values constructed in code (never from
a request) and only where Prisma offers no typed alternative. Multiple dependent
writes MUST run inside `$transaction` so the set is atomic; a partial write that
leaves a document registered without its file, or a hash without its document, is
the failure mode this rule exists to prevent.
**Rationale**: these are the rules that keep the validation chain trustworthy.
A hash that changed, a name that leaked, or a half-applied write each turn the
Public Portal from a guarantee into a claim.

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

**Version**: 1.1.0 | **Ratified**: 2026-07-16 | **Last Amended**: 2026-09-13
