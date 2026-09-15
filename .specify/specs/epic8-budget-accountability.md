# Feature Specification: Épico 8 — Motor Orçamentário, Prestação de Contas e Controle Financeiro

**Feature Branch**: `epic8-budget-accountability`

**Created**: 2026-09-14

**Status**: Draft — aguardando validação

**Input**: User description: "(1) Prestação de Contas de Diárias: liberar 'Emitir Prestação de Contas' na UI só quando hoje >= data de retorno; gerar PDF pela cartilha oficial anexada; busca (Nome, CPF, Número da Diária) e filtros avançados (Status, Departamento, Período) na listagem. (2) Motor Orçamentário Dinâmico (QDD): colunas Valor Orçado/Valor Utilizado/Saldo Restante; gatilho de consumo ao vincular Diária ou Processo a uma ficha; saldo pode ficar negativo com alerta visual; editar Valor Orçado exige histórico da alteração (BudgetHistory ou Trilha de Auditoria). (3) Contas Bancárias: Select obrigatório de Secretaria/Departamento; Saldo Inicial visível mas bloqueado, com tooltip explicando a futura integração bancária. (4) Ciclo da Despesa e Alertas: mapear fases oficiais Empenho/Liquidação/Pagamento nos processos virtuais; alertar quando a diária cobrir sábado/domingo/feriado, exigindo justificativa legal (regra do TCE); alertar vencimento de vigência de Convênios (Transferegov) a 60 e 30 dias do fim do prazo."

---

## Investigation note

Verificado contra `prisma/schema.prisma`, serviços, rotas e telas antes de especificar. **O épico se apoia em dois épicos já implementados** (não apenas especificados) — ignorar isso duplicaria trabalho ou entraria em conflito com decisões já tomadas.

### O que já existe (não refazer)

| Item pedido | Estado | Evidência |
|---|---|---|
| PDF de prestação de contas (Anexo II) | ✅ **existe**, com hash, QR Code e `ExportedDocument` | `daily-allowance.service.ts` (`accountFor`), campos `accountabilityPublicId/Sha256Hash/PdfFileKey/IssuedAt` em `DailyAllowance` |
| `QddItem.valorOrcado` (Decimal 15,2), unicidade por (departamento, ano, ficha) | ✅ existe | modelo `QddItem` |
| `DailyAllowance.status` (PENDING/ISSUED/ACCOUNTED) | ✅ existe | enum `DailyAllowanceStatus` |
| `DailyAllowance.budgetOverrun` — estouro de dotação permitido e registrado | ✅ existe | campo já presente, é a semente do "saldo negativo" pedido no item 2 |
| Filtro de diárias por período/situação/departamento | ✅ especificado e presumivelmente implementado (Épico 4, FR-025) | `daily-allowance.service.ts` (função de filtro compartilhada listagem/relatório) |
| CPF do beneficiário para busca | ✅ existe | `DailyAllowance.beneficiaryCpf` |
| Alerta visual contínuo de vencimento (30/15/7/3 dias) em processos virtuais | ✅ existe | Épico 3 (`epic3-process-alerts.md`), campo `VirtualProcess.validityDate` |
| `Department.chiefName` (Ordenador de Despesa) | ✅ existe | Épico 4 |
| Motor universal de PDF com bloco de assinatura | ✅ existe | `document-pdf.service.ts`, usado no Calendário de Reuniões (Épico Conselhos) |

**Decisão herdada que este épico NÃO reabre**: a regra de negócio de imutabilidade pós-hash (Princípio VIII da constituição) e as cópias textuais (snapshot) de dados de dotação/beneficiário no momento da emissão. Todo campo novo que entra num documento já emitido segue a mesma lógica.

### O que não existe (trabalho real)

