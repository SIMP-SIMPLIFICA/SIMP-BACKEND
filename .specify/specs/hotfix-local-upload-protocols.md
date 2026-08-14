# Feature Specification: Hotfix — Armazenamento Local, Permissões de Notificações e Numeração Manual de Atos Normativos

**Feature Branch**: `hotfix-local-upload-protocols`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "(1) Upload falhando com HTTP 401 no S3/R2 — decisão arquitetural de abandonar o S3/R2 temporariamente e usar armazenamento local no backend (pasta `uploads/`, servida via `@fastify/static`, ignorada no git). (2) Rota `/notifications` retornando HTTP 403 — adicionar `notifications:read` ao catálogo e sincronizar com o papel Admin. (3) Ato Normativo deve deixar de ser autogerado: usuário digita 'Número da Lei/Ato' e 'Ano', e o sistema recusa duplicatas com a mensagem exata 'Já tem outra lei/documento com esse numero existente.'"

**Investigation note**: os três problemas foram verificados contra o código real. **Dois pontos do relato se mostraram mais amplos do que descrito** e estão sinalizados explicitamente abaixo, porque mudam materialmente o tamanho da entrega:

- O R2/S3 não é usado apenas em `library.controller.ts` — são **8 controllers** (`library`, `communication`, `task`, `virtual-process`, `finance-entry`, `council-document`, `user`, `upload`). Remover o SDK da AWS quebraria a compilação de todos os outros 7.
- A rota de notificações não referencia apenas `notifications:read` — referencia **três** chaves (`notifications:read`, `notifications:write`, `notifications:manage`), e nenhuma das três existe no catálogo. Corrigir só a primeira deixaria os botões de marcar-como-lido e excluir ainda quebrados com 403.

