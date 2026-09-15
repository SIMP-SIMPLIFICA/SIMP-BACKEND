---
description: "Task list for feature: Épico 8 — Motor Orçamentário, Prestação de Contas e Controle Financeiro"
---

# Tasks: Motor Orçamentário, Prestação de Contas e Controle Financeiro

**Input**: `.specify/specs/epic8-budget-accountability.md` e `.specify/plans/epic8-budget-accountability.md`

**Tests**: testes unitários para regras de domínio (cálculo de saldo do QDD, cálculo de estouro, checagem de fim de semana/feriado, dedupe de notificação) e testes de integração (E2E) para o Anexo II revisado e para a trava de prazo — o ciclo "gerar → registrar hash → validar no portal" só é comprovável ponta a ponta, no mesmo padrão já estabelecido nos épicos anteriores. `npm run type-check`, `npm run lint`, `npm test` e `npm run test:e2e` como gates.

**Organização**: Fase 0 (levantamento) → Banco → Backend → Frontend → Testes e fechamento, conforme `.specify/plans/epic8-budget-accountability.md`.

**Bloqueios ativos**: a Fase 2 (Backend) da prestação de contas não inicia sem confirmação do layout final do Anexo II revisado com você (a cartilha já define os campos; falta validar a diagramação produzida).

---

## Fase 0 — Levantamento pré-migration

**Decisão registrada em 2026-09-14**: as tabelas `bank_accounts` e `daily_allowances` do ambiente de desenvolvimento serão limpas antes da migration, em vez de passar por backfill. `BankAccount.departmentId` e a numeração de `DailyAllowance` (`sequenceNumber`/`year`/`formattedNumber`) entraram no schema já como `NOT NULL`, sem etapa intermediária nullable.

- [x] [Banco] T001 ~~Consultar `bank_accounts` órfãs~~ — não aplicável, tabela será limpa antes da migration
- [x] [Banco] T002 ~~Decidir numeração retroativa de `DailyAllowance`~~ — não aplicável, tabela será limpa antes da migration

**Gate da fase**: decisão registrada — seguir direto para a Fase 1 com os campos já obrigatórios.

---

## Fase 1 — Banco de Dados

### Prestação de contas

- [x] [Banco] T003 `DailyAllowance`: adicionar `sequenceNumber Int`, `year Int`, `formattedNumber String` (obrigatórios — tabela será limpa, sem necessidade de staging nullable), com `@@unique([organizationId, year, sequenceNumber])`
- [x] [Banco] T004 `DailyAllowance`: adicionar `beneficiaryRgIssuer String?`, `weekendHolidayJustification String? @db.Text`, `accountabilityTicketNumber String?`, `accountabilityEventAddress String? @db.Text`, `accountabilityContactsInfo String? @db.Text`
- [x] [Banco] T005 Criar modelo `DailyAllowanceReceipt` (id, dailyAllowanceId, receiptNumber, payeeName, issuedAt, amount `Decimal(15,2)`, createdAt), FK `Cascade` para `DailyAllowance`, índice por `dailyAllowanceId`
- [x] [Banco] T006 ~~Script de backfill de numeração~~ — não aplicável (ver Fase 0)

### Motor orçamentário

- [x] [Banco] T007 Criar modelo `BudgetHistory` (id, organizationId, qddItemId, previousValue, newValue `Decimal(15,2)`, changePercent `Decimal?`, reason `String @db.Text`, changedById, createdAt), FK `Cascade` para `QddItem` e `Organization`, índice por `(organizationId, qddItemId)`
- [x] [Banco] T008 `VirtualProcess`: adicionar `qddItemId String? @map("qdd_item_id")` com relação `onDelete: Restrict` para `QddItem`
- [x] [Banco] T009 `VirtualProcess`: adicionar `qddFichaSnapshot`, `qddFonteSnapshot`, `qddNaturezaSnapshot` (`String?`) e `budgetOverrun Boolean @default(false)`
- [x] [Banco] T010 Criar enum `ExpensePhase { EMPENHO LIQUIDACAO PAGAMENTO }` e adicionar `VirtualProcess.expensePhase ExpensePhase?`
- [x] [Banco] T011 `QddItem`: adicionar relações reversas `virtualProcesses VirtualProcess[]` e `history BudgetHistory[]`

### Contas bancárias

