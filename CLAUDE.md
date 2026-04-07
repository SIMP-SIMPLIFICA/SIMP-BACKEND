# CLAUDE.md — SIMP Backend

Instruções para o Claude Code trabalhar neste repositório. Leia antes de qualquer tarefa.

## Visão geral

Backend do SIMP — Sistema Integrado de Gestão Municipal. SaaS B2B para prefeituras.

**Stack:** Fastify 5.7 + Prisma 6 + PostgreSQL 16 + Redis 7 + TypeScript (CommonJS) + JWT/Argon2 + Cloudflare R2

**Colaboradores:**
- **Marllon** — auth, finance, sidebar, RBAC
- **Carlos** — workspaces avançados, comunicação, processos virtuais, uploads genéricos

O backend é **compartilhado** — comunique antes de mexer em arquivos de uso geral (`plugins.ts`, `prisma/schema.prisma`, `index.ts`).

---

## Regras obrigatórias

### Node
```bash
nvm use 22   # SEMPRE antes de qualquer comando npm/npx
```

### Branch
- Trabalhar **sempre** em `develop`
- **Nunca** commitar diretamente em `main`
- Verificar `git branch` antes do primeiro commit da sessão

### Antes de commitar
```bash
npx tsc -b          # type check real (não usar tsc --noEmit)
npm run lint        # zero erros obrigatório
npm run build       # confirmar que o build passa
```

---

## TypeScript — CommonJS obrigatório

Este projeto usa **CommonJS**. Nunca alterar:
- `tsconfig.json`: `"module": "CommonJS"` e `"moduleResolution": "node"`
- `package.json`: sem `"type": "module"`

Consequências de mudar para ESM:
- Node ESM exige extensão `.js` em todos os imports relativos
- `import.meta.url` quebra em CJS
- `top-level await` não funciona em CJS
- `tsc-alias` não resolve extensões automaticamente

**Usar `__dirname`** nativamente — nunca `fileURLToPath(import.meta.url)`.

---

## Fastify v5 — hooks obrigatoriamente async

```typescript
// CORRETO
fastify.addHook('onRequest', async (request) => { ... })

// ERRADO — trava 100% das requests silenciosamente
fastify.addHook('onRequest', (request, reply, done) => { done() })
```

---

## Prisma — regras de migração

- **Dev:** `npx prisma db push` para iteração rápida
- **Produção:** `npx prisma migrate deploy` (nunca `db push`)
- Toda alteração de schema em PR deve ter a migration correspondente em `prisma/migrations/`
- Após adicionar migration: `npx prisma generate` obrigatório

```bash
# Criar migration
npx prisma migrate dev --name descricao_da_mudanca

# Aplicar em produção
npx prisma migrate deploy
```

---

## Uploads — Cloudflare R2

**Nunca** salvar arquivos em disco local. O Render usa filesystem efêmero.

Padrão de chave R2:
```
organizations/{orgId}/tasks/{filename}
organizations/{orgId}/uploads/{filename}
organizations/{orgId}/logos/{filename}
organizations/{orgId}/finance/{filename}
organizations/{orgId}/virtual-process/{filename}
```

Fluxo padrão:
1. `PutObjectCommand` para fazer upload
2. `getSignedUrl` com expiração (1h para arquivos, 30 dias para logos)
3. Salvar a key R2 no banco (para deleção futura)
4. Retornar a signed URL para o frontend

---

## Segurança — padrões obrigatórios

- `authenticate` middleware em **todas** as rotas que retornam dados de usuário
- `userId` sempre do JWT (`request.user.id`) — nunca do body
- Prisma `select` explícito — nunca retornar campos `password`, `refreshToken`, `resetToken`
- Validação Zod em todos os endpoints
- **ZodError:** nunca usar `.message` diretamente (retorna JSON bruto)

```typescript
// CORRETO
if (error instanceof ZodError) {
  return reply.status(400).send({
    error: 'Validation error',
    details: error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
  })
}

// ERRADO
reply.status(400).send({ error: error.message })
```

---

## Multi-tenant — organizationId

Ao tocar em qualquer um destes módulos, garantir que o scoping por `organizationId` está correto:
- `VirtualProcess`
- `CalendarEvent`
- `Note`
- `CommunicationDocument`
- Upload genérico (`upload.controller.ts`)

Nunca retornar dados de uma org para outra.

---

## Postman

Ao adicionar ou alterar endpoints, **sempre** atualizar `SIMP.postman_collection.json` na raiz do projeto — sem precisar ser solicitado.

---

## Busca accent-insensitive

Para buscas por nome/email que devem ignorar acentos (ã, é, ç etc.), usar `$queryRaw` com a extensão `unaccent` do PostgreSQL:

```typescript
const pattern = `%${search}%`
const results = await prisma.$queryRaw<{ id: string }[]>`
  SELECT id FROM "User"
  WHERE unaccent(lower(email)) LIKE unaccent(lower(${pattern}))
`
```

---

## CI/CD

### Pipelines ativos
- `ci.yml` — Validator (lint + tsc) → Test (vitest, passWithNoTests) → Build
- `security.yml` — npm audit + CodeQL + TruffleHog + Claude Security Review (PRs)
- `failure-analyst.yml` — CI falha → Claude Haiku analisa → Issue + Discord

### Secrets necessários (GitHub)
`ANTHROPIC_API_KEY`, `RENDER_STAGING_DEPLOY_HOOK`, `RENDER_DEPLOY_HOOK`, `DISCORD_WEBHOOK_URL`

### Deploy (Render — branch `develop`)
- Build: `npm ci --include=dev && npx prisma generate && npm run build`
- Start: `npx prisma migrate deploy && node dist/src/index.js`
- Output path: `dist/src/index.js` (rootDir "." causa isso)

---

## Módulos e responsabilidades

| Módulo | Responsável | Status |
|--------|-------------|--------|
| Auth (`auth.routes.ts`) | Marllon | ✅ |
| Users/Roles RBAC | Marllon | ✅ |
| Finance (`finance.routes.ts`) | Marllon | ✅ |
| Workspaces + Tasks | Carlos | ✅ |
| Comunicação | Carlos | ✅ |
| Processos Virtuais | Carlos | ✅ |
| Biblioteca | Carlos | 🔴 pendente |
| Notificações (SSE) | Carlos | ✅ |
| Calendar/Notes | Carlos | ✅ |
| Upload genérico | Carlos | ✅ |
| Organization/Admin | Marllon | ✅ |
