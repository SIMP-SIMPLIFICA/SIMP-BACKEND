---
description: "Implementation plan for feature: Épico 4 — Departamentos, Motor Orçamentário (QDD) e Novo Fluxo de Diárias"
---

# Implementation Plan: Departamentos, Motor Orçamentário e Novo Fluxo de Diárias

**Input**: `.specify/specs/epic4-budget-daily-allowances.md`

## Summary

O épico tem cinco fases, mas **a ordem importa mais que o conteúdo**: duas dívidas
existentes precisam ser fechadas antes, porque as fases seguintes as herdariam e
multiplicariam. O trabalho novo em si é convencional — modelos, relações, telas e
dois PDFs — e o motor universal já resolve a parte difícil da exportação.

### Estado verificado

| Item | Estado | Evidência |
|---|---|---|
| Motor universal de PDF | ✅ pronto | `applyUniversalValidationFooter`, `createTabularReportPdf`, `ExportedDocument` |
| Ofuscação LGPD | ✅ pronta | `lgpd-anonymizer.util.ts` (17 testes) |
| Autocomplete de beneficiário | ✅ pronto | `Beneficiary` + `BeneficiaryCombobox.tsx` |
| Retrofit do rodapé em Diárias/Frota | ❌ **pendente** | nome completo no corpo; `exporterName` não é passado |
| Calendário pelo motor | ❌ **pendente no frontend** | `CouncilDetailPage` ainda chama `councilCalendarPdf.ts` (jsPDF) |
| `Department.organizationId` | ⚠ **opcional** | `String?` — único modelo de domínio sem escopo obrigatório |
| `BudgetLaw` / `QddItem` | ❌ inexistentes | — |

### Por que o retrofit vem antes (Fase 0)

As Fases 3 e 4 criam **dois PDFs novos** (Anexo I e Anexo II) e a Fase 1 cria um
terceiro (Dossiê). Se o retrofit não vier primeiro, ou esses três nascem com o
mesmo defeito — nome em texto plano, sem `exporterName` no rodapé — ou nascem
certos ao lado de dois errados, e o sistema passa a ter duas convenções
conflitantes para a mesma coisa. O Princípio VIII exige **uma** fonte de verdade;
fechar a dívida antes custa menos que reconciliar cinco documentos depois.

### Por que endurecer `Department.organizationId` vem antes (Fase 0)

A Fase 1 liga `Council`, `Covenant`, `VirtualProcess` e — indiretamente — `QddItem`
e `DailyAllowance` a `Department`. Com `organizationId` opcional, um departamento
órfão vira **ponte entre prefeituras**: uma diária da Prefeitura A poderia apontar
para uma dotação de um setor sem dono, visível a partir da Prefeitura B. Tornar o
campo obrigatório depois de criadas cinco relações é uma migration de risco muito
maior que fazê-lo agora, com o modelo ainda pouco conectado.

## Technical Context

**Backend**: Fastify 5, Prisma 6.19 + Postgres 16, Zod 3.25. Convenção de escrita
de schema estabelecida: `Decimal(15,2)` para dinheiro, `@db.Uuid` em FK para
`User`, `@map` snake_case, `publicId` separado da PK em documentos.

**Migrations**: o projeto usa `prisma db push` (autorizado pelo cliente em épico
anterior). A única alteração deste épico que **não** é segura por `db push` é
tornar `Department.organizationId` obrigatório: exige backfill antes. Tratada como
tarefa própria, com verificação de registros órfãos antes de aplicar.

**Frontend**: React 19, TanStack Query 5, shadcn/ui, React Hook Form + Zod (já
adotados no épico anterior).

**PDFs**: `createTabularReportPdf` para listas (relatório consolidado, dossiê) e
`createOfficialPdf` para documento de registro único (Anexo I, Anexo II).

## Constitution Check