- [x] [Banco] T012 `BankAccount`: adicionar `departmentId String` **obrigatório desde já** (sem etapa nullable — ver Fase 0) com relação `onDelete: Restrict` para `Department`
- [x] [Banco] T013 ~~Backfill de `BankAccount.departmentId`~~ — não aplicável (ver Fase 0)
- [x] [Banco] T014 ~~Tornar `NOT NULL` após backfill~~ — já aplicado direto em T012

### Ciclo da despesa e alertas

- [x] [Banco] T015 Criar enum `HolidayScope { NATIONAL STATE MUNICIPAL }`
- [x] [Banco] T016 Criar modelo `Holiday` (id, organizationId, date `@db.Date`, name, scope, createdAt), `@@unique([organizationId, date])`, índice por `(organizationId, date)`

**Gate da fase**: `npx prisma validate` e `npx prisma format` já passaram limpos. Falta rodar `npm run db:push` no ambiente de desenvolvimento (após limpar `bank_accounts` e `daily_allowances`) para fechar o gate por completo — **aguardando sua confirmação**.

---

## Fase 2 — Backend

### Prestação de contas

- [x] [Backend] T017 `daily-allowance.service.ts`: numeração (`sequenceNumber`/`formattedNumber`) atribuída em `create()`. **Desvio da tarefa original**: não existe `official-document.service.ts` — a numeração de `OfficialDocument` vive inline em `protocol.controller.ts` e é acoplada a `OfficialDocumentCategory` (não reaproveitável). Implementado como `MAX(sequenceNumber)+1` por (organização, ano) dentro de uma transação `Serializable` (retry extraído para `utils/serializable-retry.util.ts`) — mesma garantia de concorrência, sem depender de `SequenceControl`
- [x] [Backend] T018 `accountFor()` recusa quando `hoje < returnDate` (comparação por dia de calendário UTC), com novo código `DailyAllowanceError('TOO_EARLY', ...)`
- [x] [Backend] T019 `accountFor()` aceita `ticketNumber`, `eventAddress`, `contactsInfo` e um array `receipts` (notas fiscais); `beneficiaryRgIssuer` entra em `create`/`update` (é campo do rascunho, como `beneficiaryRg`)
- [x] [Backend] T020 Notas fiscais gravadas via `tx.dailyAllowanceReceipt.createMany` na mesma `$transaction` do hash; não existe endpoint de edição/exclusão de nota fiscal — a imutabilidade pós-hash vem de não haver caminho de escrita, não de uma trava extra
- [x] [Backend] T021 Anexo II **trocou de motor**: de `createOfficialPdf` (seções em prosa) para `createFormDocumentPdf` (grade com bordas, o mesmo do Anexo I) — a cartilha anexada é fisicamente um formulário de células, não uma lista de campos. Todos os campos da cartilha mapeados; Ordenador de Despesas via `resolveChiefName(department.manager)` (achado da implementação: `Department.chiefName` foi removido do domínio antes deste épico — o util já deriva do gestor real, documentado no próprio código)
- [x] [Backend] T022 `search` (nome/CPF exato de 11 dígitos/`formattedNumber`) na listagem e no relatório, combinável com os filtros existentes. **Ajuste de segurança**: CPF no `search` casa só por igualdade exata de 11 dígitos, nunca `contains` parcial — o mesmo raciocínio anti-oráculo já documentado no filtro `cpf` existente
- [x] [Backend] T023 Verificado via suíte de unidade (`daily-allowance.service.spec.ts`, atualizada e passando) cobrindo a trava de prazo, numeração e o novo motor do Anexo II. Teste E2E dedicado (servidor real + Postgres) fica para a Fase 4, junto dos demais T057-T063

### Motor orçamentário

- [x] [Backend] T024 `budget.service.ts` (novo): `getQddItemBalance`/`getBalancesForItems` agregam `DailyAllowance` (`ISSUED`/`ACCOUNTED`) e `VirtualProcess` vinculados; `detectOverrun` faz o mesmo para a flag de estouro — um único ponto de cálculo para os dois consumidores de QDD
- [x] [Backend] T025 `qddItemService.list`/`getById` passam a incluir `valorUtilizado`/`saldoRestante` calculados em lote
- [x] [Backend] T026 `qddItemService.update`: `reason` obrigatório só quando `valorOrcado` muda de fato; `BudgetHistory` gravado na mesma `$transaction`; `changePercent` nulo quando o valor anterior é zero
- [x] [Backend] T027 `GET /qdd-items/:id/history`, mais recente primeiro
- [x] [Backend] T028 **Desvio da tarefa original**: não existe `virtual-process.service.ts` — a lógica de `VirtualProcess` vive em `virtual-process.controller.ts` (padrão mais antigo deste módulo). O vínculo com QDD (snapshot + `budgetOverrun`) foi implementado ali, em `createProcess` e no novo `PATCH /:id/budget` (`updateBudget`), reaproveitando `budgetService.detectOverrun` — nenhuma lógica de saldo duplicada
- [x] [Backend] T029 `qddItemService.remove` agora recusa também quando há `VirtualProcess` vinculado, além da diária emitida já coberta
- [x] [Backend] T030 Testes unitários cobertos pela suíte existente atualizada (saldo, estouro) mais o e2e de `qdd-item`/`daily-allowance-budget` corrigidos nesta rodada (ver nota abaixo)

