---
description: "Implementation plan for feature: Épico 8 — Motor Orçamentário, Prestação de Contas e Controle Financeiro"
---

# Implementation Plan: Motor Orçamentário, Prestação de Contas e Controle Financeiro

**Input**: `.specify/specs/epic8-budget-accountability.md`

## Summary

O épico se apoia em dois épicos já implementados (Épico 3 — alertas de vencimento; Épico 4 — QDD e novo fluxo de diárias), não os substitui. O trabalho novo se divide em quatro frentes relativamente independentes entre si (prestação de contas/cartilha, cálculo de saldo do QDD, contas bancárias, ciclo da despesa/alertas), mas todas dependem do mesmo passo inicial: o schema. Por isso o faseamento pedido — **Banco → Backend → Frontend** — é seguido à risca como estrutura de topo, com cada frente aparecendo como subseção dentro de cada fase, em vez de quatro mini-fases paralelas.

### Estado verificado

| Item | Estado | Evidência |
|---|---|---|
| Anexo I / Anexo II (diária) | ✅ prontos | `daily-allowance.service.ts`, campos `accountability*` em `DailyAllowance` |
| Motor universal de PDF + assinatura | ✅ pronto | `document-pdf.service.ts`, bloco de assinatura já usado no Calendário de Reuniões |
| `QddItem.valorOrcado`, unicidade por ficha | ✅ pronto | Épico 4 |
| `DailyAllowance.budgetOverrun` | ✅ pronto | Épico 4 — reaproveitado como padrão para `VirtualProcess` |
| Trava de prazo (`hoje >= returnDate`) na prestação de contas | ❌ ausente | `accountFor()` não verifica `returnDate` |
| `Valor Utilizado`/`Saldo Restante` do QDD | ❌ ausente, em qualquer forma | — |
| `VirtualProcess.qddItemId` | ❌ ausente | só `DailyAllowance` consome QDD hoje |
| `BankAccount.departmentId` | ❌ ausente | modelo só tem `organizationId` |
| Bloqueio server-side de `initialBalanceCents` | ❌ ausente | API aceita qualquer valor enviado |
| `Holiday`, justificativa de fim de semana | ❌ ausentes | — |
| Alerta ativo de vencimento de convênio | ❌ ausente | Épico 3 cobre só sinal visual sobre outro campo |
| `node-cron` já em uso, com jobs em `src/jobs/*.job.ts` | ✅ pronto | `expire-tasks.job.ts`, `clear-notifications.job.ts` — novo job segue o mesmo padrão |
| `Notification` (modelo genérico) | ✅ pronto | usado por `notificationService`, sem necessidade de campo novo |

### Por que Banco vem inteiro antes de Backend

Duas das quatro frentes (QDD e Contas Bancárias) têm uma migration com risco de dado órfão — a mesma classe de problema já enfrentada no Épico 4 com `Department.organizationId`:

- `BankAccount.departmentId` obrigatório exige decidir o que fazer com contas já cadastradas sem departamento **antes** de qualquer tela ou endpoint depender do campo.
- `DailyAllowance.sequenceNumber`/`year`/`formattedNumber` exige decidir a numeração de registros já existentes (não numerados) antes que a busca por "Número da Diária" passe a ser uma funcionalidade real, e não uma busca com buracos.

Resolver isso na Fase de Banco, com o schema ainda não consumido por nenhum endpoint novo, é mais barato do que descobrir o problema depois que a Fase de Frontend já assume que o campo sempre existe.

## Technical Context

**Backend**: Fastify 5, Prisma 6.19 + Postgres 16, Zod 3.25. Convenções já estabelecidas e mantidas: `Decimal(15,2)` para dinheiro, `@db.Uuid` em FK para `User`, `@map` snake_case, `publicId` separado da PK em documentos, snapshot textual de dado que entra em documento imutável.

