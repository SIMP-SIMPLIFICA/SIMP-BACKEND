# Feature Specification: Épico 4 — Departamentos, Motor Orçamentário (QDD) e Novo Fluxo de Diárias

**Feature Branch**: `epic4-budget-daily-allowances`

**Created**: 2026-09-13

**Status**: Draft — aguardando validação

**Input**: User description: "(1) Evolução dos Departamentos: `cnpj`, `chiefName` (Ordenador de Despesa), relações N:N com Conselhos, `departmentId` opcional em Convênios e Processos Virtuais, aba de detalhes com vínculos e 'Dossiê do Setor' em PDF. (2) Motor Orçamentário: models `BudgetLaw` (LOA/PPA/LDO) e `QddItem` (ficha, fonte, projeto/atividade, natureza da despesa, valor orçado), com aba 'Orçamento & QDD'. (3) Novo fluxo de Diárias: exigir `departmentId`, vincular `qddItemId`, `status` (PENDING, ISSUED, ACCOUNTED), solicitação em 3 passos. (4) Prestação de contas: `accountabilityDate`, `activityReport`, alerta de atraso no dashboard, modal bloqueado, Anexo I e Anexo II em PDF. (5) Filtros e relatório consolidado de diárias."

---

## Investigation note

Verificado contra `prisma/schema.prisma`, serviços, rotas e telas. **Sete achados alteram o escopo real** — três reduzem trabalho, quatro acrescentam.

### O que já existe (não refazer)

| Item pedido | Estado | Evidência |
|---|---|---|
| Autocomplete de Beneficiário com memória (Fase 3, passo 2) | ✅ **completo** | `Beneficiary` + `beneficiary.service.ts` (normalização em caixa alta, P2002 idempotente) e `BeneficiaryCombobox.tsx` com criação ao desfocar e exclusão por item |
| `DailyAllowance` base | ✅ existe | `beneficiaryName` (texto), `publicId`, `sha256Hash`, `issuedAt`, `pdfFileKey` |
| Motor universal de PDF | ✅ existe | `document-pdf.service.ts` com `applyUniversalValidationFooter` e `createTabularReportPdf` |
| Ofuscação LGPD | ✅ existe | `lgpd-anonymizer.util.ts` + testes |

**Decisão herdada que este épico NÃO deve reverter**: `DailyAllowance.beneficiaryName` é **texto**, não chave estrangeira para `Beneficiary`. Um documento emitido precisa preservar o nome impresso nele; renomear ou excluir o cadastro não pode reescrever um recibo já entregue ao Tribunal de Contas. O mesmo raciocínio vale para o vínculo com o QDD (ver FR-018).

### O que não existe (trabalho real)

| Item | Estado |
|---|---|
| `Department.cnpj`, `Department.chiefName` | ❌ ausentes |
| Relação N:N `Council` ↔ `Department` | ❌ ausente |
| `departmentId` em `Covenant` e `VirtualProcess` | ❌ ausente (0 ocorrências em ambos) |
| `BudgetLaw`, `QddItem` | ❌ ausentes |
| `DailyAllowance.departmentId`, `.qddItemId`, `.status` | ❌ ausentes |
| `accountabilityDate`, `activityReport` | ❌ ausentes |

### Achados que mudam a forma de fazer

**A. O retrofit do rodapé universal está PENDENTE e bloqueia as Fases 3 e 4.**
`daily-allowance.service.ts` e `fleet-fueling.service.ts` imprimem o nome **completo** de quem emitiu no corpo do PDF (`'Emitido por'` / `'Registrado por'`), sem passar pelo anonimizador, e não passam `exporterName` ao rodapé. O `SIMP-FRONTEND` ainda gera o Calendário de Reuniões localmente com jsPDF (`src/utils/councilCalendarPdf.ts`), portanto sem QR Code e sem registro em `ExportedDocument`.
Especificar Anexo I e Anexo II (Fase 4) sobre uma base que viola a Constituição (Princípio VIII) multiplicaria a violação por dois documentos novos. **O retrofit é pré-requisito, não item paralelo.**

**B. `chiefName` não é `managerId`.** `Department` já tem `managerId` → `User`. O **Ordenador de Despesa** frequentemente não é usuário do sistema, e é uma figura **jurídica** (responde pelo empenho). São campos distintos com propósitos distintos: `managerId` é operacional, `chiefName` é a autoridade que assina. Manter os dois, documentando a diferença.

**C. `Department.organizationId` é OPCIONAL (`String?`).** É o único modelo de domínio sem escopo de tenant obrigatório — violação já existente do Princípio IV. Ligar Conselhos, Convênios, Processos, QDD e Diárias a `Department` faz essas relações **herdarem** o isolamento fraco: um departamento órfão (sem organização) se tornaria ponte entre prefeituras. Endurecer esse campo é pré-requisito da Fase 1.

