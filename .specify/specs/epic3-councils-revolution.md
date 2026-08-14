# Feature Specification: Épico 3 — Conselhos Municipais: Mesa Diretora, Trava de 72h e Calendário Oficial

**Feature Branch**: `epic3-councils-revolution`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "(1) Mandatos/Mesa Diretora: campo de cargo no vínculo Usuário↔Conselho (Presidente, Vice-Presidente, Secretário(a), Conselheiro(a), Suplente), com migration, e interface de atribuição. (2) Trava de compliance de 72h: reunião e seus documentos/atas só podem ser criados, editados ou excluídos até 3 dias após a data da reunião; depois o registro congela (read-only), validado no backend e refletido no frontend com badge 'Registro Oficial Congelado (Prazo de 72h encerrado)'. (3) Calendário Anual Oficial em PDF: cabeçalho com Prefeitura e Conselho, lista das reuniões do ano (Data, Pauta, Status) e rodapé com linhas de assinatura da Mesa Diretora."

**Investigation note**: verificado contra schema, rotas e telas. **O requisito 1 já está inteiramente implementado** — o que reduz o escopo real:

1. **Mesa Diretora já existe, ponta a ponta.** `CouncilMembership.role` já é um enum `CouncilMemberRole` (`PRESIDENTE`, `VICE_PRESIDENTE`, `SECRETARIO`, `MEMBRO_TITULAR`, `MEMBRO_SUPLENTE`) com default e constraint `@@unique([councilId, userId, role])`. No frontend, `EditMemberModal.tsx` já atribui e exibe o cargo com rótulos em português. **Nenhuma migration é necessária.**
2. **`jspdf` e `jspdf-autotable` já estão instalados**, e há um precedente de uso em `src/utils/export.ts` (exportação do Financeiro). Nenhuma dependência nova para o PDF.
3. **A trava de 72h não existe em lugar nenhum** — é o trabalho central deste épico, e alcança **9 rotas de mutação** (reunião, pauta, presença, documentos), não apenas duas.

