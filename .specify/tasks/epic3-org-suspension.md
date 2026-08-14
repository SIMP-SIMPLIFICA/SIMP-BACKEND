---
description: "Task list for feature: Épico 3 — Suspensão de Organizações (Kill Switch)"
---

# Tasks: Épico 3 — Suspensão de Organizações (Kill Switch)

**Input**: `.specify/specs/epic3-org-suspension.md` e `.specify/plans/epic3-org-suspension.md`

**Tests**: Sem tarefas de teste automatizado dedicadas — verificação manual por história, padrão dos épicos anteriores. `npm run type-check`/`lint` como gates obrigatórios.

**Organização**: Por história de usuário; cada tarefa rotulada **[Backend]** ou **[Frontend]**.

---

## Phase 1: Setup / Foundational

*(Nenhuma — `Organization.isActive` já existe, o endpoint de alternância já existe, e o padrão de cache com invalidação já está implementado no mesmo arquivo (`moduleCache`). **Sem migration Prisma neste épico.**)*

---

## Phase 2: User Story 1 & 2 - A trava e a imunidade do Super Admin (Priority: P1)

**Goal**: Suspensão passa a ter efeito real, sem nunca bloquear o Super Admin nativo.

**Independent Test**: Com um usuário logado e navegando, suspender a organização dele — a próxima ação deve ser recusada com 403. Com todas as organizações suspensas, o Super Admin deve conseguir logar e reativar.

- [ ] [Backend] T001 [US2] Em `src/middleware/auth.middleware.ts`, criar o cache de status de organização espelhando o `moduleCache` já existente no arquivo: `Map<orgId, { isActive: boolean; expiry: number }>` com TTL de 60s, mais a função exportada `invalidateOrgStatusCache(orgId)` (mesmo formato de `invalidateModuleCache`)
- [ ] [Backend] T002 [US2] No `authenticate`, após a normalização de `organizationId`/`isSuperAdmin`, inserir a trava **nesta ordem**: (a) se `isSuperAdmin` → retorna imediatamente, sem consultar nada; (b) se não há `organizationId` → segue (governado por `requireModule`/permissões, ver Decisão 6 do plano); (c) senão consulta o status da organização (cache → banco) e, se suspensa, responde `403` com `{ error: 'ORGANIZATION_SUSPENDED', message: 'Organização suspensa. Entre em contato com o suporte.' }`. A ordem importa: o retorno antecipado do Super Admin é o que garante FR-004 por construção
- [ ] [Backend] T003 [US1] Em `src/services/auth.service.ts::login`, após a checagem de `user.isActive` já existente, adicionar a verificação da organização do usuário (pular se `isSuperAdmin`) e lançar erro específico de organização suspensa — não reaproveitar "Invalid credentials", que mascararia a causa
- [ ] [Backend] T004 [US1] Confirmar que o erro do T003 chega ao cliente com identificação própria (não como 401 genérico), ajustando o handler do controller de login se necessário — o frontend precisa distinguir isso de senha errada
- [ ] [Backend] T005 [US1] Em `admin.controller.ts::updateOrganization`, chamar `invalidateOrgStatusCache(id)` quando `isActive` for alterado, para que a suspensão e a reativação valham na requisição seguinte (SC-003)
- [ ] [Backend] T006 [US1] Ainda em `updateOrganization`, registrar em `prisma.auditLog` a alteração de estado (ação, autor, organização, novo estado) — FR-010
- [ ] [Backend] T007 [US1] Verificar manualmente: (a) usuário comum logado e navegando → suspender a organização → próxima ação recusada com 403; (b) esse usuário tenta logar → recusado com mensagem de suspensão; (c) reativar → o mesmo usuário volta a acessar sem reiniciar o servidor
- [ ] [Backend] T008 [US2] Verificar manualmente: com organizações suspensas, o Super Admin nativo loga, lista e reativa normalmente; e a impersonação de organização suspensa continua recusada (comportamento já existente, não pode regredir)

**Checkpoint**: kill switch funcional e Super Admin imune.

---

## Phase 3: User Story 3 - Suspender/reativar pela listagem (Priority: P2)

**Depends on**: Fase 2 (faz pouco sentido expor o botão antes de a trava existir).

