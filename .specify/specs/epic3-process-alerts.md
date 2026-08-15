# Feature Specification: Épico 3 — Vencimentos e Alertas de Processos Virtuais

**Feature Branch**: `epic3-process-alerts`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "Adicionar `validityDate` (DateTime, opcional) e `totalValue` (Decimal, opcional) ao `VirtualProcess`. Filtro `expiringIn` na listagem (ex: `?expiringIn=30`). Formulário de autuação (e edição) com Data de Validade e Valor Total em BRL, ambos opcionais. Listagem exibindo valor e validade, com alertas visuais em 30, 15, 7 dias e alerta crítico contínuo para 3 dias ou menos (incluindo 2, 1 e 0). Atalho de filtro 'Quase Vencendo'."

**Investigation note**: verificado contra o código atual. Três achados alteram o escopo e estão sinalizados abaixo, porque mudam o que a funcionalidade consegue entregar:

1. **Não existe rota de edição de processo virtual.** Só há `PATCH /:id/status` e `PATCH /:id/company`. Sem um caminho de edição, um processo criado sem data de validade **nunca poderá recebê-la depois** — e a funcionalidade de alertas só valeria para processos criados a partir de agora. É a mesma classe de lacuna do Épico 1 (correção que só valia para organizações novas).
2. **`VirtualProcess` já tem `endDate`, rotulado "Data de Encerramento"** no formulário. Adicionar "Data de Validade" ao lado exige que a diferença entre os dois fique explícita, sob risco de o usuário preencher o campo errado — e o alerta então nunca disparar.
3. **A migration por `prisma migrate dev` está quebrada** neste projeto (drift pré-existente, erro P3006 no shadow database). Já documentado no hotfix anterior.