| Item | Estado |
|---|---|
| Trava no servidor de `hoje >= returnDate` antes de aceitar prestação de contas | ❌ ausente — `accountFor` hoje só valida `status === ISSUED` e `accountabilityDate >= departureDate` |
| Número sequencial legível da diária ("Número da Diária") | ❌ ausente — só existe `publicId` (UUID) |
| Campos da cartilha oficial: Órgão Emissor do RG, Nº do Bilhete de Passagem, Notas Fiscais comprobatórias, Endereço/local do evento, Contatos efetuados | ❌ ausentes |
| Busca textual livre (nome/CPF/número) na listagem de diárias | ❌ ausente — só filtros estruturados |
| `Valor Utilizado` / `Saldo Restante` no QDD | ❌ ausente em qualquer forma (nem calculado, nem persistido) |
| Vínculo de `VirtualProcess` a uma ficha do QDD | ❌ ausente — hoje só `DailyAllowance` consome QDD |
| Histórico de suplementação do valor orçado | ❌ ausente |
| `BankAccount.departmentId` | ❌ ausente |
| Bloqueio server-side do Saldo Inicial da conta bancária | ❌ ausente — hoje a API aceita e grava qualquer valor enviado |
| Mapeamento de fases oficiais da despesa (Empenho/Liquidação/Pagamento) | ❌ ausente — `VirtualProcess.status` é texto livre (`Tramitando`, `Concluído`, `Arquivado`, `Cancelado`) |
| Cadastro de feriados e alerta de fim de semana/feriado em diária | ❌ ausente |
| Alerta ativo (notificação) de vencimento de convênio | ❌ ausente — o que existe (Épico 3) é só sinal visual, sobre outro campo (`VirtualProcess.validityDate`, não `Covenant.validityEndDate`) |

### Achados que mudam a forma de fazer

**A. "Valor Orçado/Utilizado/Saldo" não deve ser persistido.** Persistir os três exigiria recalcular e reconciliar a cada vínculo, edição ou exclusão de Diária/Processo — com risco real de dessincronia sob concorrência (duas emissões simultâneas na mesma ficha). Decisão validada com o cliente: os dois novos ("Utilizado", "Saldo") são **calculados na leitura** (agregação `SUM`), nunca gravados. `valorOrcado` continua sendo o único campo persistido.

**B. O consumo de QDD precisa deixar de ser exclusivo da Diária.** O pedido do cliente é explícito: "diária **ou processo**". Hoje só `DailyAllowance.qddItemId` existe; `VirtualProcess` precisa do mesmo par (vínculo + snapshot textual + flag de estouro), replicando o padrão já estabelecido no Épico 4 em vez de inventar um novo.

**C. A cartilha oficial (anexada pelo cliente) tem campos que não existem no modelo atual.** Órgão Emissor do RG, Nº do Bilhete de Passagem, uma tabela de Notas Fiscais comprobatórias (Número/Favorecido/Data/Valor — **múltiplas linhas**, portanto uma tabela filha, não campos soltos), Endereço e local do evento, e Nome/Cargo/Telefone de contato(s). Todos são capturados no momento da **prestação de contas** (`accountFor`), no mesmo espírito dos campos que já existem ali — não na criação do rascunho.

**D. O bloco "Aprovação" da cartilha (assinatura do setor responsável + Ordenador de Despesas) é impresso, não é um workflow digital novo.** A cartilha física é assinada à mão depois de impressa. Introduzir um segundo status de aprovação (ex.: `ACCOUNTABILITY_PENDING_APPROVAL`) mudaria a máquina de estados de `DailyAllowance` e não foi pedido explicitamente. **Assumido como fora de escopo** (ver seção Assumptions) — o PDF reproduz as linhas de assinatura com os nomes disponíveis (`Department.chiefName` para o Ordenador), sem gravar uma aprovação digital.

**E. O feriado municipal não é coberto por nenhuma biblioteca genérica.** A regra do TCE citada pelo cliente ("sábados, domingos ou feriados") na prática mais aciona por feriados municipais (padroeiro, aniversário da cidade) do que nacionais. Decisão validada: tabela `Holiday` cadastrável por organização.

**F. O alerta de convênio (60/30 dias) usa um campo diferente do que o Épico 3 já cobre.** `Covenant.validityEndDate` (vigência do convênio) é distinto de `VirtualProcess.validityDate` (o alerta visual contínuo que já existe). São a mesma preocupação (prazo do TCE/Transferegov) em dois lugares do modelo — este épico cria um alerta **ativo** (notificação, não só sinal na tela) sobre `Covenant.validityEndDate`, complementar ao que já existe, não substituto.

**G. A ficha do QDD pode ficar sem nenhum consumo e ainda assim ser referenciada por um `VirtualProcess` cujo `status` já é "Concluído".** O `expensePhase` novo é uma dimensão **paralela** ao `status` textual existente — não o substitui, porque o texto livre atual já é consumido por telas e filtros hoje em produção, e trocá-lo é uma migration de risco desnecessário para este épico.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Prestar contas dentro do prazo legal, com o formulário oficial correto (Priority: P1)

