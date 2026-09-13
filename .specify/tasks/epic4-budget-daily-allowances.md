---
description: "Task list for feature: Épico 4 — Departamentos, Motor Orçamentário (QDD) e Novo Fluxo de Diárias"
---

# Tasks: Departamentos, Motor Orçamentário e Novo Fluxo de Diárias

**Input**: `.specify/specs/epic4-budget-daily-allowances.md` e `.specify/plans/epic4-budget-daily-allowances.md`

**Tests**: testes unitários para regras de domínio (cálculo de atraso, unicidade de ficha, imutabilidade) e **testes de integração (E2E)** para cada PDF novo, no padrão já estabelecido — o ciclo "gerar → registrar hash → validar no portal" só é comprovável ponta a ponta. `npm run type-check`, `npm run lint`, `npm test` e `npm run test:e2e` como gates.

**Organização**: Fase 0 (dívida) → Banco → Backend → Frontend, por fase do escopo.

**Bloqueios ativos**: a Fase 5 não inicia sem resposta às Open Questions 1 e 3; a Fase 3 não inicia sem resposta à Open Question 2.

---

## Fase 0 — Quitar dívida (pré-requisito de tudo)

- [ ] [Backend] T001 Em `daily-allowance.service.ts`: remover o campo `'Emitido por'` com nome completo do corpo do PDF e passar `exporterName: anonymizeUserName(...)` para `createOfficialPdf`. O nome deixa de aparecer em texto plano e passa a sair ofuscado no rodapé universal
- [ ] [Backend] T002 Em `fleet-fueling.service.ts`: mesma correção no campo `'Registrado por'`
- [ ] [Frontend] T003 `CouncilDetailPage` passa a baixar o calendário de `GET /councils/:councilId/calendar/:year/pdf` (já existente) em vez de gerar localmente; remover `src/utils/councilCalendarPdf.ts`
- [ ] [Frontend] T004 Remover `jspdf`/`jspdf-autotable` do `package.json` **se** nenhum outro consumidor restar (`src/utils/export.ts` ainda usa — conferir antes de remover; se restar, manter e registrar como dívida)
- [ ] [Banco] T005 Inventariar departamentos com `organization_id IS NULL`. **Não adivinhar dono**: se houver, levar a lista ao cliente antes de prosseguir
- [ ] [Banco] T006 Backfill de `Department.organizationId` e, em seguida, torná-lo obrigatório no schema. Duas etapas separadas — preencher, depois restringir
- [ ] [Backend] T007 Teste E2E: emitir uma diária e um abastecimento; conferir que nenhum dos PDFs contém o nome completo do emissor e que ambos têm QR Code

**Gate da fase**: nenhum PDF do sistema exibe nome pessoal completo; todos têm rodapé universal.

---

## Fase 1 — Departamentos e cross-linking

### Banco

- [ ] [Banco] T008 `Department`: adicionar `cnpj` (String?) e `chiefName` (String?, Ordenador de Despesa). Documentar no schema a distinção em relação a `managerId`
- [ ] [Banco] T009 Criar junção `CouncilDepartment` (N:N) com `organizationId`, `@@unique([councilId, departmentId])` e `onDelete: Cascade` nos dois lados
- [ ] [Banco] T010 Adicionar `departmentId` opcional em `Covenant` e `VirtualProcess`, ambos com `onDelete: SetNull` — excluir setor não apaga convênio nem processo

### Backend

- [ ] [Backend] T011 Estender o serviço de departamentos: CRUD dos campos novos e vínculo/desvínculo de conselhos, sempre no escopo de organização do token
- [ ] [Backend] T012 `GET /departments/:id/links` devolvendo conselhos, convênios e processos vinculados, com isolamento multi-tenant
- [ ] [Backend] T013 `department-dossier.service.ts`: monta o Dossiê via `createTabularReportPdf`, com blocos opcionais (servidores, CNPJ, conselhos, QDD) e registro em `ExportedDocument`. O PDF **declara quais blocos foram incluídos** — dossiê parcial que não se identifica como parcial induz a erro
- [ ] [Backend] T014 Teste E2E do Dossiê: gera PDF, registra hash, valida no portal, e respeita a seleção de blocos

### Frontend

- [ ] [Frontend] T015 Aba de detalhes do Departamento com as listas de vínculos, cada item navegável
- [ ] [Frontend] T016 Modais de criação de Convênio e de Processo passam a listar departamentos do banco (nunca lista fixa)
- [ ] [Frontend] T017 Modal do Dossiê com checkboxes dos blocos e download via cliente autenticado (`responseType: 'blob'`)

---

## Fase 2 — Motor orçamentário

### Banco

- [ ] [Banco] T018 `BudgetLaw`: `departmentId`, `type` (enum LOA/PPA/LDO), `year`, `details`, `organizationId`
- [ ] [Banco] T019 `QddItem`: `departmentId`, `year`, `ficha`, `fonte`, `projetoAtividade`, `naturezaDespesa`, `valorOrcado` `Decimal(15,2)`, `organizationId`, com `@@unique([departmentId, year, ficha])`

