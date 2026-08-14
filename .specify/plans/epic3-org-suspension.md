---
description: "Implementation plan for feature: Épico 3 — Suspensão de Organizações (Kill Switch)"
---

# Implementation Plan: Épico 3 — Suspensão de Organizações (Kill Switch)

**Input**: `.specify/specs/epic3-org-suspension.md`

## Summary

O dado e o endpoint já existem; **o que não existe é o efeito**. Marcar `isActive = false` hoje não impede nada: nem o `authenticate` nem o `authService.login` olham para a organização. A entrega central deste épico é uma trava única, posicionada onde toda requisição autenticada passa, sem quebrar o Super Admin nem os endpoints públicos.

### O que já existe (verificado no código)

| Item | Estado | Onde |
|---|---|---|
| `Organization.isActive` | ✅ existe (Boolean, default true) | `prisma/schema.prisma:26` |
| Endpoint de alternância | ✅ existe, já restrito a Super Admin | `admin.controller.ts::updateOrganization` (`PATCH /admin/organizations/:id`) |
| Bloqueio na impersonação | ✅ existe | `admin.controller.ts::impersonate` — "Organização inativa" |
| Badge de estado na listagem | ⚠️ parcial — mostra ícone e rótulo "Inativa" (cinza), sem ação | `AdminPanel.tsx:168-187` |
| **Trava no ciclo da requisição** | ❌ **não existe** | — |
| **Bloqueio no login** | ❌ **não existe** (só checa `User.isActive`) | `auth.service.ts:231` |

### Consequência prática hoje

Uma organização "inativa" só perde duas coisas: o botão "Entrar" da impersonação e a aparência do badge. Seus usuários continuam logando e usando toda a API normalmente.

## Technical Context

**Backend**: Fastify 5, TypeScript ESM, Prisma 6.19 + Postgres 16. Autenticação por JWT (`jose` para emissão, `@fastify/jwt` para verificação). O payload do token já carrega `organizationId` e `isSuperAdmin`.

**Ponto-chave do ciclo de vida**: `authenticate` (`src/middleware/auth.middleware.ts`) é registrado como hook em todas as rotas protegidas e é onde `organizationId`/`isSuperAdmin` são normalizados. É o único ponto por onde toda requisição autenticada passa — e portanto o lugar certo para a trava.

**Precedente de cache no próprio arquivo**: `requireModule` já mantém um `moduleCache` (Map em memória, TTL de 5 min) com uma função `invalidateModuleCache(orgId)` chamada pelo `toggleModule`. Esse padrão já resolvido no projeto serve de molde direto para a trava.

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First / Zero Cloud Credentials | Sim | Nenhuma dependência nova. |
| II. Supabase Prohibition | Sim | Não aplicável. |
| III. Municipal Domain Integrity | Sim | Suspensão é ato administrativo do dono da plataforma; auditoria obrigatória (FR-010) preserva rastreabilidade. |
| IV. Multi-Tenant & Module-Gated | **Reforça** | A trava atua exatamente na fronteira de tenant, no mesmo ponto onde `organizationId` é resolvido. |
| V. Spec-Driven Development | Sim | Fluxo Spec Kit seguido. |
| VI. Environment & Security Baseline | Sim | Falha fechada por padrão; mensagem ao usuário sem detalhe técnico. |

Nenhuma violação.

## Architecture Decisions

1. **A trava vive dentro do `authenticate`, imediatamente após a normalização do payload.** É o único ponto por onde toda requisição autenticada passa; colocá-la ali garante cobertura uniforme (FR-003) sem precisar tocar em dezenas de arquivos de rota. Rotas públicas (login, refresh, health) não registram `authenticate` e portanto ficam naturalmente fora da trava (FR-006), sem precisar de lista de exceções.

   Descartadas: (a) `onRequest` global no servidor — pegaria também rotas públicas e exigiria uma allowlist frágil, que é justamente o tipo de duplicação que causou o vazamento do módulo de Comunicação no Épico 1; (b) checagem por controller — 28 controllers, garantia de esquecer algum.