O servidor só vê o botão "Emitir Prestação de Contas" habilitado a partir do dia de retorno da viagem, preenche os dados exigidos pela cartilha oficial (documentos comprobatórios, relatório de atividades) e recebe um PDF que seria aceito por um auditor do TCE sem ressalvas de formulário.

**Why this priority**: é a obrigação legal com prazo mais direta do épico — a inconsistência corrigida aqui (aceitar prestação de contas antes da viagem acabar) é exatamente o tipo de falha que uma auditoria aponta.

**Independent Test**: criar uma diária emitida com `returnDate` amanhã; confirmar que a UI e a API recusam a prestação de contas hoje. Avançar a data (ou usar uma diária com `returnDate` no passado) e confirmar que a operação é aceita e o PDF sai com todos os campos da cartilha.

**Acceptance Scenarios**:

1. **Given** uma diária `ISSUED` cujo `returnDate` é uma data futura, **When** o usuário tenta abrir "Emitir Prestação de Contas" na UI, **Then** a ação aparece desabilitada, com texto explicando a partir de quando ficará disponível.
2. **Given** a mesma diária, **When** a requisição é enviada diretamente à API (contornando a UI), **Then** o servidor recusa com um erro de domínio claro — a regra não pode depender só do botão desabilitado.
3. **Given** uma diária `ISSUED` cujo `returnDate` já passou (ou é hoje), **When** o usuário prestar contas informando bilhete de passagem, notas fiscais, endereço/local do evento, contatos e relatório de atividades, **Then** o Anexo II é gerado com todos esses campos, hash e QR Code, e a diária passa a `ACCOUNTED`.
4. **Given** o formulário de prestação de contas, **When** o usuário adiciona notas fiscais comprobatórias, **Then** cada uma aceita número, favorecido, data e valor, podendo haver várias.
5. **Given** o Anexo II já emitido (hash gravado), **When** qualquer tentativa de editar seus dados de origem (incluindo as notas fiscais) é feita, **Then** a operação é recusada — a mesma imutabilidade já aplicada ao restante do documento.

---

### User Story 2 — Ver o saldo orçamentário real de uma ficha do QDD (Priority: P1)

Ao abrir a aba "Orçamento & QDD", o responsável enxerga, por ficha, quanto já foi consumido por diárias e processos vinculados e quanto resta — inclusive quando o resultado é negativo.

**Why this priority**: sem isso, "Valor Orçado" sozinho não informa a situação real do exercício — é a razão de existir do motor orçamentário dinâmico.

**Independent Test**: cadastrar uma ficha com valor orçado X; emitir uma diária e um processo vinculados a ela; abrir a tela e conferir que "Valor Utilizado" reflete a soma exata e "Saldo Restante" é X menos essa soma — inclusive quando o resultado é negativo.

**Acceptance Scenarios**:

1. **Given** uma ficha do QDD sem nenhum vínculo, **When** a tabela é aberta, **Then** "Valor Utilizado" é zero e "Saldo Restante" é igual a "Valor Orçado".
2. **Given** uma diária **e** um processo vinculados à mesma ficha, **When** a tabela é recarregada, **Then** "Valor Utilizado" é a soma dos dois valores, refletindo qualquer emissão ou exclusão mais recente sem exigir ação manual de recálculo.
3. **Given** o total vinculado excede o valor orçado, **When** a ficha é exibida, **Then** o "Saldo Restante" aparece negativo, destacado visualmente (cor de alerta), sem que a emissão anterior seja bloqueada retroativamente.
4. **Given** uma diária em status `PENDING` (rascunho, não emitida) vinculada a uma ficha, **When** o "Valor Utilizado" é calculado, **Then** ela NÃO entra na soma — só diárias e processos que efetivamente geraram despesa (emitidos) contam.

---

### User Story 3 — Suplementar uma dotação com histórico auditável (Priority: P1)

O responsável orçamentário aumenta (ou reduz) o valor orçado de uma ficha já existente e o sistema registra quem, quando, de quanto para quanto e por quê — sem que o registro anterior desapareça.

**Why this priority**: suplementação orçamentária sem rastro é exatamente o tipo de achado que reprova uma prestação de contas municipal perante o Tribunal de Contas.

**Independent Test**: editar o valor orçado de uma ficha informando o motivo; confirmar que o novo valor passa a valer na tela e que o histórico da ficha lista a alteração com valor anterior, novo, percentual e motivo.