- [ ] [Frontend] T009 [US3] Em `AdminPanel.tsx`, trocar o indicador atual (ícone + rótulo cinza "Inativa") por um badge de estado explícito: **verde "Ativa"** / **vermelho "Suspensa"** (FR-008)
- [ ] [Frontend] T010 [US3] Adicionar a ação Suspender/Reativar em cada linha da listagem, chamando `PATCH /api/v1/admin/organizations/:id` com `{ isActive }` (endpoint já existente) e invalidando a query `['admin','organizations']` para refletir na hora (FR-007, cenário 3)
- [ ] [Frontend] T011 [US3] Exigir confirmação explícita antes de suspender, reutilizando o `ConfirmDialog` já existente no projeto, deixando claro no texto que **todos os usuários da organização perderão o acesso imediatamente** (FR-009). Reativar não precisa de confirmação — é a ação não destrutiva
- [ ] [Frontend] T012 [US3] Verificar manualmente: suspender uma organização ativa (badge fica vermelho sem recarregar), reativar (badge volta a verde), e confirmar que o botão "Entrar" (impersonação) permanece desabilitado enquanto suspensa

**Checkpoint**: US3 verificada.

---

## Phase 4: User Story 4 - Tela de Acesso Suspenso (Priority: P2)

- [ ] [Frontend] T013 [US4] Criar `src/pages/SuspendedAccess.tsx`: tela explicando que o acesso da organização está suspenso, orientando o contato com o suporte, sem detalhe técnico (FR-012), com ação de voltar ao login
- [ ] [Frontend] T014 [US4] Registrar `/acesso-suspenso` no `router.tsx` como rota **pública** (fora do guard de autenticação) — se ficar protegida, o redirecionamento após limpar a sessão cai no login e cria laço (Edge Case do spec)
- [ ] [Frontend] T015 [US4] Em `src/lib/api.ts`, junto do tratamento de 401 já existente, detectar resposta 403 com `error === 'ORGANIZATION_SUSPENDED'`, limpar a sessão (`clearAuth()`) e redirecionar para `/acesso-suspenso`. **Não** tratar 403 genérico dessa forma — 403 de permissão não pode deslogar ninguém (FR-011)
- [ ] [Frontend] T016 [US4] Tratar também o caso do login: quando a resposta indicar organização suspensa, exibir a explicação específica na tela de login em vez da mensagem genérica de credenciais
- [ ] [Frontend] T017 [US4] Verificar manualmente: estando logado e navegando, ter a organização suspensa → a interface leva à tela de acesso suspenso sem erros espalhados e sem laço de redirecionamento; após reativar, o login volta a funcionar

**Checkpoint**: US4 verificada.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] [Backend] T018 [P] `npm run type-check` em `SIMP-BACKEND`, sem erros novos
- [ ] [Frontend] T019 [P] `npm run type-check` e `npm run lint` em `SIMP-FRONTEND`, sem erros novos
- [ ] [Backend] T020 Documentar em `docs/AppFeatures.md` (módulos core / Painel Admin) e `docs/TechStack.md` a existência do kill switch: onde a trava vive, o código `ORGANIZATION_SUSPENDED`, e o comportamento conhecido de que alterar `is_active` direto no banco leva até 60s (TTL do cache) para surtir efeito

---

## Dependencies & Execution Order

### Entre fases

- **Fase 2 é a base** — Fases 3 e 4 expõem e comunicam um comportamento que só existe depois dela.
- **Fases 3 e 4 são independentes entre si** (arquivos diferentes; painel do Super Admin vs. cliente HTTP + tela pública) e podem ser feitas em paralelo.
- **Fase 5** depende de todas.

### Dentro de cada fase

- Fase 2: T001 → T002 (a trava usa o cache); T003 → T004; T005 depende de T001 (usa a função de invalidação); T007/T008 por último.
- Fase 3: T009/T010 → T011 → T012.
- Fase 4: T013 → T014 → T015 → T016 → T017.

---

## Notes

- **Total**: 20 tarefas (T001–T020) — **8 Backend**, **9 Frontend**, **3 polish/documentação**.
- **Nada de schema**: `Organization.isActive` já existe; **nenhuma migration Prisma neste épico**.
- **Nenhum endpoint novo**: `PATCH /admin/organizations/:id` já aceita `isActive` e já valida Super Admin — é reaproveitado (Decisão 10 do plano) em vez de criar um `/suspend` paralelo.
- **A tarefa de maior risco é a T002**: uma trava mal ordenada bloquearia o próprio Super Admin, tornando a suspensão irreversível pela interface. Por isso a ordem (Super Admin primeiro, sem consulta) está escrita explicitamente na tarefa, e o T008 existe só para provar isso na prática.
- **Diferença em relação ao pedido original**, registrada para não passar despercebido: o pedido menciona "certifique-se de que existe um campo de status (ex: ACTIVE/SUSPENDED)" e "crie ou atualize um endpoint". A investigação mostrou que **ambos já existem** (`isActive` booleano e o `PATCH`), então este plano não cria enum nem endpoint novo — usa o que está lá e concentra o esforço na trava, que é o que de fato não existe. Se você preferir migrar o booleano para um enum de estados (pensando em `TRIAL`/`CANCELED` no futuro), isso é um trabalho à parte, com migration e ajuste dos pontos que já leem o booleano.