**Migrations**: o projeto usa `prisma db push`. As alterações que exigem cuidado extra (não seguras por `db push` direto): `BankAccount.departmentId` obrigatório (precisa de backfill) e numeração retroativa de `DailyAllowance` (decisão de produto, não só técnica — ver Fase 1).

**Frontend**: React 19, TanStack Query 5, shadcn/ui, React Hook Form + Zod.

**PDFs**: `createOfficialPdf` para o Anexo II revisado (documento de registro único, já com bloco de assinatura reaproveitado do Calendário de Reuniões); nenhum motor novo.

**Jobs**: `node-cron`, seguindo o padrão de `src/jobs/expire-tasks.job.ts` (schedule configurável por env var, log estruturado, busca-antes-de-notificar para poder montar a lista de destinatários).

## Constitution Check

| Princípio | Situação no plano |
|---|---|
| III — Integridade do domínio municipal | ✅ histórico de suplementação (`BudgetHistory`) e imutabilidade das notas fiscais comprobatórias pós-hash são o núcleo deste épico |
| IV — Multi-tenant | ✅ todo modelo novo (`BudgetHistory`, `DailyAllowanceReceipt`, `Holiday`) nasce com `organizationId` obrigatório desde a criação — nenhuma repetição do erro histórico de `Department.organizationId` opcional |
| V — Spec-driven | ✅ este plano deriva da spec validada com o cliente, incluindo a cartilha oficial anexada |
| VII — Observabilidade e erros | ✅ novo `BudgetError`/extensão de `DailyAllowanceError`/`BankAccountError`; job de convênio loga com `logger.ts`, nunca `console.log` |
| VIII — PDF único, LGPD, transações | ✅ Anexo II revisado usa o motor universal; prestação de contas (dados + notas fiscais + hash + arquivo) em `$transaction` |

Nenhuma violação nova é introduzida.

## Project Structure

### Documentação (esta feature)

```text
SIMP-BACKEND/.specify/
├── specs/epic8-budget-accountability.md   # este épico, spec
├── plans/epic8-budget-accountability.md   # este arquivo
└── tasks/epic8-budget-accountability.md   # checklist granular
```

### Código (repositório)

```text
SIMP-BACKEND/
├── prisma/schema.prisma                        # DailyAllowance, DailyAllowanceReceipt (novo),
│                                                # QddItem, BudgetHistory (novo), VirtualProcess,
│                                                # BankAccount, Holiday (novo), enums novos
├── src/
│   ├── services/
│   │   ├── daily-allowance.service.ts          # trava de prazo, notas fiscais, justificativa
│   │   ├── budget.service.ts                   # NOVO — cálculo agregado QDD, BudgetHistory
│   │   ├── virtual-process.service.ts          # vínculo QDD, expensePhase
│   │   ├── bank-account.service.ts             # departmentId obrigatório, saldo bloqueado
│   │   └── holiday.service.ts                  # NOVO — CRUD de feriados, checagem de período
│   ├── jobs/
│   │   └── covenant-expiry-alert.job.ts        # NOVO
│   ├── controllers/ e routes/                  # espelham os serviços acima
│   └── schemas/                                # Zod: DTOs de cada endpoint novo/alterado
└── src/tests/                                   # E2E por funcionalidade, seguindo o padrão existente

SIMP-FRONTEND/
├── src/pages/daily-allowances/                 # busca unificada, alerta de fim de semana/feriado
├── src/pages/departments/qdd/                  # colunas Utilizado/Saldo, histórico de suplementação
├── src/pages/financeiro/Contas.tsx             # Select de departamento, saldo bloqueado + tooltip
├── src/pages/processos-virtuais/               # seletor de fase da despesa, seletor de ficha QDD
└── src/pages/configuracoes/feriados/           # NOVO — cadastro de feriados
```

**Structure Decision**: nenhuma pasta nova de alto nível — cada frente entra nos módulos que já existem para o domínio equivalente (diárias, QDD, financeiro, processos), com exceção de `holiday.service.ts` e o job de convênio, que são conceitos novos.