**D. "PDF/XLS pelo motor universal" é impossível para XLS.** O motor estampa QR Code e rodapé em página PDF; uma planilha não tem rodapé de página nem suporta a mesma estampa. Três saídas possíveis — **decisão pendente do cliente** (ver Open Question 1).

**E. O QDD precisa de unicidade por ficha.** "Ficha" é o identificador orçamentário da dotação no exercício. Duas fichas iguais no mesmo departamento/ano tornariam ambíguo a qual dotação a diária foi imputada.

**F. Diária sem saldo orçamentário.** O pedido vincula `qddItemId` mas não diz o que acontece quando o valor da diária excede o `valorOrcado` da ficha. É a decisão central do motor orçamentário (ver Open Question 2).

**G. O alerta de atraso depende de `returnDate` + 5 dias**, mas nada impede hoje uma diária `ISSUED` sem prestação de contas indefinidamente. O alerta é de **leitura**; não há regra de bloqueio pedida. Especificado como visual apenas.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Emitir diária imputada a uma dotação orçamentária real (Priority: P1)

A secretária seleciona o Departamento, escolhe o beneficiário e imputa a diária a uma ficha do QDD daquele setor, de modo que o empenho tenha lastro orçamentário identificável.

**Why this priority**: é a razão de existir do épico. Diária sem dotação identificada é despesa sem lastro — exatamente o apontamento que o Tribunal de Contas faz. As demais histórias organizam ou relatam o que esta produz.

**Independent Test**: criar um departamento com uma ficha de QDD, solicitar uma diária escolhendo essa ficha e conferir que o registro gravado aponta para a dotação e reproduz seus dados no documento emitido.

**Acceptance Scenarios**:

1. **Given** um departamento com fichas de QDD cadastradas para o exercício corrente, **When** a secretária abre a solicitação de diária e seleciona o departamento, **Then** CNPJ e Ordenador de Despesa são preenchidos automaticamente e apenas as fichas daquele departamento e exercício são oferecidas.
2. **Given** a ficha selecionada, **When** a diária é salva, **Then** o registro guarda o vínculo com a dotação **e** uma cópia dos dados orçamentários vigentes no momento da emissão.
3. **Given** um departamento sem nenhuma ficha cadastrada, **When** a secretária tenta avançar, **Then** o sistema informa que o setor não possui dotação cadastrada para o exercício e indica onde cadastrá-la — em vez de apresentar uma lista vazia sem explicação.
4. **Given** uma diária sendo criada, **When** nenhum departamento é informado, **Then** a operação é recusada pelo servidor, não apenas pela tela.

---

### User Story 2 — Prestar contas dentro do prazo e enxergar quem está atrasado (Priority: P1)

Após a viagem, o servidor registra a data de prestação de contas e o relatório de atividades; a gestão enxerga no painel quem passou do prazo.

**Why this priority**: a prestação de contas é obrigação legal com prazo. Sem o alerta, o atraso só aparece na auditoria — quando já é irregularidade consumada.

**Independent Test**: emitir uma diária com data de volta de 10 dias atrás e sem prestação de contas; confirmar que ela aparece como atrasada no painel. Prestar contas e confirmar que sai do alerta.

**Acceptance Scenarios**:

1. **Given** uma diária emitida cuja data de volta somada a 5 dias já passou e que não tem prestação de contas, **When** a gestão abre o painel, **Then** a diária aparece destacada como atrasada.
2. **Given** a mesma diária, **When** o servidor registra data e relatório, **Then** ela sai do alerta e passa à situação de prestada.
3. **Given** o modal de prestação de contas, **When** ele é aberto, **Then** os dados da diária aparecem **bloqueados para edição** e apenas data e relatório são editáveis — prestar contas não é oportunidade de corrigir o pedido.
4. **Given** uma diária ainda não emitida, **When** se tenta prestar contas, **Then** a operação é recusada: não se presta contas de algo que não foi emitido.

---

### User Story 3 — Enxergar tudo que pertence a um setor (Priority: P2)

O gestor abre o departamento e vê, em um só lugar, seus conselhos, convênios, processos virtuais e dotações — e exporta esse conjunto como "Dossiê do Setor".

**Why this priority**: consolida informação hoje dispersa em cinco telas. Valioso, mas nenhuma obrigação legal depende dele.

**Acceptance Scenarios**:

1. **Given** um departamento com vínculos, **When** o gestor abre sua aba de detalhes, **Then** vê as listas de conselhos, convênios e processos vinculados, cada item navegável para seu registro.
2. **Given** a tela do dossiê, **When** o gestor escolhe quais blocos incluir (servidores, CNPJ, conselhos, QDD) e confirma, **Then** o PDF sai apenas com os blocos escolhidos.
3. **Given** o dossiê gerado, **When** se lê seu rodapé, **Then** ele traz QR Code de verificação e o emissor ofuscado, como qualquer documento oficial do sistema.

---

### User Story 4 — Gerenciar o orçamento do setor (Priority: P2)

O responsável cadastra as leis orçamentárias e mantém a tabela de fichas do QDD do exercício.

**Acceptance Scenarios**:

1. **Given** a aba "Orçamento & QDD", **When** o responsável adiciona uma ficha informando ficha, fonte, projeto/atividade, natureza e valor orçado, **Then** ela passa a ser oferecida na solicitação de diária do setor.
2. **Given** uma ficha já cadastrada, **When** se tenta cadastrar outra com o mesmo número no mesmo departamento e exercício, **Then** a operação é recusada com mensagem clara.
3. **Given** uma ficha já referenciada por uma diária emitida, **When** se tenta excluí-la, **Then** a exclusão é recusada — apagar a dotação apagaria o lastro de uma despesa já documentada.

---

### User Story 5 — Localizar e relatar diárias (Priority: P3)

A gestão filtra as diárias por nome, CPF, período, destino, situação e departamento, e exporta o resultado consolidado.

**Acceptance Scenarios**:

1. **Given** a listagem de diárias, **When** a gestão aplica filtros combinados, **Then** a lista reflete exatamente a combinação.
2. **Given** filtros aplicados, **When** a gestão exporta o relatório, **Then** o PDF cobre **os mesmos** registros exibidos e declara no cabeçalho quais filtros foram usados.

---

## Requirements *(mandatory)*

### Departamentos (Fase 1)

- **FR-001**: `Department` MUST ganhar `cnpj` (opcional) e `chiefName` (opcional), este último representando o Ordenador de Despesa, distinto de `managerId`.
- **FR-002**: `Department.organizationId` MUST se tornar obrigatório, com backfill dos registros existentes, antes de qualquer nova relação apontar para `Department` (Princípio IV).
- **FR-003**: O sistema MUST permitir vincular um departamento a vários conselhos e um conselho a vários departamentos (N:N), com o vínculo escopado por organização.
- **FR-004**: `Covenant` e `VirtualProcess` MUST aceitar `departmentId` opcional, com `onDelete: SetNull` — excluir um setor não pode apagar convênio nem processo.
- **FR-005**: Os modais de criação de convênio e de processo MUST listar os departamentos existentes no banco, nunca uma lista fixa em código.
- **FR-006**: O Dossiê do Setor MUST ser gerado pelo motor universal, com blocos opcionais selecionáveis, e MUST ser registrado em `ExportedDocument`.

### Motor Orçamentário (Fase 2)

- **FR-007**: `BudgetLaw` MUST registrar `departmentId`, `type` (LOA, PPA, LDO), `year` e `details`, escopado por organização.
- **FR-008**: `QddItem` MUST registrar `departmentId`, `year`, `ficha`, `fonte`, `projetoAtividade`, `naturezaDespesa` e `valorOrcado`.
- **FR-009**: `valorOrcado` MUST ser `Decimal(15,2)` — dinheiro público não admite ponto flutuante.
- **FR-010**: `QddItem` MUST ter unicidade por (`departmentId`, `year`, `ficha`).
- **FR-011**: Excluir um `QddItem` referenciado por qualquer diária MUST ser recusado.

### Novo fluxo de Diárias (Fase 3)

- **FR-012**: `DailyAllowance` MUST exigir `departmentId`.
- **FR-013**: `DailyAllowance` MUST aceitar `qddItemId`, com `onDelete: Restrict`.
- **FR-014**: `DailyAllowance` MUST ter `status` com os valores `PENDING`, `ISSUED` e `ACCOUNTED`.
- **FR-015**: A emissão MUST mover o status para `ISSUED`; a prestação de contas, para `ACCOUNTED`.
- **FR-016**: A regra de imutabilidade herdada MUST ser preservada: com `sha256Hash` gravado, o registro não aceita alteração de seus dados de origem (HTTP 409).
- **FR-017**: A solicitação MUST ocorrer em três passos: departamento (auto-preenchendo CNPJ e Ordenador), beneficiário (autocomplete existente) e rubrica do QDD.
- **FR-018**: No momento da emissão, o sistema MUST gravar na diária uma **cópia textual** dos dados orçamentários (ficha, fonte, natureza) — pelo mesmo motivo de `beneficiaryName` ser texto: o documento emitido não pode mudar quando o cadastro muda.

### Prestação de contas (Fase 4)

