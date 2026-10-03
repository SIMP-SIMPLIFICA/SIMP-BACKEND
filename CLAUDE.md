# CLAUDE.md — SIMP Backend

Guia de contexto absoluto para o Claude Code trabalhar neste repositório. Leia integralmente antes de qualquer tarefa. O passo a passo detalhado de tarefas recorrentes está nas skills em `.claude/skills/`.

---

## Visão geral

Backend do **SIMP — Sistema Integrado de Modernização e Processos**. SaaS B2B multi-tenant para prefeituras e órgãos públicos municipais. Cada cliente é uma **Organização** isolada.

**Colaboradores:**
- **Marllon** — auth, financeiro, RBAC, organizações
- **Carlos** — workspaces, comunicação, processos virtuais, convênios, protocolos, GED/biblioteca, Frotas

**Stack:** Node.js 22 · TypeScript (CommonJS) · Fastify 5 · Prisma + PostgreSQL · Zod (`fastify-type-provider-zod`) · BullMQ + Redis · JWT (`@fastify/jwt`) + Argon2 · Nodemailer + Handlebars · Pino + Logtail · Sentry · pdf-lib, docxtemplater, pizzip, node-signpdf.

---

## Comandos

```bash
npm run dev              # tsx watch (hot reload)

# Banco de dados
npm run db:generate      # prisma generate — OBRIGATÓRIO após mudar schema.prisma
npm run db:migrate       # prisma migrate dev — criar migration nomeada (ver TASK 0 abaixo)
npm run db:studio        # Prisma Studio (GUI)
npm run db:seed          # seed principal (bootstrap mínimo: zera tudo, cria um Super Admin)
# db:push e db:reset existem, mas são NEGADOS ao Claude (.claude/settings.json) — só humanos rodam

# Build / Produção
npm run build            # tsc + tsc-alias
npm run start            # node dist/src/index.js

# Qualidade
npm run type-check       # tsc --noEmit — type check real deste repo
npm run lint             # eslint src
npm test                 # vitest — unitários (src/**/*.spec.ts, exclui *.e2e.spec.ts)
npm run test:e2e         # integração: Fastify real + Postgres real (banco <nome>_e2e)
npx vitest run src/services/foo.spec.ts                                   # um arquivo
npx vitest run -t "nome do teste"                                         # um teste pelo nome
npx vitest run -c vitest.config.e2e.ts src/tests/daily-allowance.e2e.spec.ts  # um e2e
```

> **TypeScript:** aqui `tsc --noEmit` funciona (o tsconfig não usa project references), mas `strict: false` e o tsconfig **exclui `*.spec.ts`** — erro de tipo em teste não aparece no type-check. **Não use `npx tsc -b` para checar**: neste repo ele compila e escreve em `dist/`.
>
> **CommonJS:** nunca mudar `"module"` para ESM. Nunca usar `import.meta.url`; usar `__dirname`.
>
> **E2E:** truncam tabelas. Rodam num banco separado derivado de `DATABASE_URL` com sufixo `_e2e` (ou `E2E_DATABASE_URL`), com trava em 3 camadas em `src/tests/e2e-database.ts` — nunca contornar. O schema do banco de teste é criado por `prisma db push` em `src/tests/global-setup-e2e.ts`. Skill: `simp-teste-e2e`.

---

## Arquitetura

Camadas, sem pasta por módulo: `src/routes/` (registro + guards) → `src/controllers/` (HTTP, Zod, mapa de erro) → `src/services/` (regra de negócio, Prisma). Também: `src/config/` (`config.ts` com env validada por Zod, `routes.ts`, `plugins.ts`), `src/middleware/` (`auth.middleware.ts`: `authenticate`, `requirePermission`, `requireModule`), `src/constants/` (`modules.ts`, `permissions.ts`), `src/lib/` (`prisma`, `email-queue`, `document-queue`), `src/jobs/` (node-cron), `src/utils/` (`error-handler`, `serializable-retry.util`…), `src/tests/` (e2e + helpers).

### Multi-tenant — isolamento por organização

**Toda** query filtra por `organizationId`, que vem do token. SuperAdmins (`isSuperAdmin: true`) não têm `organizationId` e veem tudo.

```typescript
const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
const orgFilter = isSuperAdmin ? {} : { organizationId }
```

### RBAC