## Fases

### Fase 0 — Levantamento pré-migration (pré-requisito, não paralelizável)

1. Consultar `bank_accounts` por registros sem nenhuma associação óbvia a um departamento (nenhum vínculo hoje existe — o levantamento é simplesmente a lista completa de contas ativas). Levar ao cliente para atribuição manual **antes** de tornar `departmentId` obrigatório.
2. Decidir com o cliente a numeração retroativa: diárias já existentes recebem `sequenceNumber` best-effort (ordenadas por `createdAt`, dentro do ano de `departureDate`) ou ficam permanentemente sem número. Documentado aqui como recomendação: numerar retroativamente, para que a busca por número funcione para o acervo inteiro — mas é decisão do cliente, não técnica.

**Gate da fase**: as duas perguntas acima têm resposta registrada antes de qualquer alteração de schema ser aplicada.

---

### Fase 1 — Banco de Dados

**Prestação de contas**
- `DailyAllowance`: `sequenceNumber Int?`, `year Int`, `formattedNumber String?`, `beneficiaryRgIssuer String?`, `weekendHolidayJustification String? @db.Text`, `accountabilityTicketNumber String?`, `accountabilityEventAddress String? @db.Text`, `accountabilityContactsInfo String? @db.Text`.
- `@@unique([organizationId, year, sequenceNumber])` em `DailyAllowance`.
- Novo modelo `DailyAllowanceReceipt` (nota fiscal comprobatória), FK `Cascade` para `DailyAllowance`, índice por `dailyAllowanceId`.
- Backfill: atribuir `sequenceNumber`/`year`/`formattedNumber` aos registros existentes conforme decisão da Fase 0, **depois** disso tornar as colunas não nulas se a decisão for numerar tudo (caso contrário, permanecem opcionais e a busca por número simplesmente não encontra registros antigos sem número).

**Motor orçamentário**
- Nenhum campo novo em `QddItem` (decisão: cálculo on-read).
- Novo modelo `BudgetHistory` (`previousValue`, `newValue`, `changePercent` — `Decimal?`, nulo quando `previousValue = 0`, para não gravar um percentual sem sentido —, `reason` obrigatório, `changedById`, `createdAt`), FK `Cascade` para `QddItem` e `Organization`.
- `VirtualProcess`: `qddItemId String? @map("qdd_item_id")` com `onDelete: Restrict`, `qddFichaSnapshot`/`qddFonteSnapshot`/`qddNaturezaSnapshot` (`String?`), `budgetOverrun Boolean @default(false)`.
- Novo enum `ExpensePhase { EMPENHO LIQUIDACAO PAGAMENTO }`; `VirtualProcess.expensePhase ExpensePhase?` — campo aditivo, `status` textual não é tocado.

**Contas bancárias**
- `BankAccount.departmentId String?` (fase 1a — nullable, para permitir o backfill), relação `Restrict` para `Department`.
- Fase 1b, após o backfill da Fase 0 estar aplicado: tornar `departmentId` `NOT NULL`. Duas etapas separadas, como já feito para `Department.organizationId` no Épico 4 — nunca migrar direto para obrigatório sem o backfill confirmado.

**Ciclo da despesa e alertas**
- Novo modelo `Holiday` (`date @db.Date`, `name`, `scope HolidayScope`), `@@unique([organizationId, date])`.
- Novo enum `HolidayScope { NATIONAL STATE MUNICIPAL }`.
- Nenhuma alteração de schema para o alerta de convênio — reaproveita `Covenant.validityEndDate` (já existe) e `Notification` (já existe).

**Ponto de atenção**: `BudgetHistory.changePercent` é o único campo calculado que este épico persiste — e é aceitável porque uma entrada de histórico, ao contrário de `QddItem.valorUtilizado`, nunca é recalculada nem editada depois de escrita. Não é uma exceção à decisão da Fase de investigação (Achado A da spec), é uma categoria diferente de dado (fato histórico imutável vs. saldo vivo).