Detalhe técnico em `.specify/plans/epic3-process-alerts.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar prazo e valor de um processo (Priority: P1)

Ao autuar um processo virtual, o usuário deve poder informar a data de validade e o valor total — ambos opcionais, porque nem todo processo tem prazo ou valor associado.

**Why this priority**: É o dado de entrada de todo o resto. Sem ele não há o que alertar nem o que somar.

**Independent Test**: Autuar um processo informando data de validade e valor; autuar outro sem nenhum dos dois. Ambos devem ser aceitos e os valores informados devem aparecer corretamente na listagem.

**Acceptance Scenarios**:

1. **Given** o formulário de autuação, **When** o usuário informa data de validade e valor total, **Then** o processo é criado com exatamente esses valores.
2. **Given** o mesmo formulário, **When** o usuário deixa ambos em branco, **Then** o processo é criado normalmente — nenhum dos dois é obrigatório.
3. **Given** o campo de valor, **When** o usuário digita, **Then** o número é exibido formatado como moeda brasileira, e o valor gravado corresponde ao que foi digitado (sem erro de centavos).
4. **Given** o formulário exibe "Data de Encerramento" e "Data de Validade", **When** o usuário os visualiza, **Then** a diferença entre os dois é evidente o suficiente para não haver troca de um pelo outro.

---

### User Story 2 - Enxergar prazos em risco na listagem (Priority: P1)

Na listagem de processos, quem gerencia deve identificar num relance quais estão perto de vencer, sem abrir cada um nem fazer conta de cabeça.

**Why this priority**: É a razão de existir do épico — perder um prazo em processo administrativo municipal tem consequência real. O valor e a data isolados não resolvem; o sinal visual é o que muda o comportamento de quem opera.

**Independent Test**: Com processos cadastrados em faixas distintas de vencimento (ex: 45, 30, 15, 7, 3, 1, 0 e já vencido), abrir a listagem e conferir que cada um exibe o sinal correspondente à sua faixa.

**Acceptance Scenarios**:

1. **Given** um processo com validade em mais de 30 dias, **When** aparece na listagem, **Then** não exibe alerta — apenas a data.
2. **Given** um processo com validade em 30 dias ou menos, **When** aparece na listagem, **Then** exibe um sinal de atenção.
3. **Given** um processo com validade em 15 dias ou menos, **When** aparece na listagem, **Then** exibe um sinal de urgência maior que o de 30 dias.
4. **Given** um processo com validade em 7 dias ou menos, **When** aparece na listagem, **Then** exibe um sinal ainda mais forte.
5. **Given** um processo com validade em **3, 2, 1 ou 0 dias**, **When** aparece na listagem, **Then** exibe alerta crítico — de forma contínua em toda essa faixa, sem "buracos" entre os valores.
6. **Given** um processo cuja validade **já passou**, **When** aparece na listagem, **Then** é identificado como vencido, de forma distinta de "vence hoje".
7. **Given** um processo sem data de validade, **When** aparece na listagem, **Then** não exibe alerta algum nem ocupa espaço com aviso vazio.
8. **Given** um processo com valor total informado, **When** aparece na listagem, **Then** o valor é exibido formatado em reais.

---

### User Story 3 - Filtrar os que estão quase vencendo (Priority: P2)

O usuário deve conseguir restringir a listagem apenas aos processos com vencimento próximo, em vez de procurar visualmente item a item.

**Why this priority**: Multiplica a utilidade da História 2 quando há muitos processos — mas depende dela existir. Com poucos registros, o sinal visual já resolve.

**Independent Test**: Acionar o atalho "Quase Vencendo" e confirmar que apenas processos dentro da janela aparecem, e que processos sem data de validade ficam de fora.

**Acceptance Scenarios**:

1. **Given** a listagem, **When** o usuário aciona o atalho "Quase Vencendo", **Then** apenas processos com validade dentro da janela definida são exibidos.
2. **Given** o filtro ativo, **When** existem processos sem data de validade, **Then** eles não aparecem no resultado.
3. **Given** o filtro ativo, **When** o usuário o desativa, **Then** a listagem volta ao conjunto completo.
4. **Given** o filtro é aplicado, **When** a consulta é feita, **Then** a filtragem acontece no servidor — não apenas escondendo linhas da página atual, o que daria contagem e paginação erradas.

---

### User Story 4 - Corrigir prazo e valor de um processo já existente (Priority: P2)

Um processo já autuado deve poder ter sua data de validade e seu valor informados ou corrigidos depois.

**Why this priority**: Sem isso, os alertas só funcionam para processos criados a partir de agora, e todo processo já cadastrado fica permanentemente fora do controle de prazos — esvaziando a funcionalidade justamente onde ela mais importa (o acervo existente). É P2 e não P1 apenas porque exige um caminho de edição que hoje não existe (ver Achado 1) e, portanto, é uma decisão de escopo do usuário.

**Independent Test**: Em um processo criado antes desta funcionalidade, informar data de validade e valor, e confirmar que os alertas passam a valer para ele.

**Acceptance Scenarios**:

1. **Given** um processo sem data de validade, **When** o usuário informa uma data, **Then** ela é gravada e o alerta correspondente passa a aparecer na listagem.
2. **Given** um processo com data de validade, **When** o usuário a corrige ou a remove, **Then** a alteração é refletida na listagem.
3. **Given** a alteração de valor ou validade, **When** é submetida, **Then** apenas quem tem permissão de escrita em processos consegue realizá-la.

### Edge Cases

- Processo cuja validade **já venceu**: o pedido descreve as faixas de 30/15/7/3 dias, mas não o que fazer depois do vencimento. Como um processo vencido é a situação mais grave possível, ele precisa de identificação própria — não pode ser tratado como "0 dias" nem sumir do alerta.
- **Fuso horário e virada do dia**: a contagem de dias precisa ser por dia de calendário, não por diferença bruta de horas. Um processo que vence amanhã não pode aparecer como "vence hoje" só porque faltam menos de 24 horas.
- **Valor zero** é diferente de valor não informado: um processo de R$ 0,00 é um dado válido e deve ser distinguível de "sem valor".
- Filtro "Quase Vencendo" combinado com outros filtros (status, secretaria, busca) deve compor, não substituir.
- Processo **sem data de validade** nunca deve gerar alerta nem entrar no filtro de vencimento.

## Requirements *(mandatory)*

### Functional Requirements

**Dados (História 1)**

- **FR-001**: O sistema DEVE permitir registrar uma data de validade opcional e um valor total monetário opcional em um processo virtual.
- **FR-002**: O valor total DEVE preservar precisão monetária de centavos, sem erro de arredondamento em nenhum ponto do trajeto (formulário → armazenamento → exibição).
- **FR-003**: A interface DEVE deixar explícita a diferença entre "Data de Encerramento" (já existente) e "Data de Validade" (nova), para evitar preenchimento trocado.

**Alertas (História 2)**

- **FR-004**: A listagem DEVE exibir a data de validade e o valor total quando informados.
- **FR-005**: O sistema DEVE sinalizar visualmente processos com validade em 30, 15 e 7 dias ou menos, com intensidade crescente.
- **FR-006**: O sistema DEVE emitir alerta crítico de forma **contínua** para validade em 3 dias ou menos, cobrindo 3, 2, 1 e 0 dias sem interrupção.
- **FR-007**: O sistema DEVE identificar processos já vencidos de forma distinta de "vence hoje".
- **FR-008**: A contagem de dias DEVE ser feita por dia de calendário, de modo que a faixa exibida não mude por causa do horário da consulta.
- **FR-009**: Processos sem data de validade NÃO DEVEM exibir qualquer alerta.

**Filtro (História 3)**

- **FR-010**: A listagem DEVE aceitar um filtro por janela de vencimento, expresso em dias.
- **FR-011**: A filtragem DEVE ocorrer no servidor, preservando a correção da contagem total e da paginação.
- **FR-012**: O filtro DEVE compor com os demais filtros já existentes, não substituí-los.

**Edição (História 4)**

- **FR-013**: O sistema DEVE permitir alterar data de validade e valor total de um processo já existente, respeitando as permissões de escrita já vigentes no módulo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos processos com validade em 3, 2, 1 ou 0 dias exibem alerta crítico — verificado caso a caso, sem faixa sem cobertura.
- **SC-002**: A faixa de alerta exibida para um mesmo processo é idêntica independentemente do horário em que a listagem é aberta no mesmo dia.
- **SC-003**: O filtro de vencimento retorna exclusivamente processos dentro da janela, com contagem total e paginação coerentes com o resultado filtrado.
- **SC-004**: Valores monetários exibidos correspondem exatamente aos digitados, incluindo centavos, em 100% dos casos testados.
- **SC-005**: 100% dos processos já existentes podem receber data de validade e passar a ser monitorados.

## Assumptions

- **"Data de Validade" é distinta de "Data de Encerramento"**: assume-se que a validade representa o prazo de vigência a ser monitorado (o que dispara alerta), enquanto o encerramento já existente representa a data em que o processo foi/será concluído. Se a intenção era monitorar o `endDate` que já existe, esta funcionalidade deve usar aquele campo em vez de criar um novo — decisão que precisa ser confirmada, porque muda a migration.
- **Vencidos ficam fora do filtro "Quase Vencendo"**: assume-se que o filtro responde "o que está para vencer", não "o que já venceu". Processos vencidos continuam visíveis na listagem geral com seu próprio indicador.
- **As faixas são fixas** (30/15/7/3 dias), conforme especificado, e não configuráveis por organização neste épico.
- **Sem notificação ativa**: este épico entrega sinal visual e filtro na tela. Disparo de e-mail ou notificação push por proximidade de vencimento não está no escopo, embora a infraestrutura de notificação exista no projeto.
- **A edição (História 4) é escopo adicional em relação ao pedido literal**, que menciona "(e edição)" presumindo um modal de edição que não existe hoje. Ela está incluída porque sem ela a funcionalidade não alcança o acervo existente — mas é destacável se o usuário preferir adiar.