2. **Ordem dentro do `authenticate`: verificar `isSuperAdmin` ANTES de qualquer consulta.** Super Admin nativo retorna cedo, sem sequer consultar a organização. Isso satisfaz FR-004 por construção — não por uma condição que alguém possa reordenar sem perceber — e evita o cenário de bloqueio irreversível descrito na História 2.

3. **Cache em memória com TTL curto + invalidação explícita na alternância**, espelhando o `moduleCache` que já existe no mesmo arquivo. Motivo: `authenticate` roda em **toda** requisição; uma consulta ao banco por requisição seria um custo permanente para um estado que muda raras vezes por ano. Com invalidação no `updateOrganization`, a suspensão e a reativação passam a valer na requisição seguinte (SC-003), sem esperar o TTL.

   O TTL existe apenas como rede de segurança para o caso de o estado ser alterado fora do endpoint (ex: SQL manual no banco) — nesse caminho, o efeito leva até o TTL para aparecer. Anotado como comportamento conhecido, não como defeito.

4. **Código de erro legível por máquina: `ORGANIZATION_SUSPENDED`**, seguindo exatamente o precedente de `MODULE_DISABLED` já usado pelo `requireModule`. Permite ao `api.ts` distinguir esse 403 de um 403 de permissão comum (que não deve deslogar ninguém) — FR-001 e FR-011.

5. **Bloqueio no login é uma checagem separada e explícita** em `auth.service.ts::login`, logo após a checagem de `User.isActive` já existente. Não dá para reaproveitar a trava do `authenticate` porque no login ainda não há token. A mensagem é específica, para não mascarar a suspensão como "credenciais inválidas" (FR-003) — evitando chamados de suporte sem diagnóstico.

6. **Usuário sem organização e não Super Admin**: a trava o **deixa passar** (não há organização para estar suspensa). O acesso dele continua governado pelas permissões e pelo `requireModule`, que já recusa quem não tem organização com "Usuário sem organização". Decisão consciente: transformar essa anomalia de dados em bloqueio total aqui criaria um segundo caminho de bloqueio com mensagem enganosa ("organização suspensa" para quem não tem organização).

7. **Auditoria da alternância** reaproveita `prisma.auditLog`, já usado em todo o projeto, registrando ação, autor, organização e o novo estado (FR-010). Sem isso, não há como responder depois "quem suspendeu esta prefeitura e quando".

8. **Frontend: interceptação central no `api.ts`**, junto do tratamento de 401 que já existe. Ao detectar `ORGANIZATION_SUSPENDED`, limpa a sessão e redireciona para `/acesso-suspenso`. Central e não por página, pelo mesmo motivo do item 1: qualquer chamada de qualquer tela precisa reagir igual.

9. **A rota `/acesso-suspenso` fica fora do guard de autenticação** — como a sessão é limpa antes do redirecionamento, uma rota protegida jogaria o usuário no login e criaria o laço descrito nos Edge Cases.

10. **Reaproveitar `PATCH /admin/organizations/:id`** em vez de criar `POST /:id/suspend`. Ele já faz exatamente isso, já valida Super Admin e já é usado pelo painel; um endpoint novo seria uma segunda porta para o mesmo estado — e duas portas divergem com o tempo.

## Project Structure

**Backend** (`SIMP-BACKEND/src/`):
- `middleware/auth.middleware.ts` — trava dentro de `authenticate`; cache de status + `invalidateOrgStatusCache()`
- `services/auth.service.ts` — bloqueio no login
- `controllers/admin.controller.ts` — invalidação de cache + auditoria em `updateOrganization`

**Frontend** (`SIMP-FRONTEND/src/`):
- `lib/api.ts` — interceptação do `ORGANIZATION_SUSPENDED`
- `pages/SuspendedAccess.tsx` — **novo**, tela de acesso suspenso
- `router.tsx` — rota pública `/acesso-suspenso`
- `pages/admin/AdminPanel.tsx` — badge verde/vermelho + ação suspender/reativar com confirmação

**Sem migration Prisma neste épico** — `isActive` já existe.

## Complexity Tracking

Nenhuma exceção à Constituição necessária.
