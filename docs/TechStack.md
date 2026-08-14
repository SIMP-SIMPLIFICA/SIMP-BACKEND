# SIMP Simplifica — Tech Stack

**Status:** Active | **Version:** 1.0 | **Last updated:** 2026-07-16
**Owns:** the "how" — the corrected, canonical technology stack and local environment architecture. Supersedes `README.md`'s and `.env.example`'s drifted descriptions where they disagree with this document. Paired with [`ProjectGoals.md`](./ProjectGoals.md) (the "why") and [`AppFeatures.md`](./AppFeatures.md) (the "what").

## 1. Purpose

Both `SIMP-BACKEND/README.md` and `.env.example` have drifted from actual behavior (see the technical debt register in §11). This document is the one meant to stay accurate going forward — when in doubt about what technology SIMP uses or how local dev is supposed to work, trust this file, and fix the README/`.env.example` to match it rather than the reverse.

## 2. High-Level Architecture

SIMP Simplifica is **two independent Git repositories**, each with its own CI/CD, communicating over HTTP/JSON — there is no shared code, no monorepo tooling (no Turborepo/Nx/Lerna), and the parent folder `D:\PROJECTS\SIMPLIFICA` is not itself a Git repository.

```
SIMP-BACKEND   — Fastify 5 + TypeScript API, Prisma/PostgreSQL, deployed to Render
SIMP-FRONTEND  — React 19 + Vite SPA, deployed to Vercel, talks to the API via VITE_API_URL
```

## 3. Backend Stack (`SIMP-BACKEND`)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 | Standardize everywhere — see §10, this is currently inconsistent. |
| Web framework | Fastify **5** (`@fastify/*` plugin family v9-11) | **Must be declared as an explicit direct dependency** in `package.json` — today it only resolves transitively via `fastify-type-provider-zod`'s peer dependency, which is fragile. |
| Language | TypeScript 5.9 | |
| ORM / DB | Prisma 6.19 + PostgreSQL 16 | `previewFeatures = ["relationJoins", "postgresqlExtensions"]`; the `unaccent` extension is declared for accent-insensitive search. |
| Validation | Zod 3.25 | Drives both the env-config schema (`src/config/config.ts`) and request/response schemas (`fastify-type-provider-zod`). One validation library across the whole backend — keep it that way. |
| Auth (token issuance) | `jose` | Issues access + refresh JWTs. |
| Auth (token verification) | `@fastify/jwt` | Used **only** to verify (`request.jwtVerify()`) — its own `.sign()`/`reply.jwtSign()` is never called. The `sign: { expiresIn: '15m' }` config block in `src/config/plugins.ts` is dead and should be removed to avoid misleading future readers; actual token lifetime is controlled by `JWT_ACCESS_EXPIRES_IN`. |
| Password hashing | `@node-rs/argon2` (native Rust binding) | Load-bearing for all login/register/admin-created-user flows — if `node_modules` is missing the platform binary (`@node-rs/argon2-win32-x64-msvc` etc.), auth throws at runtime. Always run a clean `npm install` after pulling. |
| Cache / queues | `redis` (node-redis v4, direct dependency) **and** `ioredis` (v5, transitive via BullMQ) | Two different Redis client libraries exist in the dependency graph. This is not a bug — BullMQ needs `ioredis` internally — but document it so it stops being a debugging trap when diagnosing Redis connection issues. |
| Job queue | BullMQ 5 | Email and document-processing workers (`src/lib/document-queue.ts`, `email-queue.ts`). |
| Object storage | **Disco local** — pasta `uploads/` na raiz do backend, servida em `/uploads/` via `@fastify/static` | `src/services/storage.service.ts`. Substituiu o Cloudflare R2 em 2026-08-08 (Princípio I: zero credenciais de nuvem); o `@aws-sdk/*` foi removido do projeto. Ver o alerta de segurança em §11. |
| Email | `nodemailer` | Ethereal (fake inbox) or MailHog in dev, Brevo in production. |
| 2FA | `speakeasy` (TOTP) | Feature-flagged via `ENABLE_2FA`. |
| Digital signatures | Gov.br OAuth2 + signature API, with `USE_MOCK_GOVBR` mock mode for local dev | Used by the Councils module (`AppFeatures.md` §4.9). |
| Documents/PDF | `pdf-lib`, `pdf-parse`, `docxtemplater` + `pizzip`, `node-signpdf`, `node-forge`, `handlebars`, `archiver`, `qrcode` | |
| Logging | `pino`/`pino-pretty`, optional Betterstack (`@logtail/*`) shipping | |
| Error tracking | `@sentry/node` 10 | Conditionally no-ops when `SENTRY_DSN` is blank; a same-hostname-checked Sentry tunnel proxy exists at `POST /api/sentry-tunnel` to route around ad-blockers for frontend error reports too. |
| Testing | Vitest 4 | Coverage thresholds are currently zeroed in `vitest.config.ts` with an explicit comment acknowledging this is temporary — only 2 spec files exist for 28 controllers / 32 Prisma models today; raising this is tracked as P1. |
| ~~Auth/DB backend~~ | ~~Supabase~~ | **Retired.** See §5 and `ProjectGoals.md` §4 for the full rationale. `@supabase/supabase-js` and `src/lib/supabase.ts` are candidates for removal once `SUPABASE_*` is no longer required by `src/config/config.ts` and `user.controller.ts` no longer calls `supabaseAdmin.auth.admin.createUser`. |

