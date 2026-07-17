# SIMP Simplifica — Project Goals

**Status:** Active | **Version:** 1.0 | **Last updated:** 2026-07-16
**Owns:** the "why" behind the current stabilization effort. Paired with [`AppFeatures.md`](./AppFeatures.md) (the "what") and [`TechStack.md`](./TechStack.md) (the "how").

## 1. Purpose & Audience

This document exists to align every future Spec Kit specification (`.specify/`) against one shared understanding of what SIMP Simplifica is for, what stage it is at, and what "done" looks like for the current stabilization effort. Any `/specify` or `/plan` invocation for this codebase should treat this file — not tribal knowledge, not the README, not Slack threads — as the source of truth for scope and intent. When GitHub Spec Kit is formally initialized in this repo, this document's goals should be reflected in `.specify/memory/constitution.md` rather than restated from scratch.

Audience: whoever picks up backend or frontend work on SIMP next — including a future instance of Claude Code — and needs to know *why* a decision (like retiring Supabase) was made before undoing it.

## 2. What SIMP Simplifica Is

SIMP Simplifica is a multi-tenant SaaS platform for Brazilian municipal (prefeitura) administration. Each tenant is an `Organization` (a município) with its own users, roles, departments, and an explicit per-tenant module-enablement table (`OrganizationModule`) that turns optional capabilities on or off. The product's job is to digitize and centralize the paperwork-heavy processes of running a municipality: financial bookkeeping (empenho/liquidação/NFe-aware), official document protocols and numbering, inter-department communication (ofícios/memorandos), council (Conselhos Municipais) meeting management with Gov.br digital signatures, covenant (Convênios) tracking between the município and state/federal bodies, task/workspace management, and a digital document library. It is infrastructure for public administration, not a generic project-management tool — the domain vocabulary (empenho, concedente/convenente, protocolo oficial) and the Gov.br OAuth/signature integration are first-class, not bolted on.

## 3. The Problem Right Now

An audit of the codebase (backend, frontend, and local infrastructure) surfaced a set of structural problems that all point at the same root cause: **the project scaled its cloud infrastructure ambitions (Supabase, targeting 5,000+ concurrent users) before the MVP itself was stable, tested, and usable end-to-end.** Concretely:

- **Three different Postgres targets exist simultaneously** with no single source of truth: the working `.env` points at a remote Supabase Supavisor pooler with live credentials; `docker-compose.yml`/`.env.example` describe a fully local Postgres 16 container; and `render.yaml` provisions yet a third, independent Postgres on Render for the shared cloud "dev" deployment. Running `docker-compose up` today does *not* connect the app to the database it just started.
- **The backend cannot boot without live cloud credentials.** The Zod environment schema (`src/config/config.ts`) declares `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_JWT_SECRET` as mandatory — a contributor cannot run the app fully offline/locally even if they never touch a Supabase-dependent feature.
- **Security-sensitive bugs exist in the auth path**: an admin-created user's temporary password is returned directly in the API response body instead of only being emailed; a 401 handler leaks raw internal error objects to API clients; a required native dependency (`@node-rs/argon2`, used for all password hashing) was found missing from `node_modules`, meaning login/registration would throw at runtime until reinstalled.
- **The frontend has no working navigation below 1024px viewport width.** The mobile drawer code for the sidebar exists but is fully disconnected — there is no hamburger trigger anywhere in the app, so the entire nav disappears on tablet and phone screens with no way to recover it.
- **UI/UX is inconsistent with the "clean modern dashboard" bar the team wants to hit**: the same "stat cards + chart" pattern is implemented twice, differently, in two different pages; a real design-token system exists but most feature pages bypass it with hardcoded hex colors, meaning dark mode (already wired end-to-end at the CSS level) would render half the app in the wrong theme if ever toggled.
- **There is no formal spec-driven process.** Feature work has historically been captured in ad-hoc, per-session design docs (`docs/superpowers/`) rather than a structured, falsifiable spec format — useful historical context, but not a repeatable process.

## 4. The Decision: Local-First MVP Pivot

**We are pivoting away from the cloud-scaled architecture (Supabase as the mandatory database/auth backend) and back to a Local-First MVP model.**

**Context:** In June 2026, significant engineering effort went into migrating SIMP's database layer onto Supabase specifically to support 5,000+ concurrent users — including Supavisor pooler configuration, read-replica support, RLS-hardened migrations, and a dedicated performance migration (`20260608_supabase_performance`). That work is real and is preserved in git history, but it solved a scaling problem the product does not have yet: SIMP is still at MVP stage, has known P0 bugs blocking reliable local development, and has a UI that isn't yet stable enough to onboard the users that scaling work was meant to serve.

