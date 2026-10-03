# TASK 0 — Baseline de migrations

2026-10-03 · decisão D10 em `docs/frotas/decisoes.md`

O histórico de `prisma/migrations` foi substituído por uma migration única, `0_baseline`: o schema completo, gerado do `schema.prisma`, mais o SQL que o Prisma não expressa (o índice único parcial de Atos Normativos e o trigger que torna `audit_logs` imutável, antes em `prisma/sql/`).

## Ambiente local

### Banco de desenvolvimento (`fastify_auth`) — já feito em 2026-10-03

O banco já tinha o schema completo (criado por `db push`), então a baseline foi **marcada** como aplicada, sem ser executada:

```bash
# 1. Conferir que o banco já bate com o schema. A saída precisa ser "This is an empty migration."
npx prisma migrate diff --from-url "postgresql://postgres:postgres@localhost:5432/fastify_auth?schema=public" \
  --to-schema-datamodel prisma/schema.prisma --script

# 2. Remover os registros das migrations que deixaram de existir (só metadados)
docker exec fastify-postgres psql -U postgres -d fastify_auth -c "DELETE FROM _prisma_migrations WHERE migration_name IN ('20260408032157_init','20260408032158_add_organization_modules','20260426120000_department_is_active_code_unique');"

# 3. Marcar a baseline como aplicada e conferir
npx prisma migrate resolve --applied 0_baseline
npx prisma migrate status   # "Database schema is up to date!"
```

Resultado: as contagens de organizações (5), registros de auditoria (138) e diárias (100) ficaram iguais antes e depois.

**Diferença que ficou:** como o `resolve` não executa a migration, este banco **não tem** o índice parcial nem o trigger de auditoria (nunca teve). Os bancos criados por `migrate deploy` têm os dois. Para aplicá-los aqui também:

```bash
docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/001-unique-normativo-number.sql
docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/002-immutable-audit.sql
```

Antes de aplicar o `002`, leia `docs/issues/audit-trigger-bloqueia-exclusoes.md`: com o trigger ativo, excluir usuário e rodar `npm run db:seed` passam a falhar.

### Banco novo ou recriado do zero

```bash
npx prisma migrate deploy
```

Sem `resolve` e sem `db push`. Aplica a `0_baseline` inteira, inclusive o índice parcial e o trigger.

### Banco de teste (`fastify_auth_e2e`)

Automático: `npm run test:e2e` aplica as migrations com `prisma migrate deploy` (`src/tests/global-setup-e2e.ts`). Um `_e2e` antigo, criado por `db push` sem histórico (P3005), é apagado e recriado na primeira execução; a trava de sufixo `_e2e` é conferida de novo antes do `DROP`.

### Mudanças de schema daqui em diante

```bash
npx prisma migrate dev --create-only --name <descricao>   # gera o SQL sem aplicar
# revisar prisma/migrations/<timestamp>_<descricao>/migration.sql
npx prisma migrate dev                                   # aplica no banco de dev
```

`db push` e `migrate reset` não são usados (o `.claude/settings.json` os nega ao Claude).

## Deploy futuro

O banco de produção será criado do zero com `npx prisma migrate deploy`, sem `migrate resolve` e sem `db push`. É o mesmo caminho que o e2e exercita a cada execução.