### Backend

- [ ] [Backend] T020 `budget.service.ts` com `BudgetError` (código por domínio, Princípio VIII): CRUD de leis e fichas, escopo por token
- [ ] [Backend] T021 Recusar exclusão de `QddItem` referenciado por qualquer diária, com mensagem explicando o motivo (FR-011)
- [ ] [Backend] T022 Testes unitários: unicidade da ficha, recusa de exclusão referenciada, isolamento multi-tenant

### Frontend

- [ ] [Frontend] T023 Aba "Orçamento & QDD" com tabela de edição ágil — adicionar ficha sem sair da tela
- [ ] [Frontend] T024 Exibir valores em pt-BR (`Intl.NumberFormat`), nunca formatação manual

---

## Fase 3 — Novo fluxo de diárias *(bloqueada pela Open Question 2)*

### Banco

- [ ] [Banco] T025 `DailyAllowance`: `departmentId` **obrigatório**, `qddItemId` opcional com `onDelete: Restrict`, `status` enum (`PENDING`, `ISSUED`, `ACCOUNTED`) com default `PENDING`
- [ ] [Banco] T026 Campos de cópia textual da dotação (ficha, fonte, natureza) preenchidos na emissão — mesma lógica de `beneficiaryName` (FR-018)

### Backend

- [ ] [Backend] T027 Exigir `departmentId` na criação, recusando no **servidor** e não apenas na tela
- [ ] [Backend] T028 `issue()` passa a: gravar a cópia textual da dotação, mover `status` para `ISSUED` e manter a imutabilidade existente — tudo em `$transaction` (FR-030)
- [ ] [Backend] T029 Aplicar a regra de estouro de dotação conforme a resposta à Open Question 2
- [ ] [Backend] T030 Testes: `departmentId` obrigatório, cópia gravada só na emissão, imutabilidade preservada, transação atômica

### Frontend

- [ ] [Frontend] T031 Solicitação em 3 passos: Departamento (auto-preenche CNPJ e Ordenador) → Beneficiário (combobox existente) → Rubrica do QDD
- [ ] [Frontend] T032 Departamento sem ficha cadastrada exibe orientação de onde cadastrar, não uma lista vazia (Acceptance Scenario 1.3)

---

## Fase 4 — Prestação de contas

### Banco

- [ ] [Banco] T033 `DailyAllowance`: `accountabilityDate` (DateTime?) e `activityReport` (Text?)

### Backend

- [ ] [Backend] T034 `accountFor()`: exige `status = ISSUED`, grava data e relatório, move para `ACCOUNTED`. Recusa se não emitida (FR-023)
- [ ] [Backend] T035 Cálculo de atraso **no servidor** (`ISSUED` + sem `accountabilityDate` + hoje > `returnDate` + 5 dias), exposto na listagem e no painel (FR-020, FR-021)
- [ ] [Backend] T036 Anexo I (solicitação) e Anexo II (prestação, com instrução sobre comprovantes) via motor universal, cada um com seu `publicId` e seu hash. **Anexo I não é reemitido** ao prestar contas
- [ ] [Backend] T037 Testes unitários do cálculo de atraso, incluindo as bordas: exatamente 5 dias, 5 dias e 1 minuto, e diária já prestada
- [ ] [Backend] T038 Teste E2E dos dois anexos: ambos validáveis no portal, com rótulos distintos

### Frontend

- [ ] [Frontend] T039 Alerta visual no dashboard para diárias atrasadas, consumindo o cálculo do servidor
- [ ] [Frontend] T040 Modal "Prestar Contas" com os dados da diária **somente leitura** e apenas data e relatório editáveis (FR-022)
- [ ] [Frontend] T041 Dois botões de download (Anexo I e Anexo II), com o Anexo II indisponível antes da prestação

---

## Fase 5 — Filtros e relatório *(bloqueada pelas Open Questions 1 e 3)*

- [ ] [Backend] T042 Filtros na listagem: nome, CPF, período, destino, situação e departamento — todos no servidor, dentro do escopo do token (FR-027)
- [ ] [Backend] T043 Relatório consolidado via `createTabularReportPdf`, consumindo os mesmos filtros e declarando-os no cabeçalho (FR-026)
- [ ] [Backend] T044 Teste E2E: listagem e relatório com os mesmos filtros cobrem o mesmo conjunto (SC-006)
- [ ] [Frontend] T045 Barra de filtros na listagem de Diárias, com o estado refletido na URL para que um filtro possa ser compartilhado
- [ ] [Frontend] T046 Botão de exportação consumindo os filtros ativos da tela

---

## Notas de escopo

- **Não reverter** `beneficiaryName` como texto — decisão herdada e testada.
- **Não criar** nenhum gerador de PDF fora de `document-pdf.service.ts` (Princípio VIII).
- A Fase 0 não é opcional nem paralelizável: ela fecha duas violações constitucionais que as demais fases herdariam.
