# Feature Specification: Épico 3 — Documentos compartilhados entre Convênios e Processos Virtuais

**Feature Branch**: `epic3-covenants-processes-docs`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "Relação N:N entre Convênio e Processo Virtual. Documento anexado via Convênio deve poder ter um `virtualProcessId` opcional, aparecendo também no processo, sem duplo upload. Upload do Convênio aceita `virtualProcessId`; listagem do Processo mescla os documentos vindos do Convênio. Aba Documentos do Convênio agrupada por Processo ('Processo nº X - Secretaria - Objeto'), com bloco 'Gerais' para os sem vínculo. Select 'Vincular a qual Processo?' no upload, visível só se o Convênio tiver processos associados."

**Investigation note**: verificado contra schema, banco e telas. **Boa parte da fundação já existe** — o que reduz o escopo real e está sinalizado abaixo:

1. **A relação N:N já existe e está funcional.** `Covenant.virtualProcesses` ↔ `VirtualProcess.covenants`, com a tabela pivô implícita `_CovenantToVirtualProcess` confirmada no banco (chaves estrangeiras e índices corretos). **Nenhuma migration de relacionamento é necessária.**
2. **`LibraryDocument.covenantId` já existe** e é o caminho pelo qual os documentos de convênio são gravados hoje. Falta apenas `virtualProcessId`.
3. **A aba Documentos do Convênio já mescla duas fontes** — os documentos do próprio convênio (`LibraryDocument`) e os dos processos vinculados (`VirtualProcessDocument`). O que falta é o **agrupamento por processo** e a possibilidade de atribuir um documento do convênio a um processo específico.
4. **Existem DOIS modelos de documento distintos**, com formatos diferentes: `LibraryDocument` (id nanoid, `fileKey`, `accessLevel`, título) e `VirtualProcessDocument` (id uuid, `fileUrl`, `tag`, `description`). Qualquer tela que mostre os dois juntos precisa normalizá-los — é o ponto central de desenho deste épico.

