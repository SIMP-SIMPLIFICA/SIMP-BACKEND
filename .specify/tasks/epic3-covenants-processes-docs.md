---
description: "Task list for feature: Épico 3 — Documentos compartilhados entre Convênios e Processos Virtuais"
---

# Tasks: Documentos compartilhados entre Convênios e Processos Virtuais

**Input**: `.specify/specs/epic3-covenants-processes-docs.md` e `.specify/plans/epic3-covenants-processes-docs.md`

**Tests**: Sem tarefas de teste automatizado dedicadas — verificação manual por história, padrão dos épicos anteriores. `npm run type-check`/`lint` como gates obrigatórios.

**Organização**: Separado em **Banco**, **Backend** e **Frontend**, conforme pedido.

---

## Fase 1: Banco de Dados

*(A relação N:N Convênio ↔ Processo **já existe e está funcional** — `_CovenantToVirtualProcess`, confirmada no banco com FKs e índices. Nenhuma migration de relacionamento será criada.)*

- [ ] [Banco] T001 Em `prisma/schema.prisma`, adicionar a `LibraryDocument`: `virtualProcessId String? @map("virtual_process_id")`, a relação `virtualProcess VirtualProcess? @relation(fields: [virtualProcessId], references: [id], onDelete: SetNull)` e `@@index([virtualProcessId])`. Adicionar a relação inversa `libraryDocuments LibraryDocument[]` em `VirtualProcess`. **`SetNull` é deliberado**: excluir um processo não pode apagar documento do acervo do convênio — o arquivo volta a ser "geral"
- [ ] [Banco] T002 Aplicar com `npx prisma db push` (o `migrate dev` está bloqueado por drift pré-existente — ver `docs/TechStack.md`). Coluna opcional e aditiva, sem risco para dado existente
- [ ] [Banco] T003 Rodar `npx prisma generate` e confirmar o campo nos tipos. Se o dev server estiver rodando, o generate falha com EPERM no `.dll` — os tipos saem mesmo assim, mas o servidor precisa reiniciar para o client novo valer em runtime

**Checkpoint**: coluna disponível, relação N:N intacta.

---

## Fase 2: Backend

**Depends on**: Fase 1.

- [ ] [Backend] T004 Em `library.controller.ts::upload`, ler `virtualProcessId` dos campos multipart (mesmo tratamento de string vazia/"null"/"undefined" já aplicado a `covenantId`) e persistir quando presente
- [ ] [Backend] T005 Ainda no `upload`, **validar o vínculo antes de gravar**: se `virtualProcessId` vier junto de `covenantId`, confirmar que aquele processo está de fato entre os processos vinculados ao convênio; caso contrário, recusar com 400 e mensagem clara (FR-005). A interface já vai oferecer só os corretos, mas a interface não é fronteira de segurança
- [ ] [Backend] T006 Em `virtual-process.controller.ts::getProcessDetails`, incluir os `LibraryDocument` cujo `virtualProcessId` é o processo consultado (respeitando `deletedAt: null` e o filtro de organização já existente), devolvendo-os em uma chave própria na resposta
- [ ] [Backend] T007 Marcar a origem de cada documento na resposta (`source: 'process' | 'covenant'`), para que o frontend distinga procedência (FR-007) e não ofereça exclusão sobre acervo do convênio
- [ ] [Backend] T008 Verificar manualmente via API: upload pelo convênio com `virtualProcessId` válido grava o vínculo; com um processo **não vinculado** ao convênio é recusado; `GET /virtual-processes/:id` passa a retornar os documentos do convênio atribuídos, com a origem marcada

**Checkpoint**: vínculo gravado, validado e devolvido nas duas pontas.

---

## Fase 3: Frontend — Convênios

**Depends on**: Fase 2.

- [ ] [Frontend] T009 Em `src/lib/api/library.ts`, permitir que `upload` envie `virtualProcessId` opcional junto do `covenantId` já suportado
- [ ] [Frontend] T010 Em `CovenantDetailSheet.tsx` (`DocumentosTab`), substituir a lista plana atual por **agrupamento por processo**: um bloco por processo vinculado, cabeçalho identificando "Processo nº X — Secretaria — Objeto", mais um bloco final "Gerais" para documentos sem vínculo (FR-009, FR-010)
- [ ] [Frontend] T011 Em cada bloco de processo, reunir as **duas** origens: os `LibraryDocument` do convênio atribuídos àquele processo **e** os `VirtualProcessDocument` daquele processo (que a tela já recebe via `covenant.virtualProcesses[].documents`) — o bloco reflete tudo que pertence ao processo, independentemente de onde foi anexado (História 2, cenário 4)
- [ ] [Frontend] T012 No fluxo de anexar, adicionar o Select "Vincular a qual Processo?", **renderizado apenas quando o convênio tiver processos vinculados** (FR-011), com a opção de não vincular. Cada opção usa a mesma identificação do cabeçalho dos blocos, para que escolha e resultado combinem
- [ ] [Frontend] T013 Verificar manualmente: convênio com 2 processos e documentos em ambos + alguns sem vínculo exibe os blocos corretos; convênio **sem** processos não mostra o Select; anexar sem escolher processo cai em "Gerais"

