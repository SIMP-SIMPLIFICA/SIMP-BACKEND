---
description: "Task list for feature: Epic 2 — UX, Refatoração de Protocolos e Correções de Frontend"
---

# Tasks: Epic 2 — UX, Refatoração de Protocolos e Correções de Frontend

**Input**: Design documents from `.specify/specs/epic2-ux-protocols.md` e `.specify/plans/epic2-ux-protocols.md`

**Tests**: Sem tarefas de teste automatizado dedicadas. Verificação manual, baseada em evidência, por história — igual ao padrão do Épico 1. `npm run type-check`/`lint` seguem como gates obrigatórios em ambos os repositórios.

**Organização**: Ordem definida explicitamente pelo usuário — corrigir os crashes (Workspace, Erro 400) antes de qualquer refatoração visual. Dentro disso, agrupado por história de usuário; cada tarefa rotulada **[Backend]** ou **[Frontend]**.

---

## Phase 1: Setup / Foundational

*(Nenhuma necessária — reaproveita infraestrutura existente: catálogo de permissões, `ensureAdminRole()`, componentes `Tabs`/`Select` do design system.)*

---

## Phase 2: User Story 4 - Criar Workspace nunca mais quebra a tela (Priority: P1)

**Goal**: Eliminar o crash do Radix UI ao criar um workspace pessoal.

**Independent Test**: Abrir "Novo Workspace", deixar em "sem setor", submeter — sem tela branca.

- [ ] [Frontend] T001 [US4] Em `src/pages/workspaces/WorkspacesPage.tsx`, trocar `<SelectItem value="">Workspace pessoal (sem setor)</SelectItem>` por um valor sentinela não-vazio (ex: `"__personal__"`); ajustar `handleCreate` para mapear esse sentinela de volta para `departmentId: null` no payload (`selectedDeptId === '__personal__' ? null : selectedDeptId || null`)
- [ ] [Frontend] T002 [US4] Verificar manualmente: criar um workspace deixando "Workspace pessoal (sem setor)" selecionado — não deve haver erro de renderização; o workspace criado deve aparecer em "Meus Workspaces" com `departmentId` nulo

**Checkpoint**: US4 verificada — tela de Workspaces nunca crasha ao criar.

---

## Phase 3: User Story 6 - Falha na geração de protocolo é diagnosticável, Comunicação funciona como Normativo (Priority: P1)

**Goal**: Parar de descartar o erro real do backend; usar o erro real para confirmar (ou refutar) a causa do HTTP 400.

**Independent Test**: Gerar protocolo de Comunicação com dados válidos — deve suceder; se falhar, a mensagem exibida deve ser a real, não genérica.

- [ ] [Frontend] T003 [US6] Em `src/pages/protocolos/GenerateProtocolModal.tsx::handleSubmit`, trocar `catch { toast({ title: 'Erro ao gerar número.' }) }` por uma extração robusta: `const data = err as { message?: string; issues?: Array<{ message: string }> }; const msg = data?.message ?? data?.issues?.[0]?.message ?? 'Verifique os campos e tente novamente.'` e exibir `msg` como `description` do toast (mesmo padrão já usado em `NewMessageModal.tsx::handleSend`)
- [ ] [Backend][Frontend] T004 [US6] Reproduzir ao vivo: gerar protocolo de Comunicação com departamento, tipo, assunto e destinatário preenchidos. Se suceder — SC-003 já está resolvido só com T003 (o problema original pode ter sido um campo faltante que agora está visível). Se falhar — capturar a mensagem real exibida pelo toast e decidir, com base nela, se é necessária uma correção adicional de schema/controller antes de prosseguir para a Fase 5

**Checkpoint**: US6 verificada — erro real visível; causa do 400 confirmada ou descartada com evidência.

---

## Phase 4: User Story 1 & 2 - Comunicação: RBAC de destinatários corrigido, upload diagnosticável (Priority: P1/P2)

**Goal**: Corrigir a permissão fantasma `communication:read`; confirmar que o upload já expõe erro real.

**Independent Test**: Como usuário com papel "admin", buscar um colega da mesma organização — deve aparecer selecionável; enviar mensagem para ele deve suceder.