**Acceptance Scenarios**:

1. **Given** uma ficha do QDD, **When** o responsável tenta editar `valorOrcado` sem informar o motivo, **Then** a operação é recusada — motivo é obrigatório, nunca opcional.
2. **Given** a edição informando motivo, **When** ela é salva, **Then** o novo valor passa a valer imediatamente na ficha, e uma entrada de histórico é gravada com valor anterior, valor novo, variação percentual, motivo, autor e data — nunca sobrescrita ou apagada.
3. **Given** uma ficha com histórico de suplementações, **When** o responsável abre seus detalhes, **Then** vê a linha do tempo completa de alterações, mais recente primeiro.

---

### User Story 4 — Vincular conta bancária a um setor, sem risco de saldo divergente (Priority: P2)

Ao cadastrar uma conta bancária, o usuário é obrigado a escolher a Secretaria/Departamento responsável; o campo de Saldo Inicial aparece, mas não pode ser digitado — só a futura integração bancária poderá populá-lo.

**Why this priority**: organiza a base para o controle financeiro por secretaria — mas não é bloqueante para as demais histórias.

**Independent Test**: tentar salvar uma conta sem departamento (deve falhar) e com departamento (deve salvar); tentar enviar um `initialBalanceCents` diferente de zero pela API diretamente e confirmar que o servidor o ignora.

**Acceptance Scenarios**:

1. **Given** o formulário de nova conta bancária, **When** o usuário tenta salvar sem selecionar um departamento, **Then** a operação é recusada, tanto na UI quanto na API.
2. **Given** o mesmo formulário, **When** o usuário abre o campo "Saldo Inicial", **Then** ele está desabilitado para digitação e exibe um tooltip explicando que o valor será populado por integração bancária futura.
3. **Given** uma requisição direta à API contendo `initialBalanceCents` diferente de zero, **When** a conta é criada ou atualizada, **Then** o servidor ignora esse campo do payload — o valor gravado nunca é influenciado por entrada do cliente.
4. **Given** contas bancárias já cadastradas antes deste épico, **When** a migration de `departmentId` obrigatório é aplicada, **Then** nenhuma conta órfã é perdida silenciosamente — o processo de backfill identifica e resolve cada uma antes de tornar o campo obrigatório.

---

### User Story 5 — Ser alertado e justificar diária em fim de semana ou feriado (Priority: P1)

Ao criar ou emitir uma diária cujo período de viagem cobre sábado, domingo ou um feriado cadastrado, o sistema alerta o usuário e exige uma justificativa legal antes de permitir a emissão.

**Why this priority**: é uma exigência normativa do Tribunal de Contas — emitir sem esse controle é uma diária vulnerável a glosa.

**Independent Test**: criar uma diária cujo período inclua um sábado; tentar emitir sem justificativa (deve falhar) e emitir informando justificativa (deve funcionar e a justificativa deve constar no registro).

**Acceptance Scenarios**:

1. **Given** uma diária cujo período (`departureDate` a `returnDate`, inclusive) contém um sábado, domingo, ou uma data cadastrada em `Holiday` para a organização, **When** o formulário é preenchido, **Then** um alerta visual explica quais dias do período caem em fim de semana/feriado.
2. **Given** essa condição, **When** o usuário tenta emitir a diária sem preencher a justificativa, **Then** o servidor recusa a emissão — a regra vale independente do que a UI permitir.
3. **Given** a justificativa preenchida, **When** a diária é emitida, **Then** ela é gravada e aparece no Anexo I, junto dos demais dados.
4. **Given** um período que não toca nenhum fim de semana nem feriado cadastrado, **When** a diária é emitida, **Then** nenhuma justificativa é exigida.
5. **Given** uma organização sem nenhum feriado cadastrado em `Holiday`, **When** uma diária é avaliada, **Then** a regra ainda funciona para sábado/domingo — feriado cadastrado é um acréscimo, não um pré-requisito.

---

### User Story 6 — Ser avisado a tempo do vencimento de um convênio (Priority: P2)

A gestão recebe uma notificação quando a vigência de um convênio (Transferegov) está a 60 e a 30 dias do fim, em vez de descobrir o vencimento perto ou depois do prazo.

**Why this priority**: perder a vigência de um convênio tem consequência financeira e legal direta — mas o Épico 3 já cobre parte do sinal visual, reduzindo a urgência de fechar isto imediatamente.