Detalhe técnico completo em `.specify/plans/hotfix-local-upload-protocols.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uploads funcionam sem qualquer credencial de nuvem (Priority: P1)

Todo upload de arquivo do sistema — documento da Biblioteca, anexo de mensagem, anexo de tarefa, documento de processo virtual, comprovante financeiro, ata de conselho, avatar/logo — deve gravar em disco local no backend e ser recuperável depois, sem depender de nenhuma credencial de serviço externo.

**Why this priority**: Hoje todo upload falha com HTTP 401 (credenciais R2 rejeitadas). Isso não afeta apenas a Biblioteca: bloqueia sete módulos de uma vez, incluindo o de Comunicação que acabou de ser desbloqueado no Épico 2. Além disso, é a única história que satisfaz o Princípio I da Constituição ("Local-First / Zero Cloud Credentials"), hoje violado na prática por qualquer fluxo que envolva arquivo.

**Independent Test**: Subir um PDF pela Biblioteca com o backend rodando **sem nenhuma variável `R2_*` no `.env`** — o upload deve concluir, o arquivo deve existir em `uploads/` no disco, e o download subsequente deve devolvê-lo corretamente.

**Acceptance Scenarios**:

1. **Given** o backend rodando sem nenhuma credencial de nuvem configurada, **When** um usuário sobe um documento na Biblioteca, **Then** o upload conclui com sucesso e o arquivo fica gravado sob `uploads/`.
2. **Given** um documento já gravado localmente, **When** o usuário clica em baixar, **Then** o arquivo é servido corretamente e abre no navegador — a URL devolvida deve funcionar a partir do frontend, que roda em origem diferente do backend.
3. **Given** um documento é excluído, **When** a exclusão é confirmada, **Then** o arquivo correspondente é removido do disco, e uma falha nessa remoção não impede a exclusão do registro (comportamento já existente com o R2, preservado).
4. **Given** os demais módulos que fazem upload (Comunicação, Tarefas, Processos Virtuais, Financeiro, Conselhos, avatar/logo), **When** qualquer um deles sobe ou baixa um arquivo, **Then** funciona igualmente sem credencial de nuvem — nenhum módulo fica para trás dependendo de um SDK removido.
5. **Given** o repositório git, **When** arquivos são enviados em desenvolvimento, **Then** nenhum deles é rastreado pelo git.

---

### User Story 2 - Notificações voltam a ser acessíveis para quem tem o papel correto (Priority: P1)

Um usuário com o papel Admin deve conseguir listar suas notificações, marcá-las como lidas e excluí-las, sem receber HTTP 403.

**Why this priority**: A campainha de notificações aparece em toda tela do sistema; hoje ela falha com 403 para 100% dos usuários (nenhum papel pode conceder uma permissão que não existe no catálogo). É o mesmo padrão de "permissão fantasma" já encontrado duas vezes neste projeto (`workspaces:*`/`tasks:read` no Épico 1, `communication:read` no Épico 2).

**Independent Test**: Logado como Admin, abrir a campainha de notificações — a lista deve carregar sem 403; marcar uma como lida e excluir uma devem funcionar igualmente.

**Acceptance Scenarios**:

1. **Given** um usuário com o papel Admin, **When** a interface busca as notificações, **Then** a lista carrega sem 403.
2. **Given** o mesmo usuário, **When** ele marca uma notificação como lida ou marca todas como lidas, **Then** a ação conclui sem 403.
3. **Given** o mesmo usuário, **When** ele exclui uma ou todas as notificações, **Then** a ação conclui sem 403.
4. **Given** papéis customizados já existentes na organização (ex: "Diretor de Obras"), **When** as novas permissões são introduzidas, **Then** o comportamento deles permanece inalterado até que um administrador conceda explicitamente as novas permissões pela tela de Roles — a correção não altera silenciosamente o acesso de papéis que o cliente configurou à mão.

---

### User Story 3 - Ato Normativo recebe numeração manual, com duplicata recusada (Priority: P1)

Ao registrar um Ato Normativo (Lei, Decreto, Portaria, etc.), o usuário deve informar manualmente o número e o ano do ato — não receber um número autogerado — e o sistema deve recusar o registro se aquele número já existir naquele ano.

**Why this priority**: Regra de negócio do domínio municipal (Princípio III da Constituição). Um ato normativo tem numeração oficial definida pelo processo legislativo/administrativo, externa ao sistema — autogerar um número cria um registro que não corresponde ao documento real, com peso legal. É P1 por integridade de dado oficial, não por bloqueio funcional.

**Independent Test**: Registrar um Ato Normativo informando número e ano manualmente — deve gravar com exatamente aqueles valores; tentar registrar outro com o mesmo número e ano na mesma organização deve ser recusado com a mensagem exata definida abaixo.

**Acceptance Scenarios**:

1. **Given** a aba "Ato Normativo", **When** o usuário abre o formulário, **Then** são exibidos dois campos obrigatórios — "Número da Lei/Ato" e "Ano" — e nenhuma indicação de numeração automática.
2. **Given** o usuário informa número e ano válidos e ainda não usados, **When** submete, **Then** o ato é registrado com exatamente o número e o ano informados.
3. **Given** já existe um Ato Normativo com o mesmo número e ano na mesma organização, **When** o usuário tenta registrar outro igual, **Then** a operação é recusada e a mensagem exibida é exatamente: `Já tem outra lei/documento com esse numero existente.`
4. **Given** a aba "Comunicação", **When** o usuário gera um número, **Then** o comportamento permanece exatamente como hoje (numeração sequencial ou aleatória automática, por setor) — esta história não altera o fluxo de Comunicação.
5. **Given** dois usuários tentam registrar o mesmo número de ato ao mesmo tempo, **When** ambas as requisições são processadas, **Then** apenas uma é gravada e a outra recebe a mensagem de duplicata — nunca dois registros com o mesmo número e ano.

### Edge Cases

- Um documento cujo arquivo foi gravado no R2 **antes** desta mudança: o registro no banco continua existindo, mas o arquivo não está no disco local. O sistema deve falhar de forma clara ao tentar baixá-lo (arquivo não encontrado), não com um erro genérico de servidor — não há migração retroativa de arquivos neste hotfix.
- Nome de arquivo enviado contendo componentes de caminho (`../`) não pode escapar da pasta `uploads/` — o nome gravado em disco é sempre gerado pelo sistema, nunca o nome enviado pelo cliente.
- Um Ato Normativo com número informado contendo zeros à esquerda (ex: "007"): a comparação de duplicata deve tratar "007" e "7" como o mesmo número, para não permitir dois registros do mesmo ato por diferença de formatação.

## Requirements *(mandatory)*

### Functional Requirements

**Armazenamento local (História 1)**

- **FR-001**: O sistema DEVE gravar todo arquivo enviado em disco local do backend, sob uma pasta raiz `uploads/`, sem exigir nenhuma credencial de serviço externo.
- **FR-002**: O sistema DEVE servir os arquivos gravados por URL, de forma que o frontend — rodando em origem diferente — consiga acessá-los diretamente.
- **FR-003**: O nome do arquivo em disco DEVE ser gerado pelo sistema (não o nome enviado pelo cliente), preservando o nome original apenas como metadado exibido ao usuário.
- **FR-004**: A exclusão de um registro DEVE remover o arquivo correspondente do disco; falha nessa remoção NÃO DEVE impedir a exclusão do registro.
- **FR-005**: Os arquivos enviados NÃO DEVEM ser versionados pelo git.
- **FR-006**: Nenhum módulo do sistema DEVE permanecer dependente do SDK de nuvem após esta mudança — ou todos migram, ou o SDK permanece; não pode haver estado intermediário que não compile.

**Notificações (História 2)**

- **FR-007**: Toda permissão referenciada pelas rotas de notificações DEVE existir no catálogo de permissões, de modo a ser atribuível a um papel.
- **FR-008**: O papel Admin DEVE receber as novas permissões de notificações sem intervenção manual do usuário final.

**Ato Normativo (História 3)**

- **FR-009**: Ao registrar um Ato Normativo, o sistema DEVE exigir número e ano informados manualmente pelo usuário, e NÃO DEVE gerar número automaticamente para essa categoria.
- **FR-010**: O sistema DEVE recusar o registro de um Ato Normativo cujo número e ano já existam na mesma organização, respondendo com a mensagem exata: `Já tem outra lei/documento com esse numero existente.`
- **FR-011**: A garantia de unicidade DEVE valer também sob requisições concorrentes — duas gravações simultâneas do mesmo número/ano não podem ambas ser aceitas.
- **FR-012**: O fluxo de geração de Comunicação DEVE permanecer inalterado (numeração automática sequencial/aleatória por setor).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos uploads e downloads funcionam com o backend rodando sem nenhuma variável `R2_*` configurada, verificado em ao menos dois módulos distintos (Biblioteca e Comunicação).
- **SC-002**: Zero respostas HTTP 403 nas rotas de notificações para um usuário com papel Admin, em todas as ações (listar, marcar lida, excluir).
- **SC-003**: 100% dos Atos Normativos registrados têm número e ano exatamente iguais aos digitados pelo usuário; zero pares número+ano duplicados na mesma organização.
- **SC-004**: Ambos os repositórios passam em `type-check` sem erros novos, e nenhum arquivo enviado aparece como não rastreado no `git status`.

## Assumptions

- **Escopo do armazenamento local**: o relato menciona apenas `library.controller.ts`, mas remover o SDK da AWS (também pedido explicitamente) quebra outros 7 controllers. Este documento assume a leitura coerente com o objetivo declarado — "abandonar o S3/R2 temporariamente" — e cobre **todos os 8 pontos de upload** através de uma camada de armazenamento compartilhada. Migrar só a Biblioteca deixaria o sistema sem compilar ou com metade dos módulos ainda quebrados pelo mesmo 401.
- **Notificações**: assume-se que as três chaves (`read`/`write`/`manage`) devem ser criadas, não apenas `notifications:read`, porque as rotas de marcar-lida e excluir referenciam as outras duas e falhariam igualmente.
- **Papéis customizados**: assume-se que papéis criados pelo cliente (ex: "Diretor de Obras") NÃO devem receber as novas permissões automaticamente — apenas o papel de sistema "admin". Alterar papéis customizados silenciosamente seria uma decisão de segurança que cabe ao administrador da organização, pela tela de Roles.
- **Arquivos legados no R2**: assume-se que não há migração retroativa dos arquivos já hospedados no R2 neste hotfix — registros antigos continuarão apontando para arquivos ausentes localmente. Se houver dados de produção relevantes no R2, isso exige uma tarefa de migração separada, fora deste escopo.
- **Numeração manual**: assume-se que "Ato Normativo" passa a ser exclusivamente manual (nunca autogerado), e que a categoria "Comunicação" permanece exclusivamente automática — nenhuma das duas ganha a opção de alternar entre os dois modos.