**Achado de implementação (corrigido nesta rodada, fora do escopo original das tarefas)**: mover a checagem `assertQddItemBelongsToOrganization` para `budgetService` fez com que ela passasse a lançar `BudgetError` em vez de `DailyAllowanceError` — os controllers de Diárias e Processos não reconheciam essa classe e devolviam 500 em vez de 400 para uma dotação de outra organização. Corrigido com uma tradução explícita no ponto de chamada (`assertQddItemLinkable` em `daily-allowance.service.ts`) e um `catch` dedicado em `virtual-process.controller.ts`. Achado pelos testes E2E existentes, não por inspeção manual — reforça manter `test:e2e` no gate.

### Contas bancárias

- [x] [Backend] T031 `finance-bank-account.controller.ts`: `initialBalanceCents` removido do `createSchema`/`updateSchema` (`.strip()` descarta o campo em silêncio) — a API nunca grava valor vindo do cliente, só o `@default(0)` do schema
- [x] [Backend] T032 `departmentId` obrigatório no DTO de criação (e validado — `departmentExistsInOrganization`) e aceito opcionalmente na atualização, também validado
- [x] [Backend] T033 `department.controller.ts#remove`: nova checagem de `BankAccount` vinculada, mesmo padrão dos checks já existentes (membros, protocolos) — 409 com contagem na mensagem
- [x] [Backend] T034 Novo arquivo `src/tests/finance-bank-account.e2e.spec.ts`: recusa sem departamento, recusa departamento de outra organização, `initialBalanceCents` forjado é ignorado em create E update, exclusão de departamento com conta vinculada é recusada

**Achado transversal, fora do escopo pedido**: as rotas `/finance/accounts` (`finance.routes.ts`) não têm `requirePermission` nenhum — qualquer usuário autenticado da organização com o módulo `finance` habilitado pode criar/editar/excluir conta bancária. Não é regressão desta rodada (já era assim antes do Épico 8) e não mexi nisso; registro aqui porque apareceu durante a implementação e é uma lacuna real de Defense in Depth que vale uma rodada própria.

### Ciclo da despesa e alertas

- [x] [Backend] T035 `holiday.service.ts` (novo): CRUD (`list`/`create`/`remove`) + `getHolidaysInRange(organizationId, start, end)`, dedupe de data por `(organizationId, date)`
- [x] [Backend] T036 `holiday.routes.ts` (novo), registrado em `/holidays`, gated por `requireModule('dailyAllowances')` (único consumidor hoje) + `dailyAllowances:read`/`write`
- [x] [Backend] T037 `daily-allowance.service.ts`: nova função pura `touchesWeekendOrHoliday` (exportada, testável isolada) + checagem em `issue()` antes de gerar o PDF — recusa com `WEEKEND_JUSTIFICATION_REQUIRED` (409) quando o período toca sábado/domingo/feriado e `weekendHolidayJustification` está vazio
- [x] [Backend] T038 `expensePhase` aceito em `createVirtualProcessSchema` (criação) e em `updateBudgetSchema`, que ganhou `qddItemId` e `expensePhase` como campos INDEPENDENTES e opcionais (endpoint `/:id/budget` já existente, ampliado em vez de criar uma quinta rota estreita)
- [x] [Backend] T039 `covenant-expiry-alert.job.ts` (novo): corpo exportado como `runCovenantExpiryCheck` (testável sem cron), janelas de exatos 60/30 dias por dia de calendário UTC, dedupe via `Notification.findFirst({entityId, type})`, destinatários = gestor do departamento + `getUsersWithPermission(..., 'covenants:write')` (reuso de `rbac.service.ts`, nada novo inventado)
- [x] [Backend] T040 Registrado em `src/index.ts`, junto dos demais jobs
- [x] [Backend] T041 `covenant-expiry-alert.job.spec.ts` (8 testes: janelas de 60/30, fora da janela, sem `validityEndDate`, dedupe simples, dedupe rodando duas vezes, destinatários somados, sem destinatário) + 10 testes novos em `daily-allowance.service.spec.ts` (função pura + gate de emissão)
- [x] [Backend] T042 `src/tests/daily-allowance-weekend-holiday.e2e.spec.ts` (novo): dias úteis emite direto, fim de semana recusa e depois aceita após corrigir o rascunho, feriado municipal cadastrado via API também exige justificativa, feriado de OUTRA organização não vaza para esta, mais 2 testes de cadastro de feriado (data duplicada, exclusão)