**Decision:** Supabase is retired from the active stack — not just as the *local* database, but from the codebase entirely, including the one real runtime dependency on Supabase Auth (`supabaseAdmin.auth.admin.createUser` in the admin user-creation flow, which will be replaced with the app's existing local ID generation + `argon2` + `nodemailer`/MailHog invite flow). **Local Docker Postgres becomes the single source of truth for every development environment.** This is a conscious reversal, not an oversight — it trades "ready to scale to 5,000 users" for "every engineer can `docker compose up -d` and be productive in minutes, with zero cloud credentials, zero ambiguity about which database is authoritative." Scaling work can be revisited deliberately once the MVP is stable and the product has traction that justifies it — at that point it should go through a proper Spec Kit spec, not be reintroduced as an artifact of unresolved local/cloud config drift.

Render continues to host its own independent Postgres for the shared cloud "dev" deployment (used for demos/staging) — this is a legitimate, clearly-scoped second environment, not a conflict, once local dev no longer has any dependency on Supabase.

## 5. Primary Goals

These are the measurable outcomes of the current stabilization phase:

1. **Zero-cloud-credential local boot.** A new contributor can clone `SIMP-BACKEND`, run `docker compose up -d` followed by `npm install && npm run dev`, and reach a fully working API — including login — without possessing or configuring any Supabase, Render, or other cloud credential.
2. **Single source of truth per environment.** Exactly one Postgres instance is authoritative for local dev (Docker), and exactly one for the shared cloud "dev" deploy (Render) — documented explicitly in `TechStack.md` so this is never re-litigated by accident.
3. **pgAdmin 4 available locally.** A local Postgres GUI (pgAdmin 4) is reachable via `docker compose up -d` with a pre-configured connection to the local database — no manual setup step required on first run.
4. **All P0 punch-list items closed** (see `TechStack.md` §11 for the live register): the Supabase removal, the broken `docker/postgres/init.sql` mount, the missing `@node-rs/argon2` binary, the undeclared `fastify` dependency, the temp-password and error-leak security issues, the incomplete env-validation schema, and the disconnected mobile navigation drawer.
5. **Working navigation at every breakpoint.** The app must be usable — including opening and closing primary navigation — at common phone (375px), tablet (768px), and desktop (≥1024px) widths.
6. **Every new feature request becomes a Spec Kit spec.** Once `.specify/` is initialized (see `TechStack.md` §9), no new module or significant feature change lands without a spec that references `AppFeatures.md` for existing behavior and `TechStack.md` for architectural constraints.

## 6. Non-Goals

To keep this stabilization effort scoped, the following are explicitly **out of scope** right now:

- **No monorepo/workspace migration.** `SIMP-BACKEND` and `SIMP-FRONTEND` stay two independent git repositories with independent CI/CD (GitHub Actions → Render, GitHub Actions → Vercel). No Turborepo/Nx/Lerna, no root-level `package.json`.
- **No abandoning Render or Vercel for production/staging deploys.** The Local-First pivot is about *development*, not about self-hosting production infrastructure.
- **No full visual redesign or rebrand.** UI modernization means fixing structural responsiveness and consolidating duplicated patterns — not a new brand identity or a different design language than the shadcn/ui + Tailwind token system already in place.
- **No frontend or backend framework replacement.** React 19/Vite/Fastify 5/Prisma stay as-is; this is a stabilization and consolidation effort, not a rewrite.
- **No re-adoption of Supabase within this phase.** If revisited later, it goes through a dedicated spec with an explicit trigger (real user-scale evidence), not silently reintroduced.

## 7. Success Metrics / Definition of Done

- A fresh clone → running local stack (backend + frontend + Postgres + Redis + pgAdmin4) in under 10 minutes, following only the README/quickstart, with zero manual credential lookups.
- Zero open P0 items in the technical debt register (`TechStack.md` §11).
- Sidebar navigation opens/closes correctly at 375px, 768px, and 1024px+ viewport widths, verified manually in a browser.
- `docs/ProjectGoals.md`, `docs/AppFeatures.md`, and `docs/TechStack.md` exist and are the documents referenced by the first Spec Kit spec written after this effort.

## 8. Phasing at a Glance

- **Phase 0 — Stabilization (P0 punch list):** Supabase removal, Docker/pgAdmin4 wiring, security fixes, mobile-nav reconnection. Tracked as individual Spec Kit specs once initialized; not executed as part of this documentation effort.
- **Phase 1 — UX Modernization:** consolidate the duplicated dashboard/StatCard pattern, enforce design-token usage across feature pages, adopt React Hook Form + Zod for frontend forms.
- **Phase 2 — Spec-Driven Development Rollout:** initialize `.specify/` in `SIMP-BACKEND` (canonical for cross-cutting specs) and `SIMP-FRONTEND` (frontend-only specs); all subsequent feature work flows through `/specify` → `/plan` → `/tasks`.

## 9. Related Documents

- [`AppFeatures.md`](./AppFeatures.md) — module-by-module inventory of what SIMP does today, rewritten as testable requirements.
- [`TechStack.md`](./TechStack.md) — corrected technology stack, local environment architecture, deploy topology, and the full prioritized technical debt register.
- `docs/superpowers/{specs,plans}/` — historical, informal design docs from prior sessions; useful context, not a substitute for Spec Kit.
