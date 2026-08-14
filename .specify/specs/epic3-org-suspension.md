# Feature Specification: Épico 3 — Suspensão de Organizações (Kill Switch)

**Feature Branch**: `epic3-org-suspension`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "Opção D: Suspensão de Inadimplentes (Kill Switch). Dar ao Super Admin o poder de inativar/suspender uma organização. Quando suspensa, nenhum membro daquela organização poderá acessar o sistema ou consumir a API. Super Admin não pode ser bloqueado do próprio painel. Frontend: botão Suspender/Reativar na listagem com badge colorido; tratar o 403 no `api.ts` levando o usuário a uma tela de Acesso Suspenso."

**Investigation note**: verificado contra o código atual. **Boa parte da infraestrutura já existe** — o que muda o tamanho da entrega e está sinalizado abaixo:

- `Organization.isActive` (Boolean, default `true`) **já existe** no schema. Nenhuma migration é necessária.
- O endpoint de alternância **já existe**: `PATCH /admin/organizations/:id` já aceita `isActive` e já é restrito ao Super Admin.
- A impersonação **já recusa** organizações inativas (`admin.controller.ts`, "Organização inativa").
- **O que realmente falta é a trava**: nem o `authenticate` nem o login verificam a organização. Hoje, marcar uma organização como inativa **não impede nada** — seus usuários continuam logando e consumindo a API normalmente. O "kill switch" existe como dado, mas não como comportamento.