**Independent Test**: cadastrar um convênio com `validityEndDate` a exatos 60 dias de hoje; rodar o job de verificação; confirmar que uma notificação é criada para os destinatários esperados e que rodar o job de novo no mesmo dia não duplica a notificação.

**Acceptance Scenarios**:

1. **Given** um convênio com `validityEndDate` a 60 dias da execução do job, **When** o job roda, **Then** uma notificação de "vencimento em 60 dias" é criada.
2. **Given** o mesmo convênio, 30 dias depois, **When** o job roda novamente, **Then** uma segunda notificação, distinta da primeira, é criada para "vencimento em 30 dias".
3. **Given** uma notificação já criada para determinado convênio e janela, **When** o job roda novamente antes da próxima janela, **Then** nenhuma notificação duplicada é criada.
4. **Given** um convênio sem `validityEndDate`, **When** o job roda, **Then** ele é ignorado — sem alerta, sem erro.

---

### User Story 7 — Enxergar a fase oficial da despesa num processo (Priority: P3)

Ao abrir um processo virtual, o usuário vê em qual fase da despesa pública ele está — Empenho, Liquidação ou Pagamento — além do status textual que já existe.

**Why this priority**: organiza a leitura do processo à luz da execução orçamentária, mas não bloqueia nenhuma obrigação legal por si só.

**Acceptance Scenarios**:

1. **Given** um processo virtual, **When** o usuário define a fase da despesa, **Then** ela é exibida na listagem e no detalhe, junto do `status` textual já existente — sem que um substitua o outro.
2. **Given** um processo vinculado a uma ficha do QDD, **When** ele é criado ou vinculado, **Then** o mesmo gatilho de consumo da User Story 2 se aplica a ele.

---

### User Story 8 — Localizar rapidamente uma diária (Priority: P3)

A gestão busca diárias por nome, CPF, ou número da diária num único campo de busca, combinando com os filtros já existentes.

**Acceptance Scenarios**:

1. **Given** a listagem de diárias, **When** o usuário digita um nome, um CPF ou um número de diária no campo de busca, **Then** o resultado é filtrado no servidor por qualquer um desses três critérios.
2. **Given** um termo de busca, **When** ele é combinado com os filtros de status, departamento e período já existentes, **Then** os filtros compõem — não se substituem.

### Edge Cases

- Ficha do QDD excluída enquanto ainda referenciada por diária/processo: já recusado (`onDelete: Restrict`, herdado do Épico 4) — este épico preserva a regra e a estende ao `VirtualProcess`.
- Duas emissões simultâneas na mesma ficha, ambas dentro do saldo restante no momento da leitura, mas cuja soma estoura o valor orçado: **ambas são aceitas** (saldo negativo é uma situação válida e alertada, não um erro).
- `valorOrcado` editado para um valor **menor** que o já utilizado: permitido — resulta em saldo negativo imediato, com o mesmo alerta visual; a suplementação para baixo é uma decisão orçamentária legítima (remanejamento).
- Diária cujo período de viagem é um único dia que cai em feriado: mesma regra do intervalo — um único dia dentro do intervalo já dispara o alerta.
- Conta bancária cujo departamento é excluído: recusado (`onDelete: Restrict`) — o vínculo é obrigatório, então o departamento não pode desaparecer por baixo dela.
- Convênio cujo `validityEndDate` é alterado para uma data já dentro da janela de 30 dias, pulando a janela de 60: o job deve gerar a notificação de 30 dias na próxima execução, mesmo sem ter gerado a de 60 antes.

## Requirements *(mandatory)*

### Prestação de contas (US1, US8)

- **FR-001**: O sistema MUST recusar, no servidor, qualquer tentativa de prestar contas de uma diária cujo `returnDate` seja posterior à data corrente — não apenas desabilitar o botão na UI.
- **FR-002**: `DailyAllowance` MUST ganhar um identificador sequencial legível (`sequenceNumber`, `year`, `formattedNumber`), único por organização e ano, atribuído na criação do rascunho.
- **FR-003**: A prestação de contas MUST aceitar `beneficiaryRgIssuer`, `accountabilityTicketNumber`, `accountabilityEventAddress`, `accountabilityContactsInfo` e uma lista de notas fiscais comprobatórias (número, favorecido, data, valor).
- **FR-004**: O Anexo II MUST reproduzir todos os campos da cartilha oficial (identificação do beneficiário, período da viagem, documentos comprobatórios, informações complementares, relatório de atividades, e as linhas de assinatura/aprovação).
- **FR-005**: Uma vez emitido o Anexo II (hash gravado), as notas fiscais comprobatórias vinculadas a ele MUST se tornar imutáveis, na mesma regra já aplicada ao restante do documento.
- **FR-006**: A listagem de diárias MUST aceitar um campo de busca textual único que corresponda a nome do beneficiário, CPF ou número da diária, combinável com os filtros de status, departamento e período já existentes.
- **FR-007**: Toda busca e todo filtro MUST ser aplicado no servidor, dentro do escopo de organização do token.