Detalhe técnico em `.specify/plans/epic3-covenants-processes-docs.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Anexar no Convênio já indicando o processo (Priority: P1)

Ao anexar um documento na aba Documentos de um convênio, o usuário deve poder indicar a qual processo virtual aquele arquivo pertence — sem precisar subir o mesmo arquivo duas vezes.

**Why this priority**: É a entrada de dado que viabiliza todo o resto. Sem ela, não há como um documento do convênio "saber" a que processo pertence, e o duplo upload continua sendo a única saída.

**Independent Test**: Em um convênio com processos vinculados, anexar um PDF escolhendo um processo; conferir que o arquivo aparece atribuído àquele processo e que não foi necessário subir nada duas vezes.

**Acceptance Scenarios**:

1. **Given** um convênio com ao menos um processo virtual vinculado, **When** o usuário anexa um documento, **Then** ele pode escolher a qual processo vincular o arquivo.
2. **Given** um convênio **sem** nenhum processo vinculado, **When** o usuário anexa um documento, **Then** o campo de escolha de processo não é oferecido — não faz sentido escolher de uma lista vazia.
3. **Given** o campo de escolha de processo é oferecido, **When** o usuário não escolhe nenhum, **Then** o upload conclui normalmente e o documento fica como geral do convênio — a vinculação é opcional.
4. **Given** um documento anexado com processo indicado, **When** o upload conclui, **Then** existe **um único arquivo armazenado**, visível a partir das duas telas — não uma cópia em cada.

---

### User Story 2 - Ver os documentos do convênio organizados por processo (Priority: P1)

Na aba Documentos do convênio, os arquivos devem aparecer agrupados por processo virtual, com um bloco separado para os que não pertencem a nenhum.

**Why this priority**: Um convênio de porte real acumula dezenas de documentos de vários processos. Uma lista plana obriga a abrir arquivo por arquivo para saber a que processo pertence — que é exatamente o problema que motivou o épico.

**Independent Test**: Em um convênio com dois processos vinculados e documentos em ambos (mais alguns sem vínculo), abrir a aba Documentos e conferir que há um bloco por processo, identificando cada um, e um bloco para os sem vínculo.

**Acceptance Scenarios**:

1. **Given** um convênio com documentos vinculados a processos distintos, **When** o usuário abre a aba Documentos, **Then** os arquivos aparecem agrupados em blocos, um por processo.
2. **Given** cada bloco de processo, **When** exibido, **Then** o cabeçalho identifica o processo de forma suficiente para distingui-lo dos demais (número, secretaria e objeto).
3. **Given** documentos sem vínculo a processo, **When** a aba é exibida, **Then** eles aparecem em um bloco próprio de documentos gerais do convênio.
4. **Given** um processo vinculado que possui documentos anexados diretamente nele (não pelo convênio), **When** a aba do convênio é exibida, **Then** esses documentos também aparecem no bloco daquele processo — o agrupamento reflete tudo que pertence ao processo, independentemente de onde foi anexado.
5. **Given** um convênio sem nenhum documento, **When** a aba é aberta, **Then** exibe um estado vazio claro, sem blocos vazios.

---

### User Story 3 - Ver, no processo, os documentos que vieram pelo convênio (Priority: P1)

A aba Documentos de um processo virtual deve listar tanto os arquivos anexados diretamente nele quanto os anexados pelo convênio e atribuídos a ele.

**Why this priority**: É o outro lado da promessa central ("visível lá também, sem exigir duplo upload"). Sem esta história, o dado é gravado mas nunca aparece onde o usuário do processo precisa dele.

**Independent Test**: Anexar um documento pelo convênio indicando um processo; abrir aquele processo e confirmar que o arquivo aparece na aba Documentos dele.

**Acceptance Scenarios**:

1. **Given** um documento anexado pelo convênio e atribuído a um processo, **When** o usuário abre a aba Documentos daquele processo, **Then** o arquivo aparece na lista.
2. **Given** a lista do processo contém arquivos de origens diferentes, **When** exibida, **Then** é possível distinguir o que foi anexado diretamente no processo do que veio pelo convênio — para que ninguém tente excluir, pelo processo, um arquivo que pertence ao acervo do convênio.
3. **Given** um documento vindo do convênio, **When** o usuário o abre a partir do processo, **Then** o download funciona normalmente.
4. **Given** um processo sem nenhum documento de qualquer origem, **When** a aba é aberta, **Then** exibe estado vazio, sem erro.

### Edge Cases

- **Processo desvinculado do convênio** depois de já haver documentos atribuídos a ele: o documento não pode desaparecer nem ficar órfão de forma silenciosa — precisa continuar acessível em algum lugar.
- **Documento atribuído a um processo de outro convênio** (ou a um processo que não pertence ao convênio de origem): a interface só deve oferecer processos realmente vinculados àquele convênio, e o servidor precisa recusar o que vier fora dessa regra, ainda que a interface o impeça.
- **Exclusão de um processo** que possui documentos de convênio atribuídos: o comportamento precisa ser definido explicitamente — apagar o documento junto seria destruir acervo do convênio.
- **Níveis de sigilo**: documentos de convênio já têm nível de acesso (`accessLevel`); ao aparecerem na tela do processo, essa regra não pode ser contornada.
- **Duas telas, dois formatos**: como os dois modelos de documento têm campos distintos, a exibição unificada não pode quebrar quando um campo existir em um e não no outro.

## Requirements *(mandatory)*

### Dados

- **FR-001**: Um documento anexado por meio de um convênio DEVE poder referenciar, opcionalmente, um processo virtual.
- **FR-002**: A referência DEVE ser opcional — documentos gerais do convênio continuam válidos e não podem ser bloqueados.
- **FR-003**: O sistema NÃO DEVE armazenar cópias duplicadas do arquivo para exibi-lo nas duas telas.

### Backend

- **FR-004**: O upload a partir do convênio DEVE aceitar a indicação opcional de processo virtual.
- **FR-005**: O sistema DEVE recusar a vinculação de um documento a um processo que não esteja associado ao convênio de origem.
- **FR-006**: A consulta de um processo virtual DEVE retornar, além dos documentos anexados diretamente nele, os documentos de convênio atribuídos a ele.
- **FR-007**: Os documentos retornados DEVEM permitir identificar sua origem (anexado no processo ou vindo do convênio).
- **FR-008**: As regras de isolamento por organização e de nível de acesso já vigentes DEVEM continuar valendo para os documentos exibidos por qualquer um dos dois caminhos.

### Frontend

- **FR-009**: A aba Documentos do convênio DEVE agrupar os arquivos por processo virtual, com bloco próprio para os sem vínculo.
- **FR-010**: O cabeçalho de cada bloco DEVE identificar o processo por número, secretaria e objeto.
- **FR-011**: O campo de escolha de processo no upload DEVE aparecer somente quando o convênio tiver processos vinculados.
- **FR-012**: A aba Documentos do processo DEVE exibir as duas origens em uma lista unificada, com indicação visual da procedência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um documento anexado uma única vez pelo convênio, com processo indicado, é visível nas duas telas — verificado com contagem de arquivos armazenados igual a um.
- **SC-002**: 100% dos documentos de um convênio aparecem em algum bloco da aba Documentos (de processo ou geral), sem nenhum arquivo "sumindo" do agrupamento.
- **SC-003**: Zero documentos vinculados a processos que não pertencem ao convênio de origem, verificado inclusive por tentativa direta na API.
- **SC-004**: Na aba do processo, 100% dos documentos exibidos permitem identificar a origem e podem ser baixados.

## Assumptions

- **A relação N:N não será criada nem alterada** — ela já existe e está funcional (`_CovenantToVirtualProcess`). O épico se apoia nela.
- **O vínculo documento↔processo é 1:1 opcional** (um documento pertence a no máximo um processo), conforme o pedido descreve (`virtualProcessId` opcional). Se um mesmo documento precisar pertencer a vários processos, isso exigiria outra tabela pivô e não está no escopo.
- **Os dois modelos de documento continuam separados.** Unificá-los em um só modelo seria uma refatoração de grande porte, com migração de dados e impacto em Biblioteca, Conselhos e Processos — este épico apenas os apresenta juntos na interface, normalizando na leitura.
- **Documentos anexados diretamente no processo continuam sem vínculo com o convênio** — a direção de compartilhamento pedida é convênio → processo. O caminho inverso (marcar, no processo, que um arquivo pertence ao convênio) não foi pedido e não está incluído.
- **Exclusão de documento continua acontecendo na tela de origem** — a tela do processo exibe os documentos do convênio, mas a gestão (excluir/substituir) permanece onde o arquivo foi anexado, para evitar que alguém apague acervo do convênio sem perceber.
