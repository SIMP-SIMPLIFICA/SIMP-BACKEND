# CLAUDE.md — SIMP Backend

Guia de contexto absoluto para o Claude Code trabalhar neste repositório. Leia integralmente antes de qualquer tarefa.

---

## Visão geral

Backend do **SIMP — Sistema Integrado de Modernização e Processos**. SaaS B2B multi-tenant para prefeituras e órgãos públicos municipais. Cada cliente é uma **Organização** isolada.

**Colaboradores:**
- **Marllon** — auth, financeiro, RBAC, organizações
- **Carlos** — workspaces, comunicação, processos virtuais, convênios, protocolos, GED/biblioteca

---

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 22 (LTS) |
| Linguagem | TypeScript (CommonJS) |
| Framework HTTP | Fastify 5 |
| ORM | Prisma + PostgreSQL |
| Validação | Zod (via `fastify-type-provider-zod`) |
| Filas | BullMQ + Redis |
| Storage | Cloudflare R2 (via `@aws-sdk/client-s3`) |
| Auth | JWT (`@fastify/jwt`) + Argon2 (`@node-rs/argon2`) |
| Email | Nodemailer + templates Handlebars |
| Logs | Pino + Logtail |
| Monitoramento | Sentry |
| Documentos | pdf-lib, docxtemplater, pizzip, node-signpdf |

---

## Comandos

```bash
# Desenvolvimento
npm run dev              # tsx watch (hot reload)

# Banco de dados
npm run db:generate      # prisma generate — OBRIGATÓRIO após mudar schema.prisma
npm run db:push          # prisma db push — dev (sem migration)
npm run db:migrate       # prisma migrate dev — criar migration nomeada
npm run db:studio        # Prisma Studio (GUI)
npm run db:seed          # seed principal

# Build / Produção
npm run build            # tsc + tsc-alias
npm run start            # node dist/src/index.js

# Qualidade
npx tsc -b               # type check REAL (tsc --noEmit NÃO funciona aqui)
npm run lint             # eslint src
npm run test             # vitest
```

> **ATENÇÃO — TypeScript:** `tsc --noEmit` não verifica nada neste projeto por causa da configuração do tsconfig. O check real é `npx tsc -b`.
>
> **ATENÇÃO — CommonJS:** Este projeto usa CommonJS. Nunca mudar `"module"` para `ESM`. Nunca usar `import.meta.url`. Usar `__dirname` nativamente.

---

## Arquitetura

### Multi-Tenant — Isolamento por Organização

**Toda** query no banco deve filtrar por `organizationId`. Nunca retornar dados de outra organização.

```typescript
// Padrão obrigatório em TODOS os controllers
const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
const orgFilter = isSuperAdmin ? {} : { organizationId }

const items = await prisma.covenantType.findMany({ where: { ...orgFilter } })
```

SuperAdmins (`isSuperAdmin: true`) não têm `organizationId` — podem ver todos os dados. Verificar sempre antes de aplicar o filtro.

### RBAC — Papéis e Permissões

Permissões são strings livres armazenadas em `Role.permissions: string[]`. Exemplos reais:

```
users:read, users:write, users:delete
finance:read, finance:write
covenants:read, covenants:write, covenants:delete
protocols:admin
virtual_processes:read, virtual_processes:write
library:read, library:write
```

O middleware `auth.ts` hidrata `request.user.permissions[]` a partir das roles do usuário. Controllers verificam assim:

```typescript
const hasAdmin = request.user.permissions?.includes('protocols:admin') || isSuperAdmin
if (!hasAdmin) return reply.code(403).send({ error: 'Forbidden' })
```

### Sistema de Módulos

Cada organização habilita/desabilita módulos. Definidos em `src/constants/modules.ts`:

```typescript
export const MODULES = {
  TASKS, FINANCE, COMMUNICATION, VIRTUAL_PROCESSES,
  CALENDAR, NOTES, DEPARTMENTS, LIBRARY, COVENANTS, PROTOCOLS
}

// Habilitados por padrão ao criar organização:
export const DEFAULT_MODULES = [TASKS, FINANCE, COMMUNICATION, CALENDAR, NOTES, DEPARTMENTS, LIBRARY, COVENANTS]
// VIRTUAL_PROCESSES e PROTOCOLS — habilitação MANUAL pelo super admin
```

O middleware verifica `OrganizationModule.isEnabled` antes de liberar rotas protegidas.