### Motor Orçamentário (US2, US3, US7)

- **FR-008**: A tela do QDD MUST exibir, por ficha, "Valor Orçado" (persistido), "Valor Utilizado" e "Saldo Restante" (ambos calculados na leitura, nunca persistidos).
- **FR-009**: "Valor Utilizado" MUST ser a soma de `totalAmount` de toda `DailyAllowance` com status `ISSUED` ou `ACCOUNTED` e de todo `VirtualProcess` vinculados àquela ficha — registros em rascunho (`PENDING`) NÃO DEVEM entrar na soma.
- **FR-010**: "Saldo Restante" MUST poder ser negativo; quando negativo, a UI MUST destacá-lo visualmente como alerta (cor de atenção), sem bloquear nenhuma operação já realizada.
- **FR-011**: `VirtualProcess` MUST poder ser vinculado a uma ficha do QDD (`qddItemId`), gravando snapshot textual dos dados da dotação (ficha, fonte, natureza) no momento do vínculo, e uma flag de estouro de dotação — mesmo padrão já usado em `DailyAllowance`.
- **FR-012**: Excluir uma ficha do QDD referenciada por qualquer `VirtualProcess` MUST ser recusado, pela mesma razão já aplicada à `DailyAllowance` (Épico 4, FR-011).
- **FR-013**: Editar `valorOrcado` de uma ficha existente MUST exigir um motivo (texto não vazio) e MUST gravar uma entrada em `BudgetHistory` com valor anterior, valor novo, variação percentual, motivo, autor e data — o histórico nunca é editado nem apagado.
- **FR-014**: A ficha do QDD MUST expor seu histórico de alterações de valor orçado, mais recente primeiro.

### Contas Bancárias (US4)

- **FR-015**: `BankAccount` MUST exigir um departamento vinculado (`departmentId`), obrigatório tanto no formulário quanto na validação do servidor.
- **FR-016**: O campo `initialBalanceCents` MUST ser ignorado pelo servidor em toda requisição de criação ou atualização de conta bancária — nunca influenciado por valor enviado pelo cliente, mesmo que a UI seja contornada.
- **FR-017**: A UI de cadastro de conta bancária MUST exibir o campo "Saldo Inicial" desabilitado para digitação, com um texto explicativo (tooltip) sobre a futura integração bancária.
- **FR-018**: Excluir um departamento que possua conta bancária vinculada MUST ser recusado.

### Ciclo da despesa e alertas (US5, US6, US7)

- **FR-019**: `VirtualProcess` MUST aceitar uma fase de despesa (`expensePhase`: EMPENHO, LIQUIDACAO, PAGAMENTO), como campo adicional e independente do `status` textual já existente.
- **FR-020**: O sistema MUST permitir cadastrar feriados por organização (data, nome, abrangência nacional/estadual/municipal).
- **FR-021**: O sistema MUST identificar quando o período de uma diária (`departureDate` a `returnDate`, inclusive) contém um sábado, um domingo, ou uma data cadastrada em `Holiday` para a organização.
- **FR-022**: Nessa condição, o sistema MUST exigir uma justificativa (texto não vazio) antes de permitir a emissão da diária — validada no servidor, não apenas sinalizada na UI.
- **FR-023**: Um job automático MUST verificar diariamente os convênios cuja `validityEndDate` esteja a exatamente 60 ou 30 dias da data corrente e criar uma notificação para cada janela atingida.
- **FR-024**: O job MUST evitar duplicar notificações para o mesmo convênio e mesma janela (60 ou 30 dias) em execuções subsequentes.

### Transversal