- [ ] [Backend] T005 [US1] Em `src/constants/permissions.ts`, adicionar `communication:read` e `communication:write` à categoria `communication` (ao lado das já existentes `documents:*`, que continuam servindo a documentos formais, não mensagens internas)
- [ ] [Backend] T006 [US1] Criar `prisma/scripts/sync-admin-role-permissions.ts`: busca o papel `admin` existente, calcula a união de `permissions` atuais com `DEFAULT_ADMIN_PERMISSIONS`, e faz `update` apenas se houver diferença (idempotente); loga as chaves adicionadas
- [ ] [Backend] T007 [US1] Rodar `npx tsx prisma/scripts/sync-admin-role-permissions.ts` contra o banco local e confirmar que o papel "admin" passa a incluir `communication:read`/`communication:write`
- [ ] [Backend][Frontend] T008 [US1] Verificar manualmente: como usuário com papel "admin", buscar um colega ativo da mesma organização no campo "Para" de Nova Mensagem — deve aparecer sem a tag "Sem permissão"; enviar a mensagem deve suceder
- [ ] [Frontend] T009 [US2] Verificar manualmente: anexar um arquivo válido a uma mensagem. `NewMessageModal.tsx::handleSend` já extrai `err.message` corretamente (nenhuma mudança de código identificada como necessária) — confirmar se o upload agora sucede (pode ter sido bloqueado indiretamente pelo mesmo problema de permissão de T005-T007) ou, se falhar, registrar a mensagem real exibida para decidir se há uma causa adicional a corrigir

**Checkpoint**: US1 verificada — módulo de Comunicação utilizável para qualquer destinatário autorizado. US2 verificada ou causa adicional documentada.

---

## Phase 5: User Story 7 - Protocolos em duas abas com permissões granulares (Priority: P2)

**Depends on**: Phase 3 (US6) — não faz sentido refatorar a tela em torno de um fluxo de geração que ainda pode estar quebrado.

**Goal**: Separar Ato Normativo/Comunicação em abas; introduzir `protocols:normativo`/`protocols:comunicacao` de forma estritamente aditiva.

**Independent Test**: Alternar entre as abas; um usuário com `protocols:write` (papel já existente) continua vendo as duas.

- [ ] [Backend] T010 [US7] Em `src/constants/permissions.ts`, adicionar `protocols:normativo` e `protocols:comunicacao` à categoria `protocols`, ao lado das já existentes `protocols:read/write/admin`
- [ ] [Backend] T011 [US7] Em `src/routes/protocol.routes.ts`, incluir as duas novas chaves nos arrays de `requireAnyPermission` das rotas `/generate`, `/`, `/:id/status`, `/:id` — junto com (não em substituição a) `protocols:write`/`protocols:admin`/`protocols:read`
- [ ] [Backend] T012 [US7] Rodar novamente `prisma/scripts/sync-admin-role-permissions.ts` (script do T006, reutilizado sem alteração) para empurrar as duas novas chaves ao papel "admin" já existente
- [ ] [Frontend] T013 [US7] Refatorar `src/pages/protocolos/OfficialProtocolsPage.tsx` e `GenerateProtocolModal.tsx` para apresentar "Ato Normativo" e "Comunicação" como abas (`Tabs`, mesmo padrão de `WorkspacesPage.tsx`) em vez de botões de seleção dentro do mesmo formulário; cada aba usa `hasAnyPermission` para decidir se é exibida (um usuário só com `protocols:comunicacao` vê apenas essa aba); listagem ganha filtro correspondente por categoria
- [ ] [Backend][Frontend] T014 [US7] Verificar manualmente: alternar entre as duas abas; confirmar que um usuário com `protocols:write` (sem as novas chaves granulares) continua vendo as duas abas normalmente — sem regressão de acesso

**Checkpoint**: US7 verificada — duas filas distintas, acesso existente preservado.

---

## Phase 6: User Story 8 - Indicador "Pendente de Anexo" na listagem (Priority: P3)

- [ ] [Frontend] T015 [US8] Em `src/pages/protocolos/OfficialProtocolsPage.tsx`, adicionar um indicador visual por linha derivado de `libraryDocumentId` (nulo → badge laranja/amarelo "Pendente de Anexo"; preenchido → badge verde/azul "Anexado"), ao lado do `StatusBadge` de status já existente
- [ ] [Frontend] T016 [US8] Verificar manualmente: um protocolo recém-gerado (sem upload) mostra "Pendente de Anexo"; após anexar PDF via `SuccessScreen`/atualização de status, passa a mostrar "Anexado"

**Checkpoint**: US8 verificada.

---

## Phase 7: User Story 3 - Tradução de status/prioridade de Tarefas (Priority: P3)