### Fastify v5 — hooks SEMPRE async

```typescript
// CORRETO
fastify.addHook('onRequest', async (request) => { ... })

// ERRADO — trava todas as requests silenciosamente
fastify.addHook('onRequest', (request, reply, done) => { done() })
```

### Estrutura de Arquivos

```
src/
├── controllers/     # Handlers HTTP (um por domínio)
├── routes/          # Registro de rotas + middlewares por módulo
├── middleware/       # auth, requirePermission, checkModule
├── lib/             # prisma, r2, document-queue, email-queue
├── constants/       # modules.ts
├── schemas/         # Zod schemas compartilhados
├── utils/           # logger, graceful-shutdown, database
├── jobs/            # Jobs agendados (node-cron)
├── services/        # Lógica de negócio reutilizável
└── index.ts         # Bootstrap do servidor
```

---

## Regras de Negócio Críticas

### 1. Convênios e Processos Virtuais

**Relacionamento N:M implícito** — um convênio pode estar vinculado a múltiplos processos e vice-versa. A tabela pivot `_CovenantToVirtualProcess` gerencia essa relação.

**Link/Unlink via endpoints dedicados:**
- `POST /covenants/:id/link-process { processId }`
- `POST /covenants/:id/unlink-process { processId }`
- O detalhe do processo virtual inclui convênios vinculados e vice-versa

**One-Way Sync — Tipos de Convênio → Origens de Processo Virtual:**

Ao criar um novo `CovenantType`, o sistema automaticamente cria uma `VirtualProcessSource` com o mesmo nome:

```typescript
// Em covenantTypeController.create():
const type = await prisma.covenantType.create({ data: { organizationId, name } })

// Sync unidirecional automático
const existingSource = await prisma.virtualProcessSource.findFirst({ where: { organizationId, name } })
if (!existingSource) {
  await prisma.virtualProcessSource.create({ data: { organizationId, name } })
}
```

**A sincronização é unidirecional.** Deletar um tipo de convênio **não** deleta a origem do processo virtual correspondente.

---

### 2. Protocolos — Numeração Oficial de Documentos

**Endpoint:** `POST /protocols/generate`

**Categorias e regras de numeração:**

| Categoria | Exemplos | Numeração | Sector |
|-----------|----------|-----------|--------|
| `NORMATIVO` | Lei, Decreto, Portaria, Edital | Sempre `SEQUENTIAL` centralizado | `CENTRAL` (forçado) |
| `COMUNICACAO` | Ofício, Memorando, CI, Nota | `SEQUENTIAL` ou `RANDOM`, por setor | Livre |

**Geração Sequencial — race condition protegida por transação Prisma:**

```typescript
const result = await prisma.$transaction(async (tx) => {
  return tx.sequenceControl.upsert({
    where: { organizationId_documentCategory_documentType_sector_year: { ... } },
    create: { ..., currentNumber: 1 },
    update: { currentNumber: { increment: 1 } },
  })
})
sequenceNumber = result.currentNumber
```

**Geração Aleatória (RANDOM):**

```typescript
import { randomBytes } from 'node:crypto'
const ref = randomBytes(3).toString('hex').toUpperCase()
// 6 chars hex = 16M+ possibilidades
```

**Formato final dos números:**
- Normativo: `DECRETO Nº 042/2026`
- Comunicação sequencial por setor: `OFÍCIO Nº 015/2026 - SAÚDE`
- Comunicação aleatória: `OFÍCIO Nº A3F9C1/2026 - SAÚDE`

**Atualização de Status — `PATCH /protocols/:id/status`:**

Aceita `{ status, cancelReason?, libraryDocumentId? }`.

| Regra | Detalhe |
|-------|---------|
| Admin (`protocols:admin`) | Pode mudar qualquer status de qualquer documento |
| Criador (sem permissão admin) | Pode marcar **apenas seus próprios** como `EMITIDO` |
| `CANCELADO` | Exige `cancelReason` obrigatório |
| `libraryDocumentId` | Se presente ao marcar EMITIDO, vincula o documento GED ao protocolo |

---

### 3. OCR — DESABILITADO INTENCIONALMENTE

O worker de OCR em `src/lib/document-queue.ts` está **deliberadamente desabilitado**.

**Motivo:** `pdf-parse` tem problemas crônicos de importação CJS/ESM e o custo de CPU é alto para servidor único. OCR será reimplementado como microserviço separado no futuro.

