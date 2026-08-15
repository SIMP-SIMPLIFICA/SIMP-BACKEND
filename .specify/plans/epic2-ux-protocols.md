---
description: "Implementation plan for feature: Epic 2 — UX, Refatoração de Protocolos e Correções de Frontend"
---

# Implementation Plan: Epic 2 — UX, Refatoração de Protocolos e Correções de Frontend

**Input**: `.specify/specs/epic2-ux-protocols.md`

## Summary

Investigação de código (não apenas o relato do usuário) confirmou causas-raiz concretas para 2 dos 4 problemas, deixou 2 como "reprodução ao vivo necessária" (com o descarte de erro real identificado como bloqueador da própria investigação), e confirmou que duas das "correções" pedidas (Workspaces por Departamento, Protocolos por categoria) já têm uma fundação parcial ou total no código atual — ou seja, são refinamentos aditivos, não reescritas.

### Achado 1 — Comunicações: causa-raiz confirmada, é a mesma classe de bug do Épico 1

`src/controllers/communication.controller.ts` chama `getUsersWithPermission(ids, 'communication:read')` em dois lugares (`getRecipients` linha ~300, `create` linha ~58). Grep completo em `src/constants/permissions.ts` confirma que **`communication:read` não existe em nenhuma categoria do catálogo** — a categoria `communication` só define `documents:read/create/manage/sign/send`. Como `getUsersWithPermission` resolve o Set de permissões de cada usuário a partir dos papéis reais e testa `perms.has(permission)`, uma chave que não existe em NENHUM papel do sistema (incluindo `admin`, confirmado via query direta no banco: `has_communication_read = f`) significa que a checagem **é sempre falsa para 100% dos usuários**. Isso explica tanto a tag "Sem permissão" (que também usa esse mesmo resultado) quanto qualquer rejeição no envio de mensagem para outra pessoa.

Isto é exatamente o mesmo padrão do Épico 1 (Story 2: `workspaces:*`/`tasks:read` referenciados no código mas ausentes do catálogo) — não é um bug de frontend como a hipótese inicial do relato sugeria ("componente verificando flag errada"); é uma permissão fantasma no backend.

### Achado 2 — Enum leak: sistêmico não, pontual sim

Grep amplo por padrões de renderização direta de status (`{x.status}`, dicionários `STATUS_LABELS`) mostra que Suporte, Protocolos, Conselhos, Convênios e Processos Virtuais **já** têm dicionários de tradução (`STATUS_CONFIG`/`StatusBadge`/`MeetingStatusBadge` etc.) — o padrão já existe e é seguido na maior parte do app. O ponto concreto e confirmado onde falha: `src/components/workspaces/TaskCard.tsx` linhas 29-31 renderiza `{task.priority}` cru (`LOW`/`MEDIUM`/`HIGH`/`URGENT`), enquanto `TaskModal.tsx` (mesma feature, mesmo dado) já traduz esses valores inline (`LOW: 'Baixa'` etc. na Select de prioridade) e duplica um `STATUS_CONFIG` quase idêntico ao de `WorkspaceDetailPage.tsx`'s `COLUMNS`. Correção: extrair um dicionário compartilhado único e aplicá-lo também no `TaskCard`.

### Achado 3 — Workspace crash: causa exata localizada

`src/pages/workspaces/WorkspacesPage.tsx` linha 125: `<SelectItem value="">Workspace pessoal (sem setor)</SelectItem>`. O Radix UI `Select.Item` reserva internamente o valor de string vazia para representar "nenhuma seleção"/placeholder e lança um erro em tempo de execução se um item real usar esse valor — sem Error Boundary na árvore, o erro derruba a página inteira. Correção mecânica: usar um valor sentinela não-vazio (`"__personal__"`) e mapear de volta para `null` ao montar o payload de criação (`departmentId: selectedDeptId === '__personal__' ? null : selectedDeptId || null`).

### Achado 4 — Workspaces por Departamento: fundação já existe

`WorkspacesPage.tsx` já implementa abas "Meus Workspaces"/"Workspaces do Setor"; `workspace.controller.ts::create` já restringe criação setorial ao Chefe do departamento ou admin; `workspace.controller.ts::list` já filtra a listagem pelos departamentos do usuário (`deptIds`). O que falta, especificamente: a aba "Workspaces do Setor" mistura todos os departamentos do usuário em um grid único, sem agrupamento por nome de departamento. Correção: sub-agrupar `sectorWorkspaces` por `departmentId` e renderizar uma sub-navegação (ou seções tituladas) por departamento, reaproveitando o mesmo padrão de `Tabs` já usado na página.