- [ ] [Frontend] T017 [US3] Em `src/types/task.ts`, criar `TASK_STATUS_LABELS: Record<TaskStatus, {label: string; className: string}>` e `TASK_PRIORITY_LABELS: Record<TaskPriority, {label: string; className: string}>` — fonte única, consolidando o que hoje está duplicado entre `TaskModal.tsx` e `WorkspaceDetailPage.tsx`
- [ ] [Frontend] T018 [US3] Atualizar `components/workspaces/TaskModal.tsx` e `pages/workspaces/WorkspaceDetailPage.tsx` (`COLUMNS`) para importar de `TASK_STATUS_LABELS` em vez de manter cópias locais
- [ ] [Frontend] T019 [US3] Atualizar `components/workspaces/TaskCard.tsx` para renderizar `TASK_PRIORITY_LABELS[task.priority].label` no badge de prioridade, em vez de `{task.priority}` cru
- [ ] [Frontend] T020 [US3] Verificar manualmente: o rótulo de prioridade no cartão do Kanban é idêntico ao exibido no modal de detalhes da mesma tarefa, em português

**Checkpoint**: US3 verificada — nenhum valor bruto de Enum visível.

---

## Phase 8: User Story 5 - Workspaces agrupados por Departamento (Priority: P3)

- [ ] [Frontend] T021 [US5] Em `src/pages/workspaces/WorkspacesPage.tsx`, dentro da aba "Workspaces do Setor" já existente, sub-agrupar `sectorWorkspaces` por `departmentId` (usando os nomes já disponíveis em `userDepts`) e renderizar cada grupo sob um cabeçalho/sub-navegação com o nome do departamento; se o usuário pertencer a um único departamento, manter a exibição simples de hoje (sem sub-navegação supérflua)
- [ ] [Frontend] T022 [US5] Verificar manualmente com um usuário vinculado a 2+ departamentos com workspaces em cada um: os workspaces aparecem agrupados/filtráveis por nome do departamento

**Checkpoint**: US5 verificada.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] [Backend] T023 [P] Rodar `npm run type-check` em `SIMP-BACKEND` e confirmar zero erros novos
- [ ] [Frontend] T024 [P] Rodar `npm run type-check` e `npm run lint` em `SIMP-FRONTEND` e confirmar zero erros novos introduzidos pelas Fases 2-8
- [ ] [Backend] T025 Atualizar `docs/TechStack.md` §11: registrar a correção de `communication:read` (permissão fantasma, mesma classe do gap de Workspaces/Tasks do Épico 1) e a introdução aditiva de `protocols:normativo`/`protocols:comunicacao`, referenciando `.specify/specs/epic2-ux-protocols.md`

---

## Dependencies & Execution Order

### Ordem obrigatória (definida pelo usuário)

1. **Fase 2 (US4 — crash de Workspace)** e **Fase 3 (US6 — erro real de Protocolos)** vêm primeiro — são os dois "crashes" citados explicitamente.
2. **Fase 4 (US1/US2 — RBAC de Comunicação)** vem em seguida — mesma severidade (P1), mas depende de uma decisão de catálogo (T005) que é mecanicamente simples e não bloqueia as Fases 2-3.
3. **Fase 5 (US7 — refatoração de Protocolos)** só começa depois da Fase 3 estar concluída (não faz sentido reorganizar a tela em abas em torno de um fluxo que pode ainda estar quebrado).
4. **Fases 6, 7, 8** (badge de anexo, tradução de enum, abas por departamento) são refatorações visuais — vêm por último, nessa ordem de prioridade (P3 cada, mas P8/Fase 6 tem dependência direta do trabalho da Fase 5 no mesmo arquivo).
5. **Fase 9** (type-check/lint + documentação) fecha o épico.

### Notas

- **Total de tarefas**: 25 (T001–T025) — a maioria backend/frontend combinados por história, refletindo que a maior parte das correções deste épico é puramente de frontend (5 das 8 histórias) ou uma combinação pequena de catálogo + script no backend.
- `prisma/scripts/sync-admin-role-permissions.ts` (T006) é reutilizado sem alteração no T012 — o mesmo script, rodado de novo depois que T010 adiciona as chaves de Protocolos ao catálogo, já cobre a sincronização sem precisar de um segundo script.
- T004 e T009 são explicitamente tarefas de "reproduzir e decidir" — podem concluir sem gerar nenhuma mudança de código adicional (se a causa raiz já tiver sido resolvida por T003/T005-T007), ou podem revelar a necessidade de uma tarefa de correção adicional não prevista aqui. Isso é intencional: a investigação estática chegou ao limite do que dava para confirmar sem reprodução ao vivo.
