#!/usr/bin/env bash
# =============================================================================
# SIMP Backend — UserPromptSubmit hook
# Injeta contexto do projeto e regras de comportamento em todo prompt.
# Garante que Claude trate prompts vagos corretamente e siga os padrões do SIMP.
# =============================================================================

set -euo pipefail

INPUT=$(cat)

CONTEXT='[CONTEXTO AUTOMÁTICO DO PROJETO SIMP — BACKEND]

Você está trabalhando no SIMP Backend (Fastify 5 + Prisma + PostgreSQL + Redis + TypeScript CommonJS).
O CLAUDE.md do repo tem as regras completas — leia-o se ainda não leu.

REGRAS QUE NUNCA PODEM SER IGNORADAS:
• Node: `nvm use 22` antes de qualquer comando. O projeto usa Node 22.
• Branch: sempre `develop` — NUNCA commitar na `main`. Verifique com `git branch` antes de qualquer commit.
• TypeScript: CommonJS obrigatório (module: commonjs, moduleResolution: node). Nunca ESM (import.meta, top-level await).
• Fastify v5: hooks DEVEM ser async. Hook sem async e sem done() trava todos os requests silenciosamente.
• Prisma: migrations via `prisma migrate dev` (nunca `db push` em produção). Gere migration antes de mudar schema.
• Uploads: sempre Cloudflare R2 — nunca salvar em disco local (`uploads/`). Use o cliente R2 já configurado.
• Multi-tenant: sempre filtrar por `organizationId` ao tocar em qualquer módulo. Nunca retornar dados cross-org.
• ZodError: nunca usar `.message` direto — fazer `instanceof ZodError` + mapear `.issues`.
• Postman: atualizar `SIMP.postman_collection.json` ao adicionar ou modificar endpoints.
• Segurança: `userId` sempre vem do JWT (`request.user.id`) — nunca do body da requisição.

COMO TRATAR O PROMPT DO USUÁRIO:
1. Se o pedido for VAGO ou INCOMPLETO (sem mencionar rota, controller, schema ou comportamento exato):
   → Declare sua interpretação: "Entendo que você quer [X] no controller [Y], correto?"
   → Não comece a codar sem confirmação se houver ambiguidade real.
2. Se o pedido mencionar um módulo sem especificar arquivo:
   → Encontre o controller/service/route relevante primeiro. Use Glob ou Grep.
   → Liste os arquivos que vai tocar antes de editar.
3. Se o pedido parecer contradizer uma regra do CLAUDE.md:
   → Aponte o conflito e sugira a abordagem correta antes de prosseguir.
4. Se o pedido for claro e específico: execute diretamente, sem perguntas desnecessárias.

ESCOPO DO CARLOS (desenvolvedor colaborador):
→ Workspaces, Comunicação, Processos Virtuais, Biblioteca
→ Se ele tocar em auth, financeiro ou RBAC sem mencionar — confirme o escopo.'

printf '%s' "$CONTEXT" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: .
  }
}'