**Gate da fase**: `npx prisma db push` aplicado sem erro; backfill de `BankAccount.departmentId` e numeração de `DailyAllowance` confirmados com o cliente; nenhuma coluna nova viola o Princípio IV (todo modelo novo nasce com `organizationId`).

---

### Fase 2 — Backend

**Prestação de contas**
- `daily-allowance.service.ts`: `accountFor()` ganha a checagem `now() >= returnDate`, lançando `DailyAllowanceError('TOO_EARLY', ...)` quando violada.
- Numeração: atribuída na criação do rascunho (`create()`), reaproveitando a lógica de contador por (organização, ano) já usada em `official-document.service.ts` — não reinventar um contador novo.
- `accountFor()` passa a aceitar `beneficiaryRgIssuer` (se ainda não capturado no rascunho), `accountabilityTicketNumber`, `accountabilityEventAddress`, `accountabilityContactsInfo` e um array de notas fiscais; tudo gravado na mesma `$transaction` que grava o hash do Anexo II.
- Anexo II (`createOfficialPdf`) revisado para reproduzir a cartilha: cabeçalho (órgão concedente + data de prestação), identificação do beneficiário (incluindo Órgão Emissor do RG), período da viagem, tabela de notas fiscais, informações complementares, relatório de atividades, e as linhas de assinatura (beneficiário; setor responsável; Ordenador de Despesas, pré-preenchido com `Department.chiefName`) — sem captura de assinatura digital (ver Assumption da spec).
- Listagem: `search` textual (ilike sobre `beneficiaryName`, `beneficiaryCpf`, `formattedNumber`), somado — não substituindo — aos filtros de status/departamento/período já existentes.

**Motor orçamentário**
- `budget.service.ts` (novo): função `getQddItemBalance(qddItemId)` que agrega `SUM(totalAmount)` de `DailyAllowance` (`status IN (ISSUED, ACCOUNTED)`) e `SUM(totalValue)` de `VirtualProcess` vinculados, retornando `valorUtilizado` e `saldoRestante` (nunca gravados). Usada tanto na listagem da tela QDD quanto em qualquer relatório futuro que precise do mesmo número — um único ponto de cálculo, para não haver dois lugares que somam diferente.
- Atualização de `valorOrcado`: exige `reason` no payload; grava `BudgetHistory` e atualiza `QddItem` na mesma `$transaction`; `changePercent = (newValue - previousValue) / previousValue * 100`, nulo se `previousValue = 0`.
- `virtual-process.service.ts`: ao criar/editar um processo com `qddItemId`, grava os snapshots textuais e `budgetOverrun` (mesmo cálculo usado em `daily-allowance.service.ts` — extrair para um helper compartilhado em vez de duplicar a lógica de comparação com o saldo).

**Contas bancárias**
- `bank-account.service.ts`: schema Zod de criação/atualização deixa de aceitar `initialBalanceCents` como campo de entrada (removido do DTO, não apenas ignorado silenciosamente — um campo que o cliente não pode nem tentar enviar é mais seguro que um campo aceito e descartado). `departmentId` passa a obrigatório no DTO.
- Exclusão de departamento: query de verificação de `BankAccount` vinculada, mesmo padrão já usado para outras dependências de `Department`.

