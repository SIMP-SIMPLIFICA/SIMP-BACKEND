# Feature Specification: Epic 2 — UX, Refatoração de Protocolos e Correções de Frontend

**Feature Branch**: `epic2-ux-protocols`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Épico 2: UX, Refatoração de Protocolos e Correções de Frontend. (1) Comunicações: dropdown de destinatários mostra 'Sem permissão' incorretamente; upload de anexo falha. (2) Status como IN_PROGRESS vazando para a interface — precisa de tradução de Enums. (3) Workspaces: tela crasha com erro do Radix UI ao criar workspace; falta agrupar por Departamento em abas. (4) Protocolos: gerar número de 'Comunicação' retorna HTTP 400 (Normativo funciona); refatorar em duas abas com permissões separadas; adicionar indicador visual de pendência de anexo."

**Investigation note**: todos os quatro problemas foram verificados contra o código atual (controllers, rotas, componentes React, catálogo de permissões) e, quando possível, contra o estado real do banco local — não foram assumidos apenas pelo relato. Em dois pontos a investigação encontrou uma causa-raiz mais precisa (e mais simples de corrigir) do que a hipótese inicial do relato; isso está documentado explicitamente abaixo e detalhado em `.specify/plans/epic2-ux-protocols.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Any authorized user can message any colleague in their organization (Priority: P1)

Um usuário autenticado deve poder buscar qualquer colega ativo de sua própria organização como destinatário e enviar uma mensagem, sem ser bloqueado por uma checagem de permissão que nenhum papel do sistema consegue satisfazer.

**Why this priority**: Investigação confirmou que a checagem de permissão usada pelo módulo de Comunicação (`communication:read`) não existe em nenhum lugar do catálogo de permissões — ou seja, **100% dos usuários, incluindo administradores**, são bloqueados. Isso não é uma falha cosmética do dropdown; é uma falha que torna o módulo de Comunicação inutilizável para enviar mensagem a qualquer pessoa além de si mesmo.

**Independent Test**: Como um usuário com o papel "admin" (ou qualquer papel com permissões do módulo de comunicação), buscar um colega da mesma organização na tela de Nova Mensagem — o colega deve aparecer selecionável (sem a tag de bloqueio) e o envio deve ser aceito pelo backend.

**Acceptance Scenarios**:

1. **Given** um usuário com um papel que inclui as permissões do módulo de Comunicação, **When** ele busca um colega ativo da mesma organização no campo "Para", **Then** o colega aparece como destinatário selecionável, sem a tag "Sem permissão".
2. **Given** o mesmo usuário, **When** ele envia uma mensagem para esse colega, **Then** o backend aceita o envio (sem 400 pela checagem de permissão do destinatário).
3. **Given** um usuário cujo papel realmente não inclui as permissões do módulo, **When** ele é buscado como destinatário por outra pessoa, **Then** a tag de bloqueio continua aparecendo corretamente — este cenário garante que a correção não remove a checagem, apenas corrige a chave de permissão inexistente que a tornava sempre-falsa.

---

### User Story 2 - Attaching a file to a message succeeds or fails with a diagnosable error (Priority: P2)

O upload de um anexo em uma nova mensagem deve funcionar; se falhar, o erro real deve chegar até quem está investigando, em vez de ser silenciosamente descartado.

**Why this priority**: A investigação não conseguiu reproduzir a falha de upload apenas lendo o código — as credenciais R2, o registro do plugin de multipart e o schema da rota estão todos presentes e consistentes. É necessário diagnosticar com o erro real antes de corrigir; por isso esta história prioriza tornar o erro visível como primeiro passo, e trata a causa raiz como uma segunda etapa condicionada ao que o erro real revelar.

**Independent Test**: Anexar um arquivo válido (PDF ou imagem, abaixo do limite de 10MB) a uma nova mensagem e confirmar que o upload é concluído; se falhar, a mensagem de erro exibida deve refletir o que o backend efetivamente respondeu (não um texto genérico fixo).

**Acceptance Scenarios**:

1. **Given** um usuário compondo uma mensagem, **When** ele anexa um arquivo dentro dos limites permitidos (tipo e tamanho), **Then** o upload é concluído e o anexo aparece na lista antes do envio.
2. **Given** o upload falha por qualquer motivo, **When** o erro ocorre, **Then** a mensagem exibida ao usuário reflete a causa reportada pelo backend (não um texto genérico que esconde o motivo real).

---

### User Story 3 - Task and workspace status/priority values always render in Portuguese (Priority: P3)

Nenhum valor bruto de Enum do Prisma (nomes em inglês/maiúsculas usados internamente, como `IN_PROGRESS`, `URGENT`) deve aparecer na interface sem tradução — todo valor de status ou prioridade exibido ao usuário deve estar em português, de forma consistente entre todas as visualizações do mesmo dado (cartão do Kanban, modal de detalhes, coluna do quadro).

**Why this priority**: A investigação confirmou que a maior parte do sistema (Suporte, Protocolos, Conselhos, Convênios, Processos Virtuais) já traduz corretamente seus próprios status — o problema é pontual, não sistêmico. O ponto concreto e confirmado é o cartão de tarefa do Kanban, que exibe a prioridade bruta (`LOW`/`MEDIUM`/`HIGH`/`URGENT`) enquanto o modal de detalhes da mesma tarefa já traduz esses mesmos valores para português. Prioridade mais baixa porque é uma inconsistência visual, não um bloqueio funcional.

**Independent Test**: Abrir o quadro Kanban de um Workspace e comparar a etiqueta de prioridade exibida no cartão com a exibida ao abrir o modal de detalhes da mesma tarefa — ambas devem mostrar o mesmo rótulo em português.

**Acceptance Scenarios**:

1. **Given** uma tarefa com prioridade `URGENT` no banco, **When** ela é exibida no cartão do Kanban, **Then** o rótulo mostrado é "Urgente" (não "URGENT").
2. **Given** o mesmo dado de status/prioridade usado em mais de um componente (cartão, modal, coluna), **When** qualquer um deles for atualizado no futuro, **Then** a tradução vem de uma única fonte compartilhada — não de cópias duplicadas do mesmo dicionário em arquivos diferentes.

---

### User Story 4 - Creating a Workspace never crashes the page (Priority: P1)

A tela de Workspaces deve permitir criar um workspace "pessoal, sem setor" sem quebrar a renderização da página inteira.

**Why this priority**: Investigação confirmou a causa exata: um `<SelectItem value="">` (valor vazio) na lista de seleção de Departamento, o que o Radix UI proíbe explicitamente e lança um erro não capturado — como não existe um Error Boundary ali, a página inteira quebra (tela branca). É a falha mais severa do épico porque impede o uso da tela por completo, não apenas de uma ação dentro dela.

**Independent Test**: Abrir "Novo Workspace", deixar o campo de Setor em "Workspace pessoal (sem setor)" (não selecionar nenhum departamento) e submeter — a criação deve funcionar sem quebrar a tela.

**Acceptance Scenarios**:

1. **Given** o formulário de criação de Workspace, **When** o usuário abre o seletor de Setor sem escolher nenhum departamento, **Then** a lista é exibida normalmente, sem erro de renderização.
2. **Given** o mesmo formulário, **When** o usuário confirma a criação com "Workspace pessoal (sem setor)", **Then** o workspace é criado com `departmentId` nulo, exatamente como antes da correção.

---

### User Story 5 - Workspaces are browsable per department, not just as one combined "sector" bucket (Priority: P3)

Um usuário vinculado a mais de um departamento (ou um administrador navegando setores) deve conseguir ver os workspaces de cada departamento separadamente, não apenas uma lista combinada de "workspaces do setor".

**Why this priority**: Investigação confirmou que a base já existe e funciona corretamente — a tela já separa "Meus Workspaces" de "Workspaces do Setor" em abas, a criação já é restrita ao Chefe do setor (ou admin), e a listagem já filtra pelos departamentos do usuário. O que falta é apenas granularidade: hoje todos os departamentos do usuário aparecem misturados em uma única aba. Prioridade mais baixa porque é um refinamento aditivo sobre uma fundação já sólida, não uma correção de bug.

**Independent Test**: Um usuário vinculado a dois departamentos diferentes, cada um com ao menos um workspace setorial, deve conseguir ver os workspaces de cada departamento em sua própria sub-aba (ou agrupamento visualmente distinto), não em uma lista única misturada.

**Acceptance Scenarios**:

1. **Given** um usuário vinculado a dois departamentos com workspaces setoriais em cada um, **When** ele acessa "Workspaces do Setor", **Then** os workspaces aparecem agrupados/filtráveis por nome do departamento.
2. **Given** um usuário vinculado a um único departamento, **When** ele acessa a mesma tela, **Then** a experiência permanece simples (sem abas vazias ou navegação supérflua para um único grupo).

---

### User Story 6 - Protocol generation failures are diagnosable, and Comunicação works as reliably as Ato Normativo (Priority: P1)

Gerar um número de protocolo de Comunicação deve funcionar tão bem quanto gerar um Ato Normativo; se algo for rejeitado, o motivo real deve ser visível para quem está testando.

**Why this priority**: A investigação comparou o payload enviado pelo formulário com o schema Zod do backend e não encontrou divergência estrutural óbvia (categoria, tipo de numeração e `departmentId` batem com o que o backend espera). A causa exata do HTTP 400 não pôde ser confirmada por leitura estática porque o frontend descarta a mensagem de erro real do backend em uma mensagem genérica fixa ("Erro ao gerar número."). Esta história prioriza tornar o erro real visível como pré-condição para corrigir a causa definitiva — e cobre qualquer causa que a reprodução ao vivo revelar dentro do fluxo de geração.

**Independent Test**: Tentar gerar um protocolo de Comunicação com dados válidos (categoria, tipo, departamento, destinatário, assunto) e confirmar sucesso; se falhar, a mensagem exibida deve refletir o erro real retornado pelo backend (texto de validação ou lista de campos), não um texto genérico.

**Acceptance Scenarios**:

1. **Given** o formulário de geração de protocolo com categoria "Comunicação" preenchido corretamente (departamento, tipo, assunto, destinatário), **When** o usuário submete, **Then** o número é gerado com sucesso, no mesmo padrão de confiabilidade já observado para "Ato Normativo".
2. **Given** uma submissão que o backend rejeita por qualquer motivo, **When** o erro ocorre, **Then** a mensagem exibida ao usuário reflete o motivo relatado pelo backend (seja um campo obrigatório, seja uma lista de erros de validação Zod).

---

### User Story 7 - Protocols are organized into two distinct workflows with independent permissions (Priority: P2)

A tela de Protocolos deve separar visualmente "Ato Normativo" (fila única, setor central) de "Comunicação" (exige setor/departamento), e permitir que a organização conceda acesso a cada fila de forma independente.

**Why this priority**: Refatoração estrutural aprovada pelo usuário, de valor real para a gestão, mas que depende da História 6 estar resolvida primeiro (não faz sentido refatorar a tela em torno de um fluxo que ainda está quebrado) e envolve uma decisão de modelagem de permissões documentada no plano — por isso vem depois das correções de bug.

**Independent Test**: Alternar entre a aba "Ato Normativo" e a aba "Comunicação" na tela de Protocolos — cada aba deve mostrar apenas os campos e a fila relevantes à sua categoria; um usuário com permissão apenas para uma das duas categorias deve ver apenas a aba correspondente.

**Acceptance Scenarios**:

1. **Given** a tela de Protocolos, **When** o usuário alterna entre as abas "Ato Normativo" e "Comunicação", **Then** cada aba exibe apenas os campos, a fila e as regras da sua própria categoria.
2. **Given** um usuário cujo papel concede acesso apenas a uma das duas categorias, **When** ele acessa a tela, **Then** apenas a aba correspondente à sua permissão fica disponível.
3. **Given** um usuário cujo papel já tinha `protocols:write`/`protocols:admin` antes desta história, **When** esta história é implantada, **Then** ele continua tendo acesso às duas categorias exatamente como antes — a nova granularidade é aditiva, não uma remoção de acesso existente.

---

### User Story 8 - Protocol list shows attachment-pending status at a glance (Priority: P3)

Na listagem de Protocolos, deve ser possível identificar visualmente, sem abrir cada documento, quais números já têm o documento oficial anexado e quais ainda estão pendentes.

**Why this priority**: Melhoria de UX de gestão, sem qualquer bloqueio funcional por trás — a informação (`libraryDocumentId` nulo ou preenchido) já existe nos dados; falta apenas o indicador visual.

**Independent Test**: Na listagem de Protocolos, um documento sem anexo deve exibir um indicador visual distinto (ex: laranja/amarelo, "Pendente de Anexo") e um documento com anexo deve exibir outro indicador (ex: verde/azul), sem precisar abrir o detalhe.

**Acceptance Scenarios**:

1. **Given** um protocolo sem `libraryDocumentId`, **When** ele aparece na listagem, **Then** exibe um indicador visual de "Pendente de Anexo".
2. **Given** um protocolo com `libraryDocumentId` preenchido, **When** ele aparece na listagem, **Then** exibe um indicador visual diferente, indicando que o anexo já existe.

### Edge Cases

- Um usuário sem NENHUM papel vinculado (uma anomalia de dados, coberta parcialmente pelo backfill do Épico 1) continua sem poder ser destinatário de mensagens — a correção da História 1 conserta a chave de permissão errada, não cria acesso para quem legitimamente não deveria ter nenhum.
- Uma organização sem nenhum departamento cadastrado: a aba "Comunicação" de Protocolos e o fluxo de Workspace setorial devem continuar aceitando o caminho "sem setor"/pessoal sem quebrar, e não devem impedir o uso do restante do sistema.
- Um papel com `protocols:admin` (nível de sistema) deve continuar enxergando as duas categorias de protocolo, independentemente das novas permissões granulares — `protocols:admin` é um superconjunto, não é substituído.

## Requirements *(mandatory)*

### Functional Requirements

**Comunicações (Histórias 1–2)**

- **FR-001**: O sistema DEVE permitir que qualquer usuário com permissão de acesso ao módulo de Comunicação busque e selecione como destinatário qualquer usuário ativo de sua própria organização, sem depender de uma chave de permissão que não existe no catálogo.
- **FR-002**: O envio de uma mensagem para um destinatário legitimamente autorizado NÃO DEVE ser rejeitado pela checagem de permissão do destinatário.
- **FR-003**: Uma falha no upload de anexo DEVE expor ao usuário a mensagem de erro real relatada pelo backend, não um texto genérico fixo.

**Tarefas/Workspaces — UX (Histórias 3–5)**

- **FR-004**: Todo valor de prioridade de tarefa exibido na interface DEVE estar traduzido para português, de forma idêntica entre o cartão do Kanban e o modal de detalhes.
- **FR-005**: A tradução de status/prioridade DEVE vir de uma única fonte compartilhada reutilizada por todos os componentes que exibem o mesmo dado.
- **FR-006**: A criação de um Workspace sem departamento vinculado ("pessoal") NÃO DEVE lançar um erro de renderização em nenhuma circunstância.
- **FR-007**: A listagem de "Workspaces do Setor" DEVE permitir distinguir/agrupar os workspaces pelo departamento ao qual pertencem, quando o usuário estiver vinculado a mais de um departamento.

**Protocolos (Histórias 6–8)**

- **FR-008**: A geração de um protocolo de categoria Comunicação, com todos os campos obrigatórios preenchidos corretamente, DEVE suceder com a mesma confiabilidade que a categoria Ato Normativo.
- **FR-009**: Uma falha na geração de protocolo DEVE expor ao usuário a mensagem de erro (ou lista de erros de validação) real relatada pelo backend.
- **FR-010**: A tela de Protocolos DEVE apresentar "Ato Normativo" e "Comunicação" como fluxos visualmente distintos (abas), cada um exibindo apenas os campos e regras da sua categoria.
- **FR-011**: O sistema DEVE oferecer permissões granulares (`protocols:normativo`, `protocols:comunicacao`) que uma organização pode atribuir de forma independente, SEM remover o acesso já concedido por `protocols:write`/`protocols:admin` a usuários e papéis existentes.
- **FR-012**: A listagem de Protocolos DEVE exibir um indicador visual distinto para documentos sem anexo ("Pendente de Anexo") versus documentos com anexo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos usuários com permissão de acesso ao módulo de Comunicação conseguem buscar, selecionar e enviar mensagem para qualquer colega ativo da própria organização.
- **SC-002**: Zero quebras de renderização (tela branca) ao criar um Workspace pessoal, verificado repetidamente.
- **SC-003**: 100% das tentativas de gerar protocolo de Comunicação com dados válidos são bem-sucedidas; qualquer falha remanescente expõe uma mensagem de erro específica e acionável (não um texto genérico).
- **SC-004**: Zero valores brutos de Enum (ex: `URGENT`, `IN_PROGRESS`) visíveis na interface de Tarefas/Workspaces, verificado por comparação entre cartão do Kanban e modal de detalhes.
- **SC-005**: 100% dos protocolos existentes classificáveis corretamente como "Pendente de Anexo" ou "Anexado" na listagem, sem precisar abrir o detalhe.

## Assumptions

- "Sem permissão (Edite em Roles)" no dropdown de destinatários é tratado como sintoma de uma causa-raiz de backend (chave de permissão `communication:read` inexistente no catálogo), não como um bug isolado de frontend — a investigação encontrou e confirmou essa causa via grep no catálogo de permissões. Ver `.specify/plans/epic2-ux-protocols.md` para o detalhe completo.
- A causa exata da falha de upload de anexo e do HTTP 400 na geração de protocolo de Comunicação **não pôde ser confirmada apenas por leitura estática de código** — os artefatos que poderiam explicá-las (credenciais R2, schema Zod, payload do formulário) parecem corretos. Este documento trata a correção do descarte de mensagens de erro como pré-requisito, e a correção definitiva da causa raiz como um passo subsequente guiado pelo erro real capturado.
- A separação de permissões de Protocolos (`protocols:normativo`/`protocols:comunicacao`) é aditiva por decisão explícita — usuários e papéis com `protocols:write`/`protocols:admin` hoje NÃO perdem acesso a nenhuma das duas categorias quando esta história for implantada. Este documento não assume que a organização queira imediatamente restringir o acesso de ninguém; apenas que a granularidade passe a existir para uso futuro.
- O reagrupamento de Workspaces por Departamento (História 5) é tratado como um refinamento aditivo sobre uma estrutura de abas e filtragem por departamento que já existe e funciona corretamente hoje — não uma reescrita da tela.