**Bugs reais pegos pela suíte E2E completa (não pela minha revisão manual) — corrigidos nesta rodada**:
1. `document-validation.e2e.spec.ts` tinha outro `prisma.dailyAllowance.create()` cru (além do já corrigido em `qdd-item.e2e.spec.ts` na rodada anterior) sem a numeração agora obrigatória — 4 testes quebrados, corrigido.
2. Três arquivos e2e (`daily-allowance.e2e.spec.ts`, `daily-allowance-budget.e2e.spec.ts`, `daily-allowance-anexo1.e2e.spec.ts`) usam períodos de diária que cruzam fim de semana (datas fixas nos fixtures) — a nova trava do Épico 8 passou a recusar a emissão neles. Corrigido adicionando `weekendHolidayJustification` aos payloads compartilhados desses arquivos.

**Gate da fase — CONFIRMADO**: `npm run type-check` ✅ · `npm run lint` ✅ (0 erros, 309 warnings pré-existentes) · `npm test` ✅ (373/373) · `npm run test:e2e` ✅ (14/14 arquivos, 141/141 testes, suíte completa do projeto — não só os arquivos deste épico).

---

## Fase 3 — Frontend

### Prestação de contas

- [x] [Frontend] T043 Botão "Prestar Contas" (`DailyAllowanceList.tsx`) desabilitado com `title` explicativo enquanto `canAccountFor()` (novo helper em `lib/api/daily-allowances.ts`) é falso — mesma convenção de tooltip (atributo `title`, não um componente Tooltip novo) já usada no resto da tela
- [x] [Frontend] T044 **Achado**: não existia NENHUMA UI de prestação de contas no frontend (nem a versão do Épico 4) — API client não tinha `accountFor`. Criado do zero: `AccountabilityDialog.tsx` com todos os campos da cartilha (Órgão Emissor do RG entra no formulário principal, junto do RG — é campo do rascunho) e sub-lista de notas fiscais via `useFieldArray`, mesmo espírito de edição ágil do `QddRow.tsx`
- [x] [Frontend] T045 Barra de busca + filtros de Situação/Departamento/Período adicionados a `DailyAllowanceList.tsx` — **achado**: os filtros "já existentes" que a tarefa presumia não existiam no frontend (só no backend); implementados agora, fechando o item 1 original do pedido também nesse ponto
- [x] [Frontend] T046 `formattedNumber` exibido como coluna própria na listagem e no título do formulário/diálogo de prestação de contas

### Motor orçamentário

- [x] [Frontend] T047 `QddRow`/`QddTab`: colunas "Valor Utilizado" e "Saldo Restante" (somente leitura, também no rodapé de totais), saldo negativo em vermelho
- [x] [Frontend] T048 Campo "Motivo" aparece em `QddRow` só quando o valor digitado difere do valor orçado atual da ficha — validado antes de enviar, tanto no componente quanto (como já era) no servidor
- [x] [Frontend] T049 `BudgetHistoryDialog.tsx` (novo), acionado por um botão "Histórico" por linha do QDD — lista valor anterior → novo, variação percentual, motivo, autor e data, mais recente primeiro

### Contas bancárias

- [x] [Frontend] T050 `Contas.tsx`: `DepartmentSelect` obrigatório no formulário de criação/edição, com validação também no cliente antes de submeter
- [x] [Frontend] T051 `Contas.tsx`: campo "Saldo Inicial" trocado de input editável para `disabled`/`readOnly` mostrando o valor real da conta, com tooltip (`title`) explicando a futura integração bancária
- [x] [Frontend] **Achado fora do escopo original, corrigido nesta rodada**: existia uma SEGUNDA superfície de cadastro de conta bancária (`UniversalFinanceModal.tsx`, um modal de acesso rápido) com o mesmo campo de saldo editável e sem departamento — só apareceu porque o `npm run build` (`tsc -b`, diferente de `tsc --noEmit`) recusou compilar depois que os DTOs pararam de aceitar `initialBalanceCents`. Corrigida com o mesmo padrão de `Contas.tsx`. **Lição registrada**: `tsc --noEmit` não é suficiente como gate final neste projeto frontend — `npm run build` pega inconsistências que ele não pega.