- **FR-025**: Nenhum PDF novo deste épico MAY ter gerador próprio; todos passam por `applyUniversalValidationFooter` (Princípio VIII da constituição).
- **FR-026**: Toda escrita dependente múltipla (ex.: prestar contas = gravar notas fiscais + hash + arquivo + registro) MUST ocorrer em `$transaction`.
- **FR-027**: Toda alteração coberta por este épico (valor orçado, vínculo de QDD, conta bancária, feriado) MUST respeitar o escopo de organização do token — nenhuma leitura ou escrita cruza tenants.

### Key Entities

- **DailyAllowance**: ganha numeração legível e os campos da cartilha oficial capturados na prestação de contas; ganha também a justificativa de fim de semana/feriado.
- **DailyAllowanceReceipt**: nota fiscal comprobatória de uma prestação de contas — várias por diária, imutável após emissão do Anexo II.
- **QddItem**: continua guardando só o valor orçado; "utilizado" e "saldo" passam a ser calculados a partir dela, nunca gravados nela.
- **BudgetHistory**: um registro por alteração de valor orçado — o rastro de suplementação exigido pelo cliente.
- **VirtualProcess**: ganha vínculo com QDD (mesmo padrão da Diária) e uma fase de despesa paralela ao status existente.
- **BankAccount**: passa a exigir departamento; saldo inicial deixa de ser editável por qualquer caminho da API.
- **Holiday**: feriado cadastrável por organização, usado no alerta de fim de semana/feriado.

## Success Criteria *(mandatory)*

- **SC-001**: 100% das tentativas de prestação de contas com `returnDate` futuro são recusadas pelo servidor, mesmo quando enviadas diretamente à API.
- **SC-002**: Toda ficha do QDD exibida na tela reflete, sem intervenção manual, a soma exata de diárias e processos emitidos vinculados a ela.
- **SC-003**: 100% das edições de valor orçado geram uma entrada de histórico rastreável, sem exceção.
- **SC-004**: Nenhuma conta bancária pode ser criada ou atualizada sem departamento, e nenhum valor de saldo inicial enviado pelo cliente é gravado.
- **SC-005**: 100% das diárias cujo período cobre sábado, domingo ou feriado cadastrado exigem justificativa antes da emissão — verificável caso a caso.
- **SC-006**: Um convênio a 60 e a 30 dias do vencimento gera exatamente uma notificação por janela, nunca duplicada.

## Assumptions

- **O bloco "Aprovação" da cartilha é impresso, não é um workflow digital.** As linhas de assinatura do setor responsável e do Ordenador de Despesas saem no PDF como campos para assinatura manual (o segundo já preenchível a partir de `Department.chiefName`); este épico não cria um segundo status de aprovação para `DailyAllowance`. Se a intenção for um fluxo de aprovação digital com estado próprio, é escopo adicional a ser tratado como extensão futura.
- **O layout exato (diagramação) do Anexo II segue o campo-a-campo da cartilha anexada**, mas o posicionamento visual final (margens, fontes, quebras de página) fica a critério do motor universal de PDF já existente — o contrato de dados é o que este documento fixa, não os pixels.
- **A numeração da diária (`sequenceNumber`/`year`/`formattedNumber`) segue o mesmo padrão de `OfficialDocument`**, reaproveitando a convenção já validada em produção, em vez de um esquema novo.
- **Feriados nacionais fixos não são pré-carregados automaticamente neste épico** — cada organização cadastra os feriados que lhe interessam (nacionais, estaduais e municipais); poderá haver uma seed opcional de feriados nacionais como tarefa de conveniência, não como requisito.
- **Os destinatários da notificação de vencimento de convênio** são o gestor do departamento vinculado ao convênio (quando houver) e os usuários com permissão de escrita em convênios na organização — a lista exata de papéis é uma decisão de implementação, não uma regra de negócio nova.

## Out of Scope

- Workflow de aprovação digital da prestação de contas (assinatura eletrônica do setor responsável/Ordenador) — ver Assumptions.
- Integração bancária real que popule `initialBalanceCents` — este épico só bloqueia o campo; a integração em si é um épico futuro.
- Reconciliação retroativa de diárias/processos emitidos antes deste épico contra a nova numeração — registros antigos permanecem sem `sequenceNumber` ou recebem numeração best-effort na migration (decisão tomada na fase de banco, documentada no plano).
- Configuração de recorrência ou feriados móveis calculados automaticamente (ex.: Carnaval, Corpus Christi) — o cadastro é manual, por data.
- Alterar o `status` textual de `VirtualProcess` ou migrar seus valores existentes — `expensePhase` é aditivo.