**Checkpoint**: Histórias 1 e 2 verificadas.

---

## Fase 4: Frontend — Processos Virtuais

**Depends on**: Fase 2. Independente da Fase 3.

- [ ] [Frontend] T014 Na aba Documentos do processo (`ProcessosVirtuais.tsx`), exibir a lista unificada: documentos anexados diretamente no processo **e** os vindos do convênio atribuídos a ele (FR-012)
- [ ] [Frontend] T015 Indicar visualmente a procedência de cada item (ex: selo "Do convênio") e **não** oferecer exclusão para os que vieram do convênio — a gestão desses arquivos permanece na tela de origem, onde valem as regras de exclusão da Biblioteca (Decisão 6 do plano)
- [ ] [Frontend] T016 Garantir que o download de um documento vindo do convênio use o endpoint da Biblioteca, preservando a checagem de nível de sigilo que já existe lá — sem criar um segundo caminho de download (Decisão 4 do plano)
- [ ] [Frontend] T017 Verificar manualmente: anexar pelo convênio indicando um processo, abrir aquele processo e confirmar que o arquivo aparece, com selo de origem, e que o download funciona; confirmar que **existe um único arquivo armazenado** (SC-001)

**Checkpoint**: História 3 verificada.

---

## Fase 5: Polish

- [ ] [Backend] T018 [P] `npm run type-check` em `SIMP-BACKEND`, sem erros novos
- [ ] [Frontend] T019 [P] `npm run type-check` e `npm run lint` em `SIMP-FRONTEND`, sem erros novos
- [ ] [Backend] T020 Atualizar `docs/AppFeatures.md` (§4.4 Processos Virtuais e §4.7 Convênios): o compartilhamento de documentos, a coluna `virtualProcessId`, a regra de que exclusão permanece na tela de origem e o `onDelete: SetNull` protegendo o acervo

---

## Dependencies & Execution Order

- **Fase 1 → Fase 2** em sequência (schema antes da API).
- **Fases 3 e 4 dependem da Fase 2** e são **independentes entre si** (tela de convênio vs. tela de processo) — podem ir em paralelo.
- **Fase 5** depende de todas.

Dentro das fases: T004 → T005 (validação depende da leitura do campo); T006 → T007; T010 → T011 → T012.

---

## Notes

- **Total**: 20 tarefas — **3 Banco**, **6 Backend**, **9 Frontend**, **2 polish/documentação**.
- **Escopo menor do que o pedido sugeria**, porque a fundação já existe:
  - **A relação N:N já está pronta e funcional** (`_CovenantToVirtualProcess` confirmada no banco). Não há migration de relacionamento a criar — o pedido pedia para "verificar e criar se não existir"; existe.
  - **A aba Documentos do convênio já mescla** documentos do convênio e dos processos vinculados — o que falta é o agrupamento e a atribuição por processo, não a mescla em si.
  - **A única mudança de schema é uma coluna opcional** (`virtualProcessId` em `LibraryDocument`).
- **O ponto de desenho mais delicado é a Fase 2**: existem **dois modelos de documento com formatos diferentes** (`LibraryDocument` com `fileKey`/`accessLevel`/`title`; `VirtualProcessDocument` com `fileUrl`/`tag`/`description`, ids e endpoints de download distintos). Este épico os **normaliza na leitura** e mantém o armazenamento separado — unificá-los seria migração de dados com impacto em Biblioteca, Conselhos e Processos, desproporcional ao ganho.
- **Duas decisões conservadoras que valem confirmação**, ambas motivadas por documento de convênio ser acervo com valor legal:
  1. **`onDelete: SetNull`** — excluir um processo **não apaga** os documentos do convênio atribuídos a ele; eles voltam a ser "gerais". A alternativa (`Cascade`) destruiria acervo.
  2. **Exclusão permanece na tela de origem** — a aba do processo mostra os documentos do convênio como leitura + download, sem botão de excluir, para que ninguém apague acervo do convênio sem perceber (as regras de exclusão dos dois modelos também são diferentes: permissão `library:delete` vs. janela de 24h do processo).
- **Fora de escopo, registrado**: o caminho inverso (marcar, a partir do processo, que um arquivo pertence ao convênio) não foi pedido e não está incluído; e um mesmo documento pertencer a **vários** processos exigiria outra tabela pivô — o pedido descreve `virtualProcessId` opcional, ou seja, no máximo um processo por documento.