```typescript
// Estado atual — NÃO reativar sem discussão
export function createDocumentOcrWorker() {
  const worker = new Worker<OcrJobData>('document-ocr', async (job) => {
    logger.info({ jobId: job.id }, 'OCR disabled — job discarded')
  }, { connection, concurrency: 1 })
  return worker
}
```

A fila BullMQ existe para manter compatibilidade com Redis — mas nenhum processamento real ocorre.

> **Se o terminal mostrar erros de OCR:** o servidor ainda está rodando código antigo em memória. **Reiniciar o servidor** resolve.

---

### 4. GED / Biblioteca

**Upload:** `POST /library/upload` (multipart)
- Salva arquivo no Cloudflare R2
- Retorna `LibraryDocument` com `.id` (UUID) — usado para vincular ao protocolo
- OCR **não** é enfileirado

**Fluxo de vinculação com Protocolo:**
```
Upload PDF → LibraryDocument.id → PATCH /protocols/:id/status
  { status: 'EMITIDO', libraryDocumentId: <uuid> }
```

---

### 5. Uploads — Cloudflare R2

**Nunca** salvar arquivos em disco local (Render usa filesystem efêmero).

Padrão de chave R2:
```
organizations/{orgId}/tasks/{filename}
organizations/{orgId}/library/{filename}
organizations/{orgId}/logos/{filename}
organizations/{orgId}/virtual-process/{filename}
```

Sempre retornar `signedUrl` gerada com `getSignedUrl`. Nunca retornar a chave R2 bruta como URL para o frontend.

---

### 6. Comunicação

- Documentos: `CommunicationDocument` com `type: OFICIO | MEMORANDO | CIRCULAR | ...`
- Threads de resposta via `parentId` (referência ao documento pai)
- Deep linking via `?msgId=` na URL para navegar direto a uma mensagem

---

## Padrões de Código

### Controller pattern padrão

```typescript
async myAction(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { organizationId, isSuperAdmin } = (request as unknown as RequestUser).user
    const body = createSchema.parse(request.body) // Zod valida

    const result = await prisma.myModel.create({ data: { organizationId, ...body } })
    return reply.code(201).send(result)
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
    return reply.code(500).send({ error: 'Failed', message: (err as Error).message })
  }
}
```

### Segurança obrigatória

- `authenticate` middleware em **todas** as rotas que retornam dados de usuário
- `userId` sempre do JWT — **nunca do body**
- `select` explícito no Prisma — nunca retornar `password`, `refreshToken`, `resetToken`
- Validação Zod em todos os endpoints antes de tocar no banco

### Nunca usar `any` sem justificativa

ESLint tem `@typescript-eslint/no-explicit-any`. Usar `unknown` + type guard, ou definir o tipo correto.

### Prisma — transações para operações atômicas

```typescript
await prisma.$transaction(async (tx) => {
  const a = await tx.modelA.create({ ... })
  const b = await tx.modelB.update({ where: { id: a.relatedId }, data: { ... } })
  return { a, b }
})
```

---

## CI/CD e Deploy

### Pipelines
- `ci.yml` — lint + tsc + vitest + build
- `security.yml` — npm audit + CodeQL + TruffleHog + Claude Security Review (PRs)
- `failure-analyst.yml` — CI falha → Claude Haiku analisa → Issue + Discord

### Deploy (Render — branch `develop`)
- Build: `npm ci --include=dev && npx prisma generate && npm run build`
- Start: `npx prisma migrate deploy && node dist/src/index.js`

### Secrets GitHub
`ANTHROPIC_API_KEY`, `RENDER_STAGING_DEPLOY_HOOK`, `RENDER_DEPLOY_HOOK`, `DISCORD_WEBHOOK_URL`

---

## Módulos e responsabilidades

| Módulo | Responsável | Status |
|--------|-------------|--------|
| Auth / JWT | Marllon | ✅ |
| Users / Roles RBAC | Marllon | ✅ |
| Financeiro | Marllon | ✅ |
| Organizações / Admin | Marllon | ✅ |
| Workspaces + Tasks | Carlos | ✅ |
| Comunicação | Carlos | ✅ |
| Processos Virtuais | Carlos | ✅ |
| Convênios | Carlos | ✅ |
| Protocolos (numeração oficial) | Carlos | ✅ |
| GED / Biblioteca | Carlos | 🔴 pendente refinamento |
| Notificações (SSE) | Carlos | ✅ |
| Calendar / Notes | Carlos | ✅ |