## 4. Frontend Stack (`SIMP-FRONTEND`)

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19.2 | Current major, no upgrade needed. |
| Build tool | Vite 7 | `@vitejs/plugin-react`, `@` → `src` path alias. |
| Routing | react-router-dom 7 | `createBrowserRouter` data-router API (`src/router.tsx`). |
| Server state | TanStack Query 5 | All backend data must flow through it, per the project's own documented convention in `CLAUDE.md`. |
| UI components | shadcn/ui ("new-york" style) on Radix UI primitives + Tailwind CSS 3.4 | Single, coherent choice — no competing kit (no MUI/Ant/Chakra). |
| Icons | lucide-react | Single icon set, consistently used. |
| Charts | Recharts 3.8 | Already a dependency, already used correctly in `financeiro/FinanceiroOverview.tsx` — should be the *only* charting approach (see §11 P1 re: `Dashboard.tsx`'s hand-rolled bar chart). |
| Dates | date-fns 4 + `date-fns/locale/ptBR` | No moment/dayjs overlap. |
| Drag-and-drop | `@dnd-kit/{core,sortable,utilities}` | Powers the Workspaces Kanban board. |
| Exports | `jspdf` + `jspdf-autotable`, `xlsx` | |
| Forms | **None today — gap.** | No React Hook Form/Formik, no Zod/Yup on the frontend; every form is hand-rolled `useState` per field. **Adopt React Hook Form + `@hookform/resolvers` + Zod.** Same validation mental model as the backend (which already standardizes on Zod) — one less context-switch for whoever maintains both sides. Roll out via shadcn's official RHF+Zod `Form` component (addable through the existing `components.json` config), starting with the highest-value form being touched anyway (admin user creation, per the Supabase-removal work in §5), then migrate other forms opportunistically. |
| Theming | CSS-variable (HSL) token system in `src/index.css` + `tailwind.config.js`, full `.dark` theme, `darkMode: ["class"]` | Architecturally solid; **adoption is inconsistent** — see §11 P1 re: hardcoded hex/`slate-*` classes bypassing tokens in feature pages. |
| Testing | Vitest | |

## 5. Local Development Environment (resolved architecture)

**Single source of truth: local Docker Postgres.** No cloud credentials of any kind are required to run the full stack locally.

```
cd SIMP-BACKEND
docker compose up -d      # Postgres 16, Redis 7, MailHog, pgAdmin 4
npm install
npx prisma generate && npx prisma migrate dev
npm run db:seed
npm run dev                # Fastify API on :3000

# separate terminal
cd SIMP-FRONTEND
npm install
npm run dev                # Vite dev server, talks to :3000 via VITE_API_URL
```

`docker-compose.yml` (inside `SIMP-BACKEND`, not at the `D:\PROJECTS\SIMPLIFICA` root — the two apps stay independent repos, so no root-level compose file or root `git init` is introduced) defines:

| Service | Image | Port | Purpose |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | Local database — the only Postgres local dev talks to. |
| `redis` | `redis:7-alpine` | 6379 | App cache + BullMQ queue backend, password-protected. |
| `mailhog` | `mailhog/mailhog` | 1025 (SMTP), 8025 (Web UI) | Local email catcher for the auth/notification email flows. |
| `pgadmin` | `dpage/pgadmin4` | 5050 | **New** — local Postgres GUI, replacing Adminer. Pre-configured (via a mounted `servers.json`) with a connection to the `postgres` service so it's zero-click on first run. |

Two fixes land alongside this wiring (tracked in §11 as P0):
- `docker/postgres/init.sql` is currently an **empty directory** on disk rather than a `.sql` file, so its bind-mount silently no-ops instead of running init SQL. It becomes a real file containing `CREATE EXTENSION IF NOT EXISTS unaccent;` — defense-in-depth, since the Prisma `20260408032157_init` migration already creates this extension via `postgresqlExtensions`, but a stray empty directory should never sit in the repo pretending to be a script.
- `.env.example` is rewritten to describe **only** this local profile (local Postgres URL, local Redis URL matching the compose password, MailHog, `USE_MOCK_GOVBR=true`) — no Supabase section at all. **Update (2026-08-08)**: as variáveis `R2_*` foram removidas por completo — o armazenamento de arquivos agora é local em disco (`uploads/`), sem nenhuma credencial de nuvem; a URL pública dos arquivos é derivada de `APP_URL`.

## 6. Environment Topology / Deploy Targets

| Environment | Database | Purpose | Notes |
|---|---|---|---|
| **Local development** | Docker Postgres (`SIMP-BACKEND/docker-compose.yml`) | Every engineer's machine | **Source of truth for local dev.** Zero cloud credentials required. |
| **Render "dev" (cloud)** | Render-managed Postgres (`render.yaml`, `simp-db-dev`) + Render Redis | Shared cloud demo/staging, autodeploys from `develop` | Legitimate, separate environment — not a conflict once local dev no longer depends on Supabase. |
| **Frontend hosting** | — | Vercel (`vercel.json`) | Static SPA deploy; the CSP header's `SUBSTITUA_PELA_URL_DA_API` placeholder must be substituted with the real API URL (P1, see §11). |
| ~~Supabase~~ | ~~Supavisor pooler~~ | ~~Formerly targeted for 5,000+ concurrent user scaling~~ | **Retired**, see `ProjectGoals.md` §4. Not used by any environment going forward. |

## 7. Database

`prisma/schema.prisma` defines **32 models** across: Identity/Org (`Organization`, `OrganizationModule`, `User`, `Role`, `UserRole`, `UserSession`, `AuditLog`, `RevokedToken`, `Setting`, `Department`), Workspaces/Tasks, Communication, Finance, Virtual Process, Calendar/Notes, Library/GED, Convênios, Protocolos, Conselhos Municipais, and Support (full list and per-module detail in `AppFeatures.md`).

- **Multi-tenancy**: nearly every model carries `organizationId` cascading from `Organization`.
- **Migrations**: only 4 entries exist in `prisma/migrations/` (`init`, `add_organization_modules`, `department_is_active_code_unique`, `supabase_performance`) for a schema this large — the schema was largely hand-authored/reset rather than incrementally migrated. Going forward, every schema change should be a proper `prisma migrate dev` migration, not a manual reset.
- **`unaccent` extension**: created via the `init` migration's `postgresqlExtensions` preview feature; also defended by the `docker/postgres/init.sql` fix in §5.

## 8. CI/CD

Both repos have GitHub Actions CI (this is already solid and needs no structural change):

- **`SIMP-BACKEND/.github/workflows/`**: `ci.yml` (lint/typecheck/test against ephemeral Postgres 16 + Redis 7 service containers, plus CodeQL) → conditional deploy-hook curl to Render for `develop`/`main`; `security.yml` (npm audit + CodeQL + TruffleHog secret scanning); `pr-review.yml` and `failure-analyst.yml` (Claude-based automated PR review and CI-failure triage); `meta-agent.yml` (monthly dependency review).
- **`SIMP-FRONTEND/.github/workflows/`**: `ci.yml` (lint/typecheck/test+coverage/production build check); same `security.yml`/`pr-review.yml`/`meta-agent.yml` pattern.
- Both repos use `dependabot.yml` and are npm-only (no yarn/pnpm mixing) — consistent package manager choice.

## 9. Spec-Driven Development

GitHub Spec Kit is **not yet initialized anywhere** in this codebase (confirmed via full-text search — no `.specify/` directory exists in either repo). When it is:

- Initialize independently inside each repo: `SIMP-BACKEND/.specify/` and `SIMP-FRONTEND/.specify/`. Spec Kit's tooling (branch-per-spec, PR workflow) assumes a Git repo, and the `D:\PROJECTS\SIMPLIFICA` parent deliberately stays non-Git (per the confirmed decision to keep the two apps as independent repos — no root `git init`).
- **Cross-cutting/full-stack features** (the majority of real feature work — e.g. a new capability touching both API and UI) are homed canonically in `SIMP-BACKEND/.specify/`, since the backend defines the contract (routes, Prisma models, RBAC/module gating) the frontend consumes.
- `SIMP-FRONTEND/.specify/` is reserved for frontend-only specs that need no backend contract change (e.g. the mobile-nav fix, the dashboard consolidation, the React Hook Form rollout — all in §11).
- This document, `ProjectGoals.md`, and `AppFeatures.md` live in `SIMP-BACKEND/docs/` and should be referenced (not duplicated) from each repo's `.specify/memory/constitution.md` once Spec Kit is initialized.
- The existing `docs/superpowers/{specs,plans}/` folders in both repos are informal Claude Code design docs from prior sessions — not Spec Kit output. They're useful historical input (see `AppFeatures.md` §7) but should eventually be moved to a clearly-labeled archive folder so they aren't mistaken for live specs.

## 10. Version / Tooling Baseline

| | `SIMP-BACKEND` | `SIMP-FRONTEND` |
|---|---|---|
| Node version | `.nvmrc` = 22, but `Dockerfile` pins `node:20-alpine` and `package.json` `engines` says `>=20.0.0` — **inconsistent, standardize everything on 22** | No `.nvmrc`, no `engines` field at all, despite CI hardcoding Node 22 — **add both** |
| Package manager | npm (`package-lock.json`) | npm (`package-lock.json`) |
| Other lockfiles | none (no yarn/pnpm) | none |

Target baseline once corrected: **Node 22 everywhere**, npm only, lockfiles always committed.

## 11. Known Technical Debt Register

Living index into the full audit — see `ProjectGoals.md` §3 for narrative context. Do not re-derive these from scratch; update this table as items close.

**P0 — blocks local stabilization or is security-sensitive:**
- Remove mandatory `SUPABASE_*` from `src/config/config.ts`; remove `supabaseAdmin.auth.admin.createUser` from `user.controller.ts` (replace with local ID generation + existing `argon2`/`nodemailer` flow).
- Fix `docker/postgres/init.sql` (empty directory → real `.sql` file).
- Reinstall/rebuild `@node-rs/argon2` native binding.
- Declare `fastify` as an explicit direct dependency.
- Stop returning the admin-created temp password in the API response body — email-only.
- Stop leaking raw `details: err` in the 401 handler's JSON response.
- Complete the Zod env schema: `GOVBR_*`, `USE_MOCK_GOVBR`, `DATABASE_MIGRATION_URL`, `DATABASE_REPLICA_URL` are currently read via raw `process.env`, bypassing fail-fast validation. (As `R2_*` saíram desta lista em 2026-08-08 — foram removidas junto com o R2.)
- Reconnect the frontend Sidebar's mobile drawer: add a `useMediaQuery`/`matchMedia` hook, lift `mobileOpen` state into `AppLayout.tsx`, add a hamburger trigger in `Topbar.tsx` (`lg:hidden`), auto-close on route change.
- Add pgAdmin4 and remove Adminer from `docker-compose.yml`.

**P1 — correctness/tech-debt, soon but non-blocking:**
- Unify the triplicated RBAC/permission-resolution logic (`rbac.service.ts`, `utils/database.ts`, `middleware/auth.middleware.ts`) into one source of truth. **Update (2026-07-17)**: RBAC *provisioning* (as opposed to resolution) is now consolidated — both `admin.controller.ts` and `organization.controller.ts` previously looked up the "admin" `Role` via a silently-failing `findFirst` (no such role was ever seeded anywhere), so newly created organizations got an admin `User` with zero `UserRole` linkage. Fixed via `ensureAdminRole()` in `rbac.service.ts` (a transaction-safe `upsert`) plus a shared `src/constants/permissions.ts` permission catalog — see `.specify/specs/org-admin-onboarding.md`. **Update (2026-07-21)**: the fix above only covered organizations created *after* it shipped — existing admins (e.g. one real production-shaped account, `carlos@gmail.com`) still had zero `UserRole` rows and could not create Workspaces or generate protocols. Closed via a one-time idempotent `prisma/scripts/backfill-admin-roles.ts` (safe to re-run against any environment); the permission catalog also gained the `workspaces:read/write/manage` and `tasks:read` keys that routes already referenced but the catalog never defined — see `.specify/specs/epic1-security-rbac.md`. Permission *resolution* (the three-way duplication above) is still open.
- **Closed (2026-07-21)**: `src/routes/communication.routes.ts` defined its own inline `onRequest` auth hook that duplicated ~90% of the shared `authenticate` middleware but omitted the `organizationId`/`isSuperAdmin` normalization it performs — when `organizationId` reached the controller as `undefined`, Prisma's `where` clause treated it as "no filter," leaking every organization's recipients/inbox/sent messages to any authenticated user. Fixed by replacing the inline hook with the shared `authenticate` middleware and adding an explicit fail-closed check (`getOrgFilter()`) in `communication.controller.ts` that returns 403 instead of an unscoped query if org context is ever missing — see `.specify/specs/epic1-security-rbac.md`.
- **Closed (2026-07-21, Épico 2)**: three further RBAC/validation gaps found while investigating reported UX bugs. (1) `communication.controller.ts` gated message recipients/sending behind `communication:read` — a key that never existed in any role's permissions, blocking every user (including admins) from messaging anyone but themselves; removed the gate entirely rather than re-adding the missing key, since receiving an internal message is baseline organizational reachability, not an elective module permission (unlike `workspaces:read`/`tasks:read`, which remain intentionally gated for Workspaces/Tasks membership). (2) `protocol.controller.ts`'s `generateSchema` validated `departmentId` with Zod's `.uuid()`, but `Department.id` is a `nanoid()` (see `workspace.schemas.ts` for the correct precedent) — every real department selection was rejected with "invalid uuid"; fixed by relaxing to `z.string().min(1)`. (3) Introduced `protocols:normativo`/`protocols:comunicacao` as additive granular permissions (existing `protocols:write`/`protocols:admin` still grant both categories, unchanged) — see `.specify/specs/epic2-ux-protocols.md`. Also established `prisma/scripts/sync-admin-role-permissions.ts`, a reusable idempotent script that pushes new catalog keys into the already-existing "admin" role (a gap `ensureAdminRole()`'s `update: {}` upsert never covers, since it only sets permissions on first creation).
- Split the `utils/database.ts` "god object" (DB health, transactions, pagination, sessions, audit, permissions, settings all in one ~300-line file) into focused modules.
- Resolve the route-mounting inconsistency (`/api/v1/*` vs root-mounted, see `AppFeatures.md` §5) and correct the README's route table.
- Remove the dead `@fastify/jwt` sign-config block in `src/config/plugins.ts`.
- Remove the dead `puppeteer` reference (`PUPPETEER_SKIP_DOWNLOAD`) from `render.yaml` — no such dependency exists.
- Relocate/gitignore debug scripts committed at the backend repo root (`check_db.js`, `check_users.js/ts`, `run_seed.js`); stop committing compiled build artifacts alongside source (`tests/setup.js`, `prisma/seeds/seed.js` + `.map`/`.d.ts`).
- Remove the broken `env:local`/`env:supabase` npm scripts (reference files that don't exist; moot entirely once Supabase is retired).
- Fix the "permissão militar" Portuguese typo in `auth.middleware.ts`'s 403 message.
- Fix the `vercel.json` CSP's unsubstituted `SUBSTITUA_PELA_URL_DA_API` placeholder.
- Fix Node version mismatch (see §10).
- Consolidate the duplicated dashboard/StatCard pattern: extract a shared `StatCard`/`MetricGrid` component (token-based, not `slate-*`) used by both `Dashboard.tsx` and `FinanceiroOverview.tsx`; replace `Dashboard.tsx`'s hand-rolled div-based bar chart with Recharts.
- Replace hardcoded hex colors (`#0A5BC4`/`#094FA8` in `FinanceiroOverview.tsx` and `Roles.tsx`) with the real `--primary` token (`#0369A1`) so dark mode renders correctly across feature pages, not just `components/ui/*` primitives.
- Adopt React Hook Form + Zod on the frontend (see §4).
- Remove dead frontend code: `SidebarLegacy.tsx` (473 lines, unimported), orphaned `App.tsx`/`App.css` Vite scaffold leftovers.
- Remove the unused `"tree": "^0.1.3"` frontend dependency.
- Resolve the two open Councils TODOs (see `AppFeatures.md` §4.9).
- Rename frontend `.env.exemple` → `.env.example`; add frontend `.nvmrc` and `engines`.

- **Fechado (2026-08-08) — padrão recorrente `z.string().uuid()` vs. `nanoid()`**: segunda ocorrência. `updateStatusSchema` em `protocol.controller.ts` validava `libraryDocumentId` com `.uuid()`, mas `LibraryDocument.id` é `@default(nanoid())` — todo "Anexar PDF" falhava com HTTP 400. Mesma causa que já atingira `departmentId`/`Department.id` no Épico 2. **Varredura completa feita**: todos os demais `.uuid()` do código (`Covenant`, `BankAccount`, `FinanceCategory`, `FinanceEntry`, `VirtualProcessCategory`, `Workspace`, `OfficialDocument`) apontam para modelos que realmente usam `@default(uuid())` — não há outro descasamento hoje. Como 27 dos ~50 modelos usam `nanoid()`/`cuid()`, **a regra ao escrever um schema Zod é conferir o `@default` do modelo antes de usar `.uuid()`**; na dúvida, `z.string().min(1)`.
- **Aberto (2026-08-08, Hotfix armazenamento local) — SEGURANÇA**: os arquivos enviados são servidos por `@fastify/static` em `/uploads/` **sem autenticação**. Isso inclui documentos da Biblioteca com nível de sigilo (`LibraryDocument.accessLevel`), cuja verificação hoje só acontece no endpoint de download — quem tiver a URL acessa o arquivo direto. A proteção prática é o nome de arquivo aleatório (`crypto.randomBytes(8)`), o que é *segurança por obscuridade*, não controle de acesso. Aceito conscientemente para agilizar o desenvolvimento local. **Antes de qualquer uso com dado real de prefeitura, arquivos sigilosos devem voltar a ser servidos por um endpoint autenticado** (ex: `reply.sendFile()` após a checagem de `accessLevel`, em vez do estático). Ver `.specify/plans/hotfix-local-upload-protocols.md`, Decisão 3.
- **Aberto (2026-08-08)**: a migration history do Prisma está com drift — `20260408032158_add_organization_modules` falha ao aplicar no shadow database (`relation "organization_modules" already exists`), o que impede `prisma migrate dev`. O fluxo em uso é `prisma db push` + SQL aplicado manualmente (ver `prisma/sql/`). Reconstruir o histórico de migrations é pré-requisito para qualquer deploy que dependa de `migrate deploy`.
- **Aberto (2026-08-08)**: não houve migração retroativa dos arquivos hospedados no Cloudflare R2. Registros criados antes desta mudança continuam no banco, mas seus arquivos não existem em disco local — o download desses registros falhará. Se houver dado relevante no R2, exige uma tarefa de migração dedicada.
- **Fechado (2026-08-08, Hotfix)**: quarta ocorrência do padrão de permissão fantasma — `src/routes/notification.routes.ts` referenciava `notifications:read`, `notifications:write` e `notifications:manage`, e **nenhuma das três** existia no catálogo, deixando a campainha de notificações em HTTP 403 para 100% dos usuários. As três foram adicionadas a `src/constants/permissions.ts` e sincronizadas via `prisma/scripts/sync-admin-role-permissions.ts`. Padrão recorrente (Épico 1: `workspaces:*`/`tasks:read`; Épico 2: `communication:read`) — **vale um teste automatizado que falhe quando uma rota referenciar uma chave ausente do catálogo**, o que fecharia essa classe de bug de vez.

- **Nota de arquitetura (2026-08-09, Épico 3) — kill switch de organização**: a trava de suspensão vive dentro de `authenticate` (`src/middleware/auth.middleware.ts`), com **retorno antecipado do Super Admin antes de qualquer consulta**. Essa ordem é um requisito de segurança, não estilo: invertê-la faria a suspensão de todas as organizações bloquear o próprio Super Admin, tornando a reativação impossível pela interface. O status é cacheado 60s em memória com invalidação explícita na alternância (mesmo padrão do `moduleCache`) — alterar `organizations.is_active` direto no SQL leva até 60s para surtir efeito, enquanto pelo painel o efeito é imediato. Detalhes em `docs/AppFeatures.md` §3.5.1 e `.specify/plans/epic3-org-suspension.md`.

- **Parcialmente fechado (2026-08-09, Épico 3) — duplicação de helpers de moeda**: `formatCurrencyInput` estava reimplementado em três arquivos (`UniversalFinanceModal.tsx`, `CovenantFormDialog.tsx`, `EntryFormDialog.tsx`) e a formatação de exibição BRL em ~5 lugares. Em vez de criar a quarta cópia para Processos Virtuais, extraí `SIMP-FRONTEND/src/lib/currency.ts` (`formatCurrencyBRL`, `formatCurrencyInput`, `sanitizeCurrencyInput`, `parseCurrencyInput`). **As três cópias existentes não foram migradas** — devem passar a importar do módulo compartilhado quando cada arquivo for tocado. Nota associada: o `Decimal` do Prisma chega ao JSON como **string**, então valores monetários precisam de `Number(...)` antes de qualquer aritmética (`"1500.00" + 100` produziria `"1500.00100"`).

**P2 — cleanup, no urgency:**
- Archive `docs/superpowers/{specs,plans}/` clearly as historical once Spec Kit is initialized.
- Raise Vitest coverage gradually from its current placeholder baseline (2 spec files for 28 controllers).
- Fix the stale `package.json` name (`"fastify-auth-boilerplate"`) and description (`"Stable Fastify v4 Backend"` — the app runs Fastify 5).
- Delete the empty, unused `src/modules/` scaffold directory.
- Reconcile `nanoid` vs `uuid` (both present; pick one once actual usage is audited).
- Limpar as referências residuais a `R2_*` em `render.yaml` e no README — o R2 foi removido do código em 2026-08-08, então essas variáveis não são mais lidas em lugar nenhum.