- **FR-019**: `DailyAllowance` MUST aceitar `accountabilityDate` e `activityReport`.
- **FR-020**: Uma diária MUST ser considerada atrasada quando estiver `ISSUED`, sem `accountabilityDate`, e a data atual for maior que `returnDate` + 5 dias.
- **FR-021**: O cálculo do atraso MUST acontecer no servidor; a interface não recalcula a regra com o relógio do navegador.
- **FR-022**: O modal de prestação de contas MUST apresentar os dados da diária somente para leitura.
- **FR-023**: Prestar contas de diária não emitida MUST ser recusado.
- **FR-024**: O sistema MUST produzir dois documentos distintos — **Anexo I** (solicitação) e **Anexo II** (prestação de contas, com instrução sobre os anexos comprobatórios) — ambos pelo motor universal e ambos registrados em `ExportedDocument`.

### Filtros e relatório (Fase 5)

- **FR-025**: A listagem MUST aceitar filtros por nome do beneficiário, CPF, período, destino, situação e departamento.
- **FR-026**: O relatório consolidado MUST consumir exatamente os mesmos filtros da listagem e declará-los no cabeçalho do PDF.
- **FR-027**: Todo filtro MUST ser aplicado no servidor, dentro do escopo de organização do token.

### Transversal

- **FR-028**: Nenhum PDF novo deste épico MAY ter gerador próprio; todos passam por `applyUniversalValidationFooter` (Princípio VIII).
- **FR-029**: Nenhum nome pessoal MAY ser gravado ou impresso sem passar pelo anonimizador, exceto signatários de ato oficial.
- **FR-030**: Toda escrita dependente múltipla (emitir diária = gravar hash + arquivo + registro) MUST ocorrer em `$transaction`.

### Key Entities

- **Department**: setor administrativo; ganha CNPJ e Ordenador de Despesa; passa a ser o eixo de ligação entre conselhos, convênios, processos, orçamento e diárias.
- **BudgetLaw**: lei orçamentária (LOA, PPA, LDO) de um departamento num exercício.
- **QddItem**: dotação do Quadro de Detalhamento da Despesa — a rubrica à qual a diária é imputada.
- **DailyAllowance**: passa a exigir departamento, apontar para a dotação e percorrer três situações.

---

## Success Criteria *(mandatory)*

- **SC-001**: 100% das diárias criadas após a entrega possuem departamento e dotação identificados.
- **SC-002**: Uma diária emitida e uma prestação de contas registrada geram, cada uma, um documento verificável no Portal Público pelo QR Code.
- **SC-003**: Nenhum PDF do sistema exibe nome pessoal completo de quem emitiu — verificável abrindo um documento de cada tipo.
- **SC-004**: Uma diária vencida há mais de 5 dias sem prestação de contas aparece no painel no mesmo dia em que o prazo vence.
- **SC-005**: Tentar excluir uma dotação usada por diária emitida falha, e a mensagem explica por quê.
- **SC-006**: O relatório consolidado e a listagem, com os mesmos filtros, cobrem o mesmo conjunto de registros.

---

## Open Questions *(bloqueiam o início das fases indicadas)*

1. **XLS pelo motor universal (bloqueia Fase 5).** A regra diz "todo PDF/XLS pelo motor", mas planilha não comporta rodapé com QR Code. Saídas: (a) exportações em XLS não carregam validação e ficam declaradas como material de trabalho, não documento oficial; (b) toda exportação oficial é PDF, e XLS deixa de existir; (c) o XLS é acompanhado de um PDF-manifesto assinado com o hash da planilha. **Recomendação: (c)** — preserva a planilha útil e mantém a cadeia de validação íntegra.
2. **Diária acima do valor orçado (bloqueia Fase 3).** O que fazer quando a soma das diárias imputadas a uma ficha excede `valorOrcado`: (a) bloquear a emissão; (b) permitir e alertar; (c) ignorar. **Recomendação: (b)** — o bloqueio total engessa remanejamento orçamentário legítimo, mas emitir em silêncio esconde estouro de dotação.
3. **CPF do beneficiário (bloqueia FR-025).** O filtro por CPF é pedido, mas `Beneficiary` hoje só guarda `name`. É preciso decidir se o CPF passa a ser cadastrado — e, sendo dado pessoal sensível, como é exibido e se entra nos documentos.

---

## Out of Scope

- Empenho, liquidação e pagamento — o épico identifica a dotação, não executa a despesa.
- Importação automática de LOA/PPA/LDO a partir de arquivo externo.
- Fórum Público (o Princípio VII prepara o terreno do ticket de suporte, mas o fórum não é deste épico).
- Reversão da decisão de `beneficiaryName` como texto.