**Ciclo da despesa e alertas**
- `holiday.service.ts` (novo): CRUD simples de feriados por organização; função `getHolidaysInRange(organizationId, start, end)` reaproveitada pela checagem de diária.
- `daily-allowance.service.ts`: antes de emitir (`issue()`), calcular se `[departureDate, returnDate]` toca sábado, domingo ou uma linha de `Holiday`; se sim e `weekendHolidayJustification` estiver vazio, recusar com `DailyAllowanceError('WEEKEND_JUSTIFICATION_REQUIRED', ...)`.
- `virtual-process.service.ts`: aceitar e persistir `expensePhase` nas rotas de criação/atualização já existentes — sem rota nova.
- `covenant-expiry-alert.job.ts` (novo, `node-cron`, schedule diário configurável por env var): busca convênios com `validityEndDate` a exatamente 60 ou 30 dias; para cada um, verifica se já existe `Notification` com `entityId = covenant.id` e `type` correspondente antes de criar; destinatários: gestor do departamento vinculado (se houver) + usuários com permissão de escrita em convênios na organização (reaproveitar a query de RBAC já usada para notificar responsáveis em `expire-tasks.job.ts`).

**Gate da fase**: testes unitários dos serviços de domínio (cálculo de saldo, cálculo de estouro, checagem de fim de semana/feriado, dedupe de notificação) e testes E2E do Anexo II revisado e da trava de prazo — mesmo padrão de cobertura já usado nos épicos anteriores. `npm run type-check`, `npm run lint`, `npm test`, `npm run test:e2e`.

---

### Fase 3 — Frontend

**Prestação de contas**
- Botão "Emitir Prestação de Contas" desabilitado com tooltip explicativo enquanto `hoje < returnDate` (o servidor já recusa; a UI só evita o clique inútil).
- Formulário de prestação de contas ganha os campos novos da cartilha, incluindo uma sub-lista editável de notas fiscais (adicionar/remover linha, mesmo padrão de UX já usado em `QddRow.tsx` para edição ágil em tabela).
- Listagem de diárias ganha campo de busca única, ao lado dos filtros de status/departamento/período já existentes.

**Motor orçamentário**
- `QddTab`/`QddRow`: duas colunas novas, somente leitura ("Valor Utilizado", "Saldo Restante"), esta última com destaque visual (texto/fundo vermelho) quando negativa.
- Edição de `valorOrcado` passa a abrir um campo de motivo obrigatório antes de salvar (não é mais só o input numérico da linha).
- Nova seção/aba de histórico de suplementação por ficha (lista cronológica: data, autor, valor anterior → novo, percentual, motivo).

**Contas bancárias**
- `Contas.tsx`: `Select` de departamento obrigatório no formulário; campo "Saldo Inicial" com `disabled` e `Tooltip` (shadcn/ui) explicando a integração futura.

**Ciclo da despesa e alertas**
- Tela de processos virtuais: seletor de fase da despesa (Empenho/Liquidação/Pagamento) e seletor de ficha do QDD, replicando o padrão de `QddItemSelect.tsx` já usado nas diárias.
- Formulário de diária: alerta visual quando o período tocar fim de semana/feriado, com campo de justificativa que aparece condicionalmente.
- Nova tela simples de cadastro de feriados (`src/pages/configuracoes/feriados/`), CRUD básico por organização.
- Notificação de vencimento de convênio aparece no sino de notificações já existente — sem tela nova, reaproveitando o componente de notificação atual.

**Gate da fase**: `npm run type-check`, `npm run lint`, `npm run build` no frontend; validação manual de cada tela contra os cenários de aceitação da spec.

---

### Fase 4 — Testes e fechamento

- Testes E2E cobrindo, no mínimo: trava de prazo da prestação de contas (aceitar e recusar), cálculo de saldo do QDD com diária + processo vinculados, edição de valor orçado sem motivo (recusa) e com motivo (histórico gravado), criação de conta bancária sem departamento (recusa) e com `initialBalanceCents` forjado no payload (ignorado), emissão de diária em fim de semana sem justificativa (recusa) e com justificativa (aceita), execução do job de convênio duas vezes seguidas (sem duplicar notificação).
- Checklist de regressão dos épicos 3 e 4: confirmar que o alerta visual de vencimento de processo e a emissão normal de diária/Anexo I continuam funcionando sem alteração de comportamento.

## Complexity Tracking

Nenhuma violação da constituição é introduzida por este plano — tabela de complexidade não se aplica.