Detalhe técnico em `.specify/plans/epic3-councils-revolution.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro oficial congela após 72 horas (Priority: P1)

Passados 3 dias da data da reunião, o registro daquela reunião — incluindo pauta, presença e atas — deixa de aceitar qualquer alteração, tornando-se somente leitura.

**Why this priority**: É a razão de existir do épico. Ata de conselho municipal é documento com valor legal; a possibilidade de alterá-la meses depois compromete a fé pública do registro. Sem esta história, as outras duas são cosméticas.

**Independent Test**: Em uma reunião com data de 4 dias atrás, tentar editar o título, excluir a reunião, anexar uma ata e excluir uma ata existente — todas as quatro ações devem ser recusadas. Em uma reunião de ontem, todas devem funcionar.

**Acceptance Scenarios**:

1. **Given** uma reunião realizada há menos de 72 horas, **When** o usuário edita seus dados, altera pauta, registra presença ou anexa uma ata, **Then** todas as operações são aceitas normalmente.
2. **Given** uma reunião realizada há mais de 72 horas, **When** o usuário tenta qualquer alteração (editar, excluir, anexar ata, excluir ata, alterar pauta ou presença), **Then** a operação é recusada com mensagem clara indicando que o prazo se encerrou.
3. **Given** uma reunião **futura ou agendada para hoje**, **When** o usuário a edita, **Then** a operação é aceita — a trava só se aplica depois que a reunião aconteceu e o prazo passou.
4. **Given** a recusa acontece, **When** o usuário a recebe, **Then** ela vem do servidor — não apenas de um botão desabilitado na tela, que qualquer chamada direta à API contornaria.
5. **Given** uma reunião congelada, **When** o usuário abre sua tela, **Then** os controles de alteração aparecem desabilitados e um aviso explica que o registro está congelado.

---

### User Story 2 - Entender por que não é mais possível editar (Priority: P2)

Ao abrir uma reunião congelada, o usuário deve compreender de imediato que aquilo é definitivo e por quê — sem descobrir isso só ao clicar e receber erro.

**Why this priority**: Sem o aviso, a trava vira uma sequência de erros inexplicáveis e chamados de suporte. É P2 porque a proteção legal (História 1) já existe sem ela; esta história cuida de como a regra se comunica.

**Independent Test**: Abrir uma reunião de 4 dias atrás e confirmar que o estado congelado é evidente antes de qualquer tentativa de clique.

**Acceptance Scenarios**:

1. **Given** uma reunião congelada, **When** o usuário abre a tela, **Then** vê um indicador visível informando que o registro oficial está congelado e que o prazo de 72h se encerrou.
2. **Given** a mesma tela, **When** exibida, **Then** os botões de editar, excluir e anexar aparecem desabilitados — não ocultos, para que o usuário entenda que a ação existia e deixou de estar disponível.
3. **Given** uma reunião ainda dentro do prazo, **When** o usuário a abre, **Then** nenhum aviso de congelamento é exibido e todos os controles funcionam.

---

### User Story 3 - Exportar o calendário anual oficial (Priority: P2)

O conselho deve conseguir gerar um documento formatado com as reuniões de um ano, pronto para impressão e assinatura da Mesa Diretora.

**Why this priority**: Entrega de valor concreto para a rotina de governança (publicação e arquivamento do calendário anual), mas não protege integridade de dado como a História 1.

**Independent Test**: Em um conselho com reuniões cadastradas, exportar o calendário de um ano e conferir que o documento traz cabeçalho institucional, a lista das reuniões daquele ano e o espaço de assinaturas da Mesa Diretora.

**Acceptance Scenarios**:

1. **Given** um conselho com reuniões em um ano, **When** o usuário exporta o calendário daquele ano, **Then** o documento gerado lista as reuniões com data, pauta/tema e situação.
2. **Given** o documento gerado, **When** aberto, **Then** o cabeçalho identifica a Prefeitura (organização) e o nome do conselho.
3. **Given** o documento gerado, **When** aberto, **Then** o rodapé traz linhas de assinatura com nome e cargo dos membros da Mesa Diretora.
4. **Given** um conselho **sem** reuniões no ano escolhido, **When** o usuário exporta, **Then** o documento é gerado assim mesmo, indicando que não há reuniões — em vez de falhar ou gerar um arquivo vazio.
5. **Given** um conselho sem Presidente ou Secretário definidos, **When** o documento é gerado, **Then** ele não quebra — as assinaturas ausentes simplesmente não aparecem, ou aparecem sem nome preenchido.
6. **Given** reuniões de anos diferentes, **When** o usuário escolhe um ano, **Then** apenas as daquele ano entram no documento.

### Edge Cases

- **Fuso horário na contagem das 72h**: o corte precisa ser consistente entre o que o servidor decide e o que a tela informa — um registro não pode aparecer editável na interface e ser recusado pelo servidor (ou vice-versa).
- **Reunião sem data válida** ou com data futura distante: a trava não pode congelar por engano um registro que ainda nem aconteceu.
- **Documento anexado dentro do prazo, excluído fora dele**: a exclusão precisa seguir a mesma trava do anexo — senão o congelamento seria contornável apagando e recriando.
- **Alteração de status da reunião** (ex: marcar como realizada) após o prazo: precisa estar explicitamente dentro ou fora da trava, sem ambiguidade.
- **Membro inativo ou com mandato encerrado** na Mesa Diretora: não deve figurar nas assinaturas do calendário oficial.
- **Dois membros com o mesmo cargo** (ex: dois "Presidente" por erro de cadastro): o documento não pode quebrar.

## Requirements *(mandatory)*

### Trava de 72 horas

- **FR-001**: O sistema DEVE impedir alterações em uma reunião de conselho quando houverem passado mais de 72 horas da data em que ela foi realizada.
- **FR-002**: A trava DEVE alcançar todas as operações de alteração associadas à reunião: edição, exclusão, mudança de status, pauta, presença e anexação/exclusão de documentos.
- **FR-003**: A trava DEVE ser aplicada no servidor, de modo que chamadas diretas à API sejam recusadas mesmo com a interface fora do caminho.
- **FR-004**: Reuniões futuras, de hoje, ou realizadas há menos de 72 horas DEVEM permanecer totalmente editáveis.
- **FR-005**: A recusa DEVE trazer uma identificação legível por máquina, para que a interface a distinga de outros erros de permissão.
- **FR-006**: O critério de corte DEVE ser o mesmo no servidor e na interface, sem divergência que permita a um registro parecer editável e não ser.

### Interface da trava

- **FR-007**: A tela de uma reunião congelada DEVE exibir um aviso explícito de registro oficial congelado por encerramento do prazo de 72h.
- **FR-008**: Os controles de alteração DEVEM aparecer desabilitados (não ocultos) em uma reunião congelada.

### Calendário Anual Oficial

- **FR-009**: O sistema DEVE permitir exportar, em documento formatado, o calendário de reuniões de um conselho para um ano escolhido.
- **FR-010**: O documento DEVE conter cabeçalho com o nome da organização e do conselho.
- **FR-011**: O documento DEVE listar, por reunião, data, pauta/tema e situação.
- **FR-012**: O documento DEVE conter, ao final, linhas de assinatura com nome e cargo dos membros da Mesa Diretora ativos.
- **FR-013**: A exportação DEVE funcionar mesmo quando não houver reuniões no ano ou faltar algum cargo da Mesa Diretora.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero alterações bem-sucedidas em reuniões com mais de 72 horas, verificado nas seis operações cobertas, inclusive por chamada direta à API.
- **SC-002**: 100% das reuniões dentro do prazo permanecem editáveis, sem falso-positivo de congelamento.
- **SC-003**: O estado (congelado ou não) exibido na interface coincide com a decisão do servidor em 100% dos casos testados, inclusive em reuniões próximas do limite.
- **SC-004**: O calendário anual é gerado com cabeçalho, lista do ano correto e assinaturas da Mesa Diretora, inclusive nos casos-limite (sem reuniões, sem Presidente/Secretário).

## Assumptions

- **Nenhuma migration é necessária para a Mesa Diretora.** `CouncilMembership.role` e o enum `CouncilMemberRole` já existem, e a interface de atribuição também. O pedido dizia "atualize o modelo... crie e aplique a migration" — o modelo já está atualizado. Se a intenção era **renomear** os valores existentes (`MEMBRO_TITULAR` → "Conselheiro(a)", `MEMBRO_SUPLENTE` → "Suplente"), isso é mudança de rótulo na interface, não de schema; se for para trocar os valores do enum no banco, aí sim exigiria migration e vale confirmar.
- **O marco da contagem é `scheduledAt`** (a data da reunião), não a data de criação do registro. É a leitura natural de "72 horas após a data da reunião".
- **A trava alcança também pauta e presença**, embora o pedido cite explicitamente apenas reunião e atas — são partes do mesmo registro oficial, e deixá-las livres permitiria alterar o conteúdo da ata por outra porta.
- **A Mesa Diretora do documento considera apenas membros ativos** (`isActive`), pelos cargos `PRESIDENTE`, `VICE_PRESIDENTE` e `SECRETARIO`.
- **Sem mecanismo de exceção/desbloqueio**: não há papel que possa reabrir um registro congelado. Se a prefeitura precisar disso (ex: correção judicial), é uma funcionalidade própria, com auditoria própria, fora deste escopo.