Detalhe técnico em `.specify/plans/epic3-org-suspension.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro de organização suspensa perde o acesso imediatamente (Priority: P1)

Quando uma organização é suspensa, qualquer requisição de qualquer usuário daquela organização deve ser recusada, mesmo que a pessoa já estivesse logada com um token válido emitido antes da suspensão.

**Why this priority**: É a razão de existir da funcionalidade. Sem isso, o "kill switch" é apenas um rótulo no painel — o inadimplente continua usando o sistema. Também é o requisito com maior risco de implementação parcial: bloquear só o login deixaria todas as sessões já abertas funcionando por horas.

**Independent Test**: Com um usuário logado e navegando normalmente, suspender a organização dele pelo painel do Super Admin. A próxima ação do usuário no sistema deve ser recusada.

**Acceptance Scenarios**:

1. **Given** um usuário logado de uma organização ativa, **When** o Super Admin suspende essa organização, **Then** a próxima requisição desse usuário é recusada com HTTP 403 e uma mensagem clara de organização suspensa — sem depender de o token dele expirar.
2. **Given** um usuário de uma organização suspensa, **When** ele tenta fazer login, **Then** o login é recusado com a mesma mensagem clara — não com "credenciais inválidas", que confundiria o usuário e o suporte.
3. **Given** um usuário de uma organização suspensa, **When** ele tenta qualquer endpoint da API (com qualquer método), **Then** a recusa acontece de forma uniforme — não apenas em algumas rotas.
4. **Given** a organização é reativada pelo Super Admin, **When** o mesmo usuário tenta acessar novamente, **Then** o acesso volta a funcionar imediatamente, sem precisar de reinício do servidor nem de novo login.

---

### User Story 2 - Super Admin nunca é bloqueado do próprio painel (Priority: P1)

O Super Admin da plataforma deve continuar acessando o painel global e todos os endpoints administrativos, independentemente de quantas organizações estejam suspensas — inclusive para poder reativá-las.

**Why this priority**: Mesma prioridade da História 1 porque é o seu contrapeso: uma trava mal posicionada que bloqueasse o Super Admin criaria um bloqueio irreversível pela interface — a única pessoa capaz de reativar a organização perderia o acesso para fazê-lo.

**Independent Test**: Com todas as organizações suspensas, o Super Admin deve conseguir logar, listar organizações e reativar qualquer uma delas.

**Acceptance Scenarios**:

1. **Given** um Super Admin nativo (não impersonando), **When** ele acessa o painel global com organizações suspensas, **Then** o acesso funciona normalmente.
2. **Given** todas as organizações estão suspensas, **When** o Super Admin reativa uma delas, **Then** a operação conclui com sucesso — a trava nunca impede a própria ação de destravar.
3. **Given** um Super Admin tenta impersonar uma organização suspensa, **When** ele aciona "Entrar", **Then** a operação é recusada com mensagem clara — preservando o comportamento que já existe hoje, para que a suspensão não seja contornável por impersonação.

---

### User Story 3 - Super Admin suspende e reativa pela listagem (Priority: P2)

Na listagem de organizações do painel, o Super Admin deve conseguir suspender ou reativar cada organização diretamente, com o estado visualmente evidente.

**Why this priority**: É a interface da funcionalidade — sem ela o Super Admin dependeria de chamada manual à API. P2 porque o efeito de negócio (Histórias 1 e 2) é o que realmente protege a receita; a interface é o meio de acioná-lo.

**Independent Test**: Na listagem, suspender uma organização ativa e confirmar que o badge muda para o estado suspenso; reativar e confirmar que volta ao estado ativo — ambos sem recarregar a página.

**Acceptance Scenarios**:

1. **Given** a listagem de organizações, **When** o Super Admin visualiza uma organização ativa, **Then** ela exibe um indicador visual de ativa (verde) e uma ação para suspender.
2. **Given** uma organização suspensa, **When** o Super Admin a visualiza, **Then** ela exibe um indicador visual distinto de suspensa (vermelho) e uma ação para reativar.
3. **Given** o Super Admin aciona suspender ou reativar, **When** a operação conclui, **Then** o estado na tela reflete a mudança imediatamente, sem recarregar a página.
4. **Given** uma ação de suspensão, **When** o Super Admin a aciona, **Then** é pedida uma confirmação explícita antes de executar — suspender derruba o acesso de todos os usuários da organização e não deve acontecer por clique acidental.

---

### User Story 4 - Usuário bloqueado entende o que aconteceu (Priority: P2)

Um usuário cuja organização foi suspensa deve ver uma tela clara explicando a situação e orientando o contato com o suporte — não uma tela de erro genérica, nem um travamento silencioso da interface.

**Why this priority**: Sem isso, a experiência do bloqueio é uma sequência de erros silenciosos ou telas vazias, gerando chamados de suporte desnecessários. P2 porque o bloqueio em si (História 1) já protege o negócio; esta história cuida de como ele se comunica.

**Independent Test**: Estando logado e navegando, ter a organização suspensa e confirmar que a interface leva a uma tela de "Acesso Suspenso" com orientação, em vez de erros espalhados.

**Acceptance Scenarios**:

1. **Given** um usuário navegando com a organização recém-suspensa, **When** qualquer chamada à API é recusada por suspensão, **Then** ele é levado a uma tela dedicada de acesso suspenso, com orientação para contatar o suporte.
2. **Given** um usuário de organização suspensa, **When** ele tenta fazer login, **Then** recebe a mesma explicação clara, em vez de uma mensagem genérica de erro.
3. **Given** o usuário está na tela de acesso suspenso, **When** a organização é reativada, **Then** ele consegue voltar a usar o sistema fazendo login novamente.

### Edge Cases

- Um usuário **sem organização** que não seja Super Admin (anomalia de dados): a trava não deve tratá-lo como suspenso por engano nem liberá-lo indevidamente — o comportamento precisa ser definido explicitamente e não acidental.
- Um Super Admin **impersonando** uma organização que é suspensa **durante** a sessão de impersonação: como o token de impersonação representa um admin comum (`isSuperAdmin: false`), essa sessão deve ser bloqueada como qualquer outra — e o Super Admin deve conseguir sair da impersonação e voltar ao painel global.
- Endpoints **públicos** (login, refresh, health) não podem quebrar por causa da trava — o bloqueio precisa acontecer onde há usuário autenticado identificado.
- A tela de "Acesso Suspenso" não pode entrar em **laço de redirecionamento** com a tela de login.

## Requirements *(mandatory)*

### Functional Requirements

**Trava de acesso (Histórias 1 e 2)**

- **FR-001**: O sistema DEVE recusar qualquer requisição autenticada de usuário pertencente a organização suspensa, com HTTP 403 e uma identificação de erro legível por máquina, distinta de outras causas de 403.
- **FR-002**: A recusa DEVE valer para tokens emitidos antes da suspensão — não pode depender da expiração natural do token.
- **FR-003**: O sistema DEVE recusar o login de usuário pertencente a organização suspensa, com mensagem específica (não "credenciais inválidas").
- **FR-004**: O Super Admin nativo (não impersonando) NÃO DEVE ser bloqueado pela trava em nenhuma circunstância.
- **FR-005**: A reativação de uma organização DEVE restaurar o acesso de seus usuários sem reinício do servidor.
- **FR-006**: A trava NÃO DEVE afetar endpoints públicos (login, refresh de token, health check).

**Gestão pelo Super Admin (História 3)**

- **FR-007**: O Super Admin DEVE poder alternar o estado de suspensão de qualquer organização a partir da listagem do painel.
- **FR-008**: A listagem DEVE distinguir visualmente organização ativa de suspensa.
- **FR-009**: A ação de suspender DEVE exigir confirmação explícita antes de ser executada.
- **FR-010**: Toda alteração de estado de suspensão DEVE ser registrada em auditoria, com autor e organização afetada.

**Experiência do usuário bloqueado (História 4)**

- **FR-011**: O cliente HTTP do frontend DEVE reconhecer a recusa por suspensão e conduzir o usuário a uma tela dedicada de acesso suspenso.
- **FR-012**: A tela de acesso suspenso DEVE explicar a situação e orientar o contato com o suporte, sem expor detalhes técnicos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero requisições autenticadas bem-sucedidas de usuários de organização suspensa, verificado inclusive com sessão previamente aberta.
- **SC-002**: 100% de sucesso do Super Admin ao acessar o painel e reativar organizações, mesmo com todas suspensas.
- **SC-003**: A suspensão e a reativação surtem efeito na requisição seguinte, sem reinício de servidor e sem novo login para o caso da reativação.
- **SC-004**: 100% das tentativas de acesso de usuário suspenso resultam na tela de acesso suspenso, sem erros genéricos e sem laço de redirecionamento.

## Assumptions

- **Sem mudança de schema**: `Organization.isActive` (booleano) já existe e é usado pelo painel e pela impersonação. Este épico o adota como o estado de suspensão, em vez de introduzir um enum `ACTIVE`/`SUSPENDED` — que exigiria migration e reescrita dos pontos que já leem o booleano, sem ganho funcional para o objetivo pedido. Se no futuro forem necessários mais estados (ex: `TRIAL`, `CANCELED`), a migração para enum vira um trabalho próprio.
- **Endpoint de alternância já existe**: `PATCH /admin/organizations/:id` já aceita `isActive` e já valida Super Admin. Este épico o reaproveita, acrescentando auditoria e invalidação de cache, em vez de criar um endpoint novo e redundante.
- **Impersonação em organização suspensa permanece bloqueada**, comportamento que já existe hoje. A alternativa (permitir o Super Admin entrar numa organização suspensa para diagnosticar) seria uma porta para contornar a própria suspensão e não foi pedida.
- **Granularidade da suspensão é a organização inteira** — não há suspensão parcial por módulo ou por usuário. Suspensão de usuário individual já existe separadamente via `User.isActive`.
