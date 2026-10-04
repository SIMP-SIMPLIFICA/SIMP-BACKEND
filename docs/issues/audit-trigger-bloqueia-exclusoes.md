# Trigger de auditoria imutável bloqueia exclusão de usuário e o seed

2026-10-03 · aberto · achado da TASK 0 (decisão D10), fora do escopo do Frotas, **não corrigido**

## Problema

O trigger `trg_audit_immutable` (antes em `prisma/sql/002-immutable-audit.sql`, agora dentro de `prisma/migrations/0_baseline`) bloqueia **qualquer** `UPDATE` ou `DELETE` em `audit_logs`. Até a TASK 0 ele nunca tinha sido aplicado no banco de dev, só documentado. Com a baseline, **todo banco criado por `prisma migrate deploy` passa a tê-lo**: o `_e2e` e o futuro banco de produção.

Duas operações existentes colidem com ele:

| Operação | Onde | O que acontece com o trigger ativo |
| --- | --- | --- |
| Excluir usuário | `src/controllers/user.controller.ts:248` (`prisma.user.delete`) | `audit_logs.userId` tem FK `ON DELETE SET NULL`. Excluir um usuário com qualquer registro de auditoria (todos têm, ao menos o login) vira um `UPDATE` em `audit_logs`, e o trigger aborta a exclusão. |
| Excluir organização | `audit_logs.organization_id`, também `SET NULL` | Mesmo efeito, para qualquer exclusão física de organização. O seed faz `prisma.organization.deleteMany()`. |
| Seed de bootstrap | `prisma/seeds/seed.ts:83` (`prisma.auditLog.deleteMany()`) | O `DELETE` é bloqueado e `npm run db:seed` falha num banco com o trigger. |

Comprovado em 2026-10-03 no banco `_e2e`, dentro de transação com `ROLLBACK`:
`ERROR: Registro de auditoria e imutavel: UPDATE nao e permitido na tabela audit_logs`, ao excluir um usuário com um registro de login.

A suíte e2e atual (149 testes) passa com o trigger, porque a limpeza entre testes usa `TRUNCATE`, que não dispara trigger de linha, e nenhum teste exclui usuário.

## Por que não foi corrigido agora

Está fora do Frotas e envolve uma decisão de produto: trilha imutável × exclusão física de usuário (LGPD, direito de eliminação).

## Opções para decidir

1. **Exclusão lógica de usuário** (`isActive = false` + anonimização dos dados pessoais em `profiles`), sem `DELETE` físico. A trilha fica intacta e continua apontando para o id. É o mais coerente com a trilha imutável.
2. **FK `ON DELETE NO ACTION`/`RESTRICT`** em `audit_logs.userId`/`organization_id`: a exclusão física passa a falhar com mensagem clara (o usuário tem histórico), em vez do erro do trigger.
3. **Trigger que permita só o `SET NULL`** (um `UPDATE` que muda apenas `userId`/`organization_id` para `NULL`): mantém a exclusão física, mas abre uma exceção na imutabilidade e perde o vínculo da trilha com o autor.
4. **Seed:** trocar `prisma.auditLog.deleteMany()` por `TRUNCATE ... CASCADE` (não dispara trigger de linha), como o `resetDatabase` do e2e já faz, independentemente da opção escolhida acima.

## Brecha conhecida: `TRUNCATE`

O trigger é `BEFORE UPDATE OR DELETE ... FOR EACH ROW`, e o `REVOKE` só tira `UPDATE, DELETE` de `PUBLIC`. `TRUNCATE audit_logs` (que a aplicação, conectada como `postgres`, consegue rodar) apaga a trilha inteira sem disparar o trigger. O `resetDatabase` do e2e depende disso, e a opção 4 acima também.

Para fechar: numa migration nova, um `CREATE TRIGGER ... BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT` que só libere com uma flag de sessão (`SET LOCAL app.allow_audit_truncate = 'on'`) usada pelo e2e e pelo seed, e `TRUNCATE` incluído no `REVOKE`. Achado da revisão de segurança da TASK 0; não é regressão (antes nem o trigger existia no dev).

## Estado por banco

- `fastify_auth` (dev local): **sem** o trigger (foi marcado com `migrate resolve`, que não executa a migration). Exclusão e seed funcionam como antes.
- `fastify_auth_e2e` e qualquer banco criado por `migrate deploy`: **com** o trigger.