| Princípio | Situação no plano |
|---|---|
| I — Local-First | ✅ nenhuma dependência de nuvem nova |
| III — Integridade do domínio municipal | ✅ dotação e prestação de contas são registros auditáveis; imutabilidade após emissão preservada (FR-016) |
| IV — Multi-tenant | ⚠ **violação existente** em `Department.organizationId`; o plano a fecha na Fase 0 em vez de herdá-la |
| V — Spec-driven | ✅ este plano deriva de spec validada |
| VII — Observabilidade e erros | ✅ erros de domínio por módulo (`BudgetError`, `DailyAllowanceError` estendido); UI oferece abertura de ticket |
| VIII — PDF único, LGPD, transações | ⚠ **violação existente** no retrofit; fechada na Fase 0. Novos PDFs usam o motor; emissão em `$transaction` |

Nenhuma violação é levada adiante sem fechamento — as duas existentes viram a
Fase 0.

## Fases

### Fase 0 — Quitar dívida (pré-requisito, não paralelizável)

1. Retrofit do rodapé em `daily-allowance.service.ts` e `fleet-fueling.service.ts`:
   remover o nome completo do corpo, passar `exporterName` já ofuscado ao rodapé.
2. `CouncilDetailPage` passa a baixar o calendário do backend; remover
   `src/utils/councilCalendarPdf.ts` e as dependências jsPDF que ficarem órfãs.
3. Backfill e obrigatoriedade de `Department.organizationId`.

**Gate**: nenhum PDF do sistema exibe nome completo; todo PDF tem QR Code.

### Fase 1 — Departamentos e cross-linking

Campos novos, tabela de junção `CouncilDepartment`, `departmentId` em `Covenant` e
`VirtualProcess` com `SetNull`, aba de detalhes e Dossiê do Setor.
**Ponto de atenção**: o Dossiê tem blocos opcionais; a seleção vai no corpo da
requisição, e o PDF declara quais blocos foram incluídos — um dossiê parcial que
não diz que é parcial induz a erro de leitura.

### Fase 2 — Motor orçamentário

`BudgetLaw` e `QddItem` com unicidade `(departmentId, year, ficha)`. Aba
"Orçamento & QDD" com tabela de edição ágil (adicionar linha sem sair da tela).

### Fase 3 — Novo fluxo de diárias

`departmentId` obrigatório, `qddItemId` com `Restrict`, `status` enum. Solicitação
em três passos.
**Ponto de atenção**: a cópia textual dos dados orçamentários (FR-018) acontece na
**emissão**, não na criação do rascunho — antes de emitir, a ficha ainda pode ser
trocada, e congelar cedo demais gravaria dado de uma dotação abandonada.

### Fase 4 — Prestação de contas

`accountabilityDate`, `activityReport`, cálculo de atraso no servidor, modal
bloqueado, Anexo I e Anexo II.
**Ponto de atenção**: Anexo II é gerado **depois** da prestação, e o Anexo I
permanece válido — são dois documentos com dois `publicId` e dois hashes, não uma
substituição. Reemitir o Anexo I invalidaria o que já foi entregue.

### Fase 5 — Filtros e relatório consolidado

Filtros no servidor, dentro do escopo do token; relatório consumindo os mesmos
filtros via `createTabularReportPdf`.
**Bloqueado por**: Open Question 1 (XLS) e 3 (CPF).

## Riscos

| Risco | Mitigação |
|---|---|
| Backfill de `organizationId` encontrar departamentos órfãos reais | Inventariar antes; decidir com o cliente a qual organização pertencem, ou arquivá-los. Não adivinhar |
| `db push` em coluna que vira obrigatória | Aplicar em duas etapas: adicionar preenchido → tornar obrigatório |
| Estouro de dotação sem regra definida | Open Question 2 bloqueia a Fase 3; não implementar por suposição |
| Três PDFs novos divergirem do motor | FR-028 + revisão: qualquer `new PDFDocument` fora de `document-pdf.service.ts` reprova |

## Complexity Tracking

| Desvio | Por quê | Alternativa descartada |
|---|---|---|
| Cópia textual dos dados do QDD na diária (desnormalização) | Documento emitido não pode mudar quando o cadastro muda | Só a FK: quebraria o histórico ao editar a ficha |
| `chiefName` como texto ao lado de `managerId` | Ordenador de Despesa frequentemente não é usuário do sistema | Reusar `managerId`: confundiria papel operacional com autoridade jurídica |