Permissões são strings `dominio:acao` em `Role.permissions: string[]`, catalogadas em `src/constants/permissions.ts` (`AVAILABLE_PERMISSIONS`). A role global `admin` se ressincroniza com o catálogo via `ensureAdminRole` (`src/services/rbac.service.ts`). `requirePermission([...])` (alias `requireAnyPermission`) reconsulta as roles no banco a cada requisição; `isSuperAdmin` e `system:admin` são bypass.

### Módulos por organização

Definidos em `src/constants/modules.ts`: `tasks, finance, communication, virtual_processes, calendar, notes, departments, library, covenants, protocols, councils, support, dailyAllowances, fleetFuelings`.

- **Padrão** ao criar organização (`DEFAULT_MODULES`): `tasks, finance, communication, calendar, notes, departments, library, covenants, dailyAllowances, fleetFuelings`.
- **Manuais** (super admin, por contrato): `virtual_processes, protocols, councils, support`.

`requireModule('chave')` confere `OrganizationModule.isEnabled` (cache 5 min) e responde `403 MODULE_DISABLED`. Skill: `simp-novo-modulo`.

### Fastify v5 — hooks SEMPRE async

```typescript
fastify.addHook('onRequest', async (request) => { ... })            // CORRETO
fastify.addHook('onRequest', (request, reply, done) => { done() })  // ERRADO — trava requests
```

---

## Regras de negócio críticas

1. **Convênios × Processos Virtuais:** N:M pela pivot `_CovenantToVirtualProcess`; vínculo por `POST /covenants/:id/link-process` e `/unlink-process`. Criar `CovenantType` cria a `VirtualProcessSource` de mesmo nome (sync **unidirecional**: apagar o tipo não apaga a origem).
2. **Protocolos (`POST /protocols/generate`):** `NORMATIVO` é sempre `SEQUENTIAL` no setor `CENTRAL`; `COMUNICACAO` é `SEQUENTIAL` ou `RANDOM` (6 hex de `randomBytes(3)`) por setor. O sequencial é um `upsert` com `increment` em `SequenceControl` dentro de `$transaction`. Formatos: `DECRETO Nº 042/2026`, `OFÍCIO Nº 015/2026 - SAÚDE`, `OFÍCIO Nº A3F9C1/2026 - SAÚDE`. `PATCH /protocols/:id/status`: `protocols:admin` muda qualquer status; o criador só marca os próprios como `EMITIDO`; `CANCELADO` exige `cancelReason`; `libraryDocumentId` vincula o PDF do GED.
3. **OCR desabilitado de propósito:** o worker em `src/lib/document-queue.ts` só loga e descarta (pdf-parse instável + custo de CPU). Não reativar sem discussão. Erro de OCR no terminal = servidor com código antigo em memória; reiniciar.
4. **GED:** `POST /api/v1/library/upload` (multipart) devolve `LibraryDocument.id`, usado em `PATCH /protocols/:id/status { status: 'EMITIDO', libraryDocumentId }`.
5. **Uploads:** chave `organizations/{orgId}/{escopo}/{arquivo}`; sempre devolver URL assinada, nunca a chave crua. ⚠️ Hoje `saveFile` (`src/services/storage.service.ts`) grava em **disco local**, não no R2 — divergência registrada em `docs/frotas/decisoes.md`, sem correção por enquanto.
6. **Comunicação:** `CommunicationDocument` com threads via `parentId`; deep link `?msgId=`.
7. **Documento oficial (Diárias, Frota):** `PENDING → ISSUED` com PDF + `sha256Hash` + `publicId` + `ExportedDocument`. Skill: `simp-documento-oficial`.

---

## Padrões de código

- Controller: valida com Zod, chama o service com o escopo do token, traduz erros de domínio por um mapa `STATUS_BY_CODE` (ver `src/controllers/daily-allowance.controller.ts`). `ZodError` → 400 com `issues`; nunca usar `.message` do ZodError direto.
- `authenticate` em toda rota com dado de usuário; `userId` sempre do JWT, nunca do body.
- `select` explícito no Prisma — nunca retornar `password`, `refreshToken`, `resetToken`.
- Sem `any` (`@typescript-eslint/no-explicit-any`): `unknown` + type guard.
- Operações atômicas em `prisma.$transaction(async tx => ...)`; numeração concorrente em transação `Serializable` com `withSerializableRetry`.
- Auditoria via `auditLedgerService.record` (`src/services/audit-ledger.service.ts`). Skill: `simp-auditoria`.

---

## Invariantes do SIMP (nunca violar)