### Achado 5 — Upload de anexo e HTTP 400 de Protocolos: causa raiz não confirmável por leitura estática

Para o upload: `@fastify/multipart` está registrado globalmente (`src/config/plugins.ts:133`), a rota já declara `consumes: ['multipart/form-data']`, e `.env` tem `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`/`R2_ENDPOINT` com valores presentes e de tamanho plausível para credenciais reais. Nada na leitura estática aponta uma causa definitiva — pode ser conectividade de rede/CORS do R2 a partir do ambiente local, ou um problema de configuração do bucket que só aparece em runtime.

Para o 400 de Comunicação: comparação campo a campo entre `GenerateProtocolModal.tsx` e `generateSchema` (Zod) não encontrou divergência estrutural — enums batem (`COMUNICACAO`/`NORMATIVO`, `SEQUENTIAL`/`RANDOM`), `departmentId` já é um UUID real vindo de `useDepartmentOptions`, e o botão de submit já fica desabilitado até `departmentId`/`recipient` estarem preenchidos para Comunicação.

**Causa comum dos dois**: em ambos os fluxos, o bloco `catch` do frontend descarta a resposta real do backend:
- `NewMessageModal.tsx::handleSend` já extrai `err.message` corretamente (não precisa de correção).
- `GenerateProtocolModal.tsx::handleSubmit` usa `catch { toast({ title: 'Erro ao gerar número.' }) }` — descarta completamente o corpo da resposta, que pode ser `{ message: '...' }` (validação manual) OU `{ error, issues: [...] }` (ZodError, sem campo `message` no nível raiz).

Decisão: corrigir a extração de erro em `GenerateProtocolModal.tsx` primeiro (robusta a ambos os formatos), depois reproduzir ao vivo com o usuário para capturar a mensagem real antes de decidir se há uma correção de código adicional necessária.

## Technical Context

**Backend**: Fastify 5, TypeScript, Prisma 6.19 + Postgres 16, Zod 3.25, RBAC via `Role`/`UserRole` (permissões como array JSON), catálogo em `src/constants/permissions.ts`.
**Frontend**: React 19, Vite 7, TanStack Query 5, shadcn/ui (Radix), Tailwind. Cliente HTTP fino em `src/lib/api.ts` (`apiRequest` lança o corpo JSON da resposta de erro).

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First / Zero Cloud Credentials | Sim | Nenhuma mudança introduz nova dependência de nuvem; a investigação do upload trata R2 como já-configurado, não adiciona exigência nova. |
| II. Supabase Prohibition | Sim | Não aplicável — nenhum código toca Supabase. |
| III. Municipal Domain Integrity | Sim | A separação de permissões de Protocolos preserva o acesso já concedido (aditivo), respeitando a seriedade legal de numeração oficial. |
| IV. Multi-Tenant & Module-Gated Architecture | Sim | Nenhuma mudança altera o escopo de organização; a correção de `communication:read` restaura o comportamento correto dentro dos limites já existentes (mesma org). |
| V. Spec-Driven Development | Sim | Este documento e os `specs`/`tasks` irmãos seguem o fluxo Spec Kit adotado desde a Constituição v1.0.0. |
| VI. Environment & Security Baseline | Sim | Nenhuma nova variável de ambiente introduzida; upload de anexo continua usando a configuração R2 existente. |

Nenhuma violação — não é necessário registrar exceção na seção Complexity Tracking.

## Architecture Decisions

1. **`communication:read` vira uma permissão real no catálogo.** Adicionar `communication:read` (e, por simetria com o padrão de outros módulos, `communication:write` para o ato de enviar) à categoria `communication` em `src/constants/permissions.ts`, ao lado das já existentes `documents:*` (que continuam servindo a outro propósito — documentos formais, não mensagens internas). Como o papel "admin" é recriado dinamicamente via `ensureAdminRole()`'s `DEFAULT_ADMIN_PERMISSIONS` apenas na criação inicial (não em upserts subsequentes — confirmado: o `update: {}` do upsert não re-sincroniza um papel já existente), a correção do catálogo sozinha **não basta**: é necessário também empurrar as novas chaves para o papel "admin" já existente no banco. Reaproveita-se o mesmo padrão do Épico 1 (script único, idempotente).

2. **Script de sincronização de permissões do papel "admin" (não um novo backfill de usuários).** Diferente do Épico 1 (que vinculava usuários sem nenhum papel), aqui o papel já existe e já está vinculado — falta apenas que seu array `permissions` inclua as chaves novas. Um script `prisma/scripts/sync-admin-role-permissions.ts` recalcula a união entre o `permissions` atual do papel "admin" e `DEFAULT_ADMIN_PERMISSIONS` (a fonte de verdade), e faz um `update` apenas se houver diferença — idempotente por construção (evita generalizar isso para um mecanismo permanente de auto-sync no boot, o que estaria fora do escopo deste épico e teria implicações de auditoria/segurança que merecem sua própria decisão).