### Ciclo da despesa e alertas

- [x] [Frontend] T052 `ProcessosVirtuais.tsx`: seletor de fase da despesa (Empenho/Liquidação/Pagamento) no diálogo "Prazo, valor e orçamento" (reaproveitado em vez de criar um quinto diálogo), exibido também no painel de detalhe
- [x] [Frontend] T053 Mesmo diálogo: seletor de ficha do QDD via `QddItemSelect` (reaproveitado de `daily-allowances/`), com snapshot e alerta de estouro exibidos no detalhe do processo
- [x] [Frontend] T054 `DailyAllowanceForm.tsx`: banner de alerta (`touchesWeekendOrHoliday`, novo util espelhando a função pura do backend) + `Textarea` de justificativa que só aparece quando o período toca sábado/domingo/feriado cadastrado
- [x] [Frontend] T055 **Desvio deliberado**: em vez de uma rota nova (`/configuracoes/feriados`) com entrada própria no menu, o cadastro de feriados virou `HolidaysDialog.tsx`, acionado por um botão "Feriados" no cabeçalho da tela de Diárias — mesmo padrão de escopo estreito já usado no projeto (QDD/Leis Orçamentárias como abas do setor, não rotas), e evita mexer em `router.tsx`/`Sidebar.tsx` para uma tela de manutenção pontual
- [x] [Frontend] T056 Confirmado sem mudança estrutural: `NotificationBell.tsx` já renderiza qualquer `type` de notificação (fallback genérico); adicionado só um ícone/cor dedicados para `COVENANT_EXPIRING_60`/`COVENANT_EXPIRING_30` (polimento, não obrigatório)

**Gate da fase — CONFIRMADO**: `npx tsc --noEmit` ✅ · `npm run lint` ✅ (0 erros, 13 warnings pré-existentes não relacionados) · `npm run build` ✅ (`tsc -b && vite build`, sucesso — foi este comando, não o `tsc --noEmit`, que pegou o `UniversalFinanceModal.tsx` esquecido). Sem suíte de testes de frontend estabelecida no projeto (`vitest run` não encontra arquivo algum) — nenhuma regressão a verificar por aí.

---

## Fase 4 — Testes e fechamento

- [ ] [QA] T057 E2E: trava de prazo da prestação de contas (aceitar e recusar)
- [ ] [QA] T058 E2E: cálculo de saldo do QDD com diária + processo vinculados, incluindo saldo negativo
- [ ] [QA] T059 E2E: edição de valor orçado sem motivo (recusa) e com motivo (histórico gravado e consultável)
- [ ] [QA] T060 E2E: criação de conta bancária sem departamento (recusa) e com `initialBalanceCents` forjado no payload (ignorado)
- [ ] [QA] T061 E2E: emissão de diária em fim de semana/feriado sem justificativa (recusa) e com justificativa (aceita)
- [ ] [QA] T062 E2E: execução do job de convênio duas vezes seguidas na mesma janela (sem duplicar notificação)
- [ ] [QA] T063 Checklist de regressão: alerta visual de vencimento de processo (Épico 3) e emissão normal de diária/Anexo I (Épico 4) continuam funcionando sem alteração de comportamento

**Gate final**: todos os testes acima verdes; `npm run type-check`, `npm run lint`, `npm test`, `npm run test:e2e` em ambos os repositórios.

---

## Dependências

- Fase 0 bloqueia Fase 1 (decisões de backfill/numeração).
- Fase 1 bloqueia Fase 2 (schema precisa existir antes de qualquer serviço usá-lo).
- Fase 2 bloqueia Fase 3 (frontend consome os endpoints).
- Dentro da Fase 2, as quatro frentes (prestação de contas, motor orçamentário, contas bancárias, ciclo da despesa) são independentes entre si e podem ser feitas em paralelo por desenvolvedores diferentes — nenhuma depende do código da outra, só do schema da Fase 1.
- T028 (snapshot/estouro em `VirtualProcess`) depende de T024 (helper de cálculo de saldo) existir para evitar duplicar a lógica de comparação.
- T039/T040 (job de convênio) não dependem de nenhuma outra frente deste épico — podem começar assim que a Fase 1 terminar.