1. `organizationId` sempre vem de `request.user`, nunca do body, da query ou da URL. Em código novo, o service recebe `organizationId` como **primeiro parâmetro** e o aplica em toda query.
2. `Department.id` é `nanoid`; o schema mistura `uuid`, `cuid` e `nanoid`. **Nunca** validar `departmentId` com `.uuid()` — usar `z.string().min(1)`.
3. Documento `ISSUED` é imutável **no backend** (update/delete recusados, não só escondidos na UI); PDF e `sha256Hash` nunca são regenerados.
4. Saldo QDD é calculado na leitura (`budgetService.getBalancesForItems`) e nunca persistido; estouro grava `budgetOverrun: true` e **não bloqueia**.
5. Conferir o prefixo em `src/config/routes.ts` antes de assumir `/api/v1` — parte das rotas está na raiz (`/finance`, `/covenants`, `/protocols`, `/departments`…).
6. Toda escrita do Frotas grava auditoria via `auditLedgerService.record(data, tx)` **na mesma transação**; se a auditoria falhar, a operação falha. Ações em `UPPER_SNAKE` (`FLEET_AUTHORIZATION_ISSUED`). Hoje `record` ainda não aceita `tx` — é pré-requisito da TASK 1.
7. Dinheiro em `Decimal(15,2)`, litros em `Decimal(10,3)`, preço unitário em `Decimal(10,4)`. Nunca `Float`; nunca aritmética com `Number` — usar `Prisma.Decimal`. Centavos `Int` só onde já existem (`BankAccount`, `FinanceEntry`).
8. Zod `.strict()` em toda rota **nova**. Erros de negócio por classe de domínio + `STATUS_BY_CODE` (no Frotas: `FleetError`), com mensagem que diz o que aconteceu, o dado concreto e o que fazer. Nunca expor nome de constraint, stack ou dado de outra organização.
9. Tarefa só termina com `npm run lint`, `npm run type-check` e os testes (`npm test` e, se tocou rota, `npm run test:e2e`) passando.

---

## Módulo Frotas

Especificações versionadas neste repositório, em `docs/frotas/` (o SIMP-FRONTEND aponta para cá):

- **`decisoes.md` — decisões que se sobrepõem à spec.** Ler primeiro.
- `Simplifica Frotas — Especificação Técnica de Desenvolvimento.md` — TASKs 1 a 10 e checklist de go-live.
- `Simplifica Frotas — Especificação Funcional e Arquitetural.md` — domínio, regras GFI, fluxos.
- `Documentação Técnica SIMP.md` — visão do SIMP como um todo.

Como trabalhamos:
- **Uma TASK por sessão**, na ordem da spec técnica, precedida da **TASK 0** (migration de baseline, descrita em `decisoes.md`, D5).
- O `FleetFueling` atual (model, service, controller, rotas, telas) **será apagado e recriado do zero** na TASK 1 como autorização de abastecimento; o nome do model e a chave de módulo `fleetFuelings` são mantidos.
- Regras de código do Frotas: `.claude/rules/fleet.md` (carregadas ao tocar `src/**/*fleet*`).
- Antes de concluir uma TASK, rodar o agente `simp-security-reviewer`.

---

## CI/CD e Deploy

- `ci.yml` — lint + tsc + vitest + build · `security.yml` — npm audit + CodeQL + TruffleHog + Claude Security Review (PRs) · `failure-analyst.yml` — CI falha → Claude Haiku → Issue + Discord.
- Deploy no Render a partir de `develop`. Build: `npm ci --include=dev && npx prisma generate && npm run build`. Start: `npx prisma migrate deploy && node dist/src/index.js`.
- Secrets GitHub: `ANTHROPIC_API_KEY`, `RENDER_STAGING_DEPLOY_HOOK`, `RENDER_DEPLOY_HOOK`, `DISCORD_WEBHOOK_URL`.

---

## Módulos e responsabilidades

| Módulo | Responsável | Status |
|--------|-------------|--------|
| Auth / JWT · Users / Roles RBAC · Financeiro · Organizações / Admin | Marllon | ✅ |
| Workspaces + Tasks · Comunicação · Processos Virtuais · Convênios · Protocolos | Carlos | ✅ |
| Notificações (SSE) · Calendar / Notes | Carlos | ✅ |
| GED / Biblioteca | Carlos | 🔴 pendente refinamento |
| Frotas (substitui o `FleetFueling` atual) | Carlos | 🚧 em especificação |

Também existem no código: Diárias, Conselhos, Suporte, Feriados, Leis Orçamentárias, QDD, Auditoria e o Portal Público de validação.