3. **Erro real do backend sempre chega ao usuário.** Em vez de introduzir um novo padrão, generaliza-se o que `NewMessageModal.tsx` já faz corretamente: extrair `message` da resposta de erro, com fallback para `issues[0]?.message` (formato ZodError) e só then um texto genérico. Aplicado em `GenerateProtocolModal.tsx::handleSubmit`. Não se justifica um helper compartilhado novo para dois call-sites — mantém-se a mesma extração inline já usada em outros modais do app.

4. **Dicionário de tradução único para status/prioridade de Tarefas.** Extrair `TASK_STATUS_LABELS`/`TASK_PRIORITY_LABELS` (rótulo + classe de cor) para um módulo compartilhado (`src/types/task.ts`, onde `TaskStatus`/`TaskPriority` já são definidos — mantém o dado e seu rótulo próximos), substituindo as duas cópias hoje existentes (`TaskModal.tsx`'s `STATUS_CONFIG` e `WorkspaceDetailPage.tsx`'s `COLUMNS`) e usado também por `TaskCard.tsx` para a prioridade. Não se estende a outros módulos (Suporte, Protocolos, etc.) porque cada um já tem seu próprio dicionário funcionando corretamente — generalizar um sistema de tradução de enums para o app inteiro está fora do escopo deste épico.

5. **Correção do crash do Radix Select é puramente mecânica.** Valor sentinela `"__personal__"` no lugar da string vazia; nenhuma mudança de comportamento ou payload — o resultado final continua sendo `departmentId: null` para workspaces pessoais.

6. **Agrupamento de Workspaces por Departamento é uma sub-navegação dentro da aba "Workspaces do Setor" já existente**, não uma nova página ou uma terceira aba no nível superior — evita redesenhar uma tela que já funciona bem para o caso comum (um único departamento).

7. **Permissões granulares de Protocolos são estritamente aditivas.** Novas chaves `protocols:normativo` e `protocols:comunicacao` na categoria `protocols` do catálogo. As rotas `/generate` (e as demais) passam a aceitar QUALQUER uma de `['protocols:write', 'protocols:admin', 'protocols:normativo', 'protocols:comunicacao']` como suficiente para acessar a tela (a distinção fina de qual aba cada permissão libera acontece no frontend/no controller, não removendo acesso de quem já tinha `protocols:write`). `protocols:admin` continua sendo o superconjunto (Story 3 do Épico 1 not afetada). O papel "admin" ganha as duas novas chaves pelo mesmo script de sincronização do item 2 — nenhum papel existente perde acesso.

8. **Aba "Ato Normativo"/"Comunicação" na tela de Protocolos** usa o componente `Tabs` já padrão no design system (mesmo padrão de `WorkspacesPage.tsx`), reaproveitando a lógica de formulário já existente em `GenerateProtocolModal.tsx` (a distinção `isNormativo` já existe internamente) — não é uma reescrita do modal, é uma reorganização de como a categoria é escolhida (por aba, não por botão dentro do mesmo modal) e um filtro correspondente na listagem.

9. **Indicador "Pendente de Anexo"** é puramente visual, derivado de `libraryDocumentId` (já existe no modelo e na API) — nenhuma mudança de schema ou de contrato de API.

## Project Structure

**Backend** (`SIMP-BACKEND/src/`):
- `constants/permissions.ts` — novas chaves `communication:read`, `communication:write`, `protocols:normativo`, `protocols:comunicacao`
- `prisma/scripts/sync-admin-role-permissions.ts` — novo script, idempotente
- `routes/protocol.routes.ts` — `requireAnyPermission` ganha as duas novas chaves granulares ao lado das existentes

**Frontend** (`SIMP-FRONTEND/src/`):
- `pages/workspaces/WorkspacesPage.tsx` — correção do crash + agrupamento por departamento
- `types/task.ts` — novo `TASK_STATUS_LABELS`/`TASK_PRIORITY_LABELS`
- `components/workspaces/TaskCard.tsx`, `TaskModal.tsx`, `pages/workspaces/WorkspaceDetailPage.tsx` — consumir o dicionário compartilhado
- `pages/protocolos/GenerateProtocolModal.tsx` — extração robusta de erro + reorganização em abas
- `pages/protocolos/OfficialProtocolsPage.tsx` — badge "Pendente de Anexo", filtro por aba

## Complexity Tracking

Nenhuma exceção à Constituição necessária — tabela omitida.
