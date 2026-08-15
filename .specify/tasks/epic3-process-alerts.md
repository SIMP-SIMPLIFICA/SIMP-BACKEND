---
description: "Task list for feature: Épico 3 — Vencimentos e Alertas de Processos Virtuais"
---

# Tasks: Épico 3 — Vencimentos e Alertas de Processos Virtuais

**Input**: `.specify/specs/epic3-process-alerts.md` e `.specify/plans/epic3-process-alerts.md`

**Tests**: Sem tarefas de teste automatizado dedicadas — verificação manual por história, padrão dos épicos anteriores. `npm run type-check`/`lint` como gates obrigatórios.

**Organização**: Separado em **Banco**, **Backend** e **Frontend**, conforme pedido.

---

## Fase 1: Banco de Dados

- [ ] [Banco] T001 Em `prisma/schema.prisma`, adicionar ao model `VirtualProcess`: `validityDate DateTime? @map("validity_date")` e `totalValue Decimal? @db.Decimal(15, 2) @map("total_value")` — mesmo formato monetário já usado em `Covenant.transferValue`
- [ ] [Banco] T002 Aplicar com `npx prisma db push` (**não** `migrate dev` — está quebrado neste projeto por drift pré-existente, erro P3006 no shadow database; ver Achado 3 do plano). Ambos os campos são opcionais e aditivos, sem risco para dado existente
- [ ] [Banco] T003 Rodar `npx prisma generate` e confirmar que os dois campos aparecem nos tipos gerados. **Atenção**: se o dev server estiver rodando, o generate falha com EPERM ao trocar o `.dll` do query engine — os tipos são gerados mesmo assim, mas o servidor precisa ser reiniciado para o client novo valer em runtime

**Checkpoint**: campos disponíveis no banco e nos tipos.

---

## Fase 2: Backend

**Depends on**: Fase 1.

- [ ] [Backend] T004 Em `src/schemas/virtual-process.schemas.ts`, adicionar ao `createVirtualProcessSchema`: `validityDate: z.coerce.date().optional().nullable()` e `totalValue: z.coerce.number().nonnegative().optional().nullable()`. Manter o `.refine()` de `startDate`/`endDate` do Épico 1 intacto
- [ ] [Backend] T005 No mesmo arquivo, criar `updateValiditySchema` com os dois campos opcionais e **anuláveis** — anulável de propósito, para permitir *remover* uma validade já gravada (História 4, cenário 2)
- [ ] [Backend] T006 Em `virtual-process.controller.ts::createProcess`, persistir os dois campos novos
- [ ] [Backend] T007 Em `virtual-process.controller.ts::listProcesses`, adicionar `expiringIn: z.coerce.number().int().positive().optional()` ao `querySchema` e traduzir para o `where`: `validityDate` entre o **início de hoje** e o **fim do dia** `hoje + N`. O limite inferior é o início de hoje (não "agora") para que um processo que vence hoje não some do filtro no meio do expediente
- [ ] [Backend] T008 Criar `virtual-process.controller.ts::updateValidity` (atualiza só `validityDate`/`totalValue`, com o `orgFilter` já usado nos demais métodos) e registrar `PATCH /:id/validity` em `virtual-process.routes.ts` com `requireAnyPermission(['processes:write', 'processes:manage'])` — mesmas permissões de `/:id/company`, que é o precedente estreito equivalente
- [ ] [Backend] T009 Verificar manualmente via API: criar processo com e sem os campos; `GET /?expiringIn=30` retorna só os que vencem na janela e **exclui** os sem data de validade; `PATCH /:id/validity` grava, corrige e remove a data

**Checkpoint**: dados, filtro e edição funcionando pela API.

---

## Fase 3: Frontend — fundação compartilhada

**Depends on**: Fase 2 (pelos tipos de resposta).

- [ ] [Frontend] T010 Criar `src/lib/currency.ts` com `formatCurrencyBRL(value)` para exibição e `formatCurrencyInput`/`parseCurrencyInput` para o campo de entrada, consolidando o padrão hoje triplicado (`UniversalFinanceModal`, `CovenantFormDialog`, `EntryFormDialog`). **Não migrar** os três arquivos existentes agora — fora do escopo, registrado como dívida
- [ ] [Frontend] T011 Criar `src/lib/processExpiry.ts` com `getExpiryAlert(validityDate)`, fonte única das faixas, usando `differenceInCalendarDays` do `date-fns` (já no projeto). Ordem de avaliação **da mais grave para a menos grave**: vencido (`< 0`) → crítico (`<= 3`) → urgente (`<= 7`) → atenção (`<= 15`) → aviso (`<= 30`) → nenhum. O crítico ser `<= 3` (e não `=== 3`) é o que garante a continuidade em 3, 2, 1 e 0 exigida pelo requisito
- [ ] [Frontend] T012 Em `src/types/virtual-process.ts`, adicionar `validityDate?: string | null` e `totalValue?: string | number | null` em `VirtualProcess`, e os dois campos em `CreateVirtualProcessPayload`. O tipo do valor aceita string porque **o `Decimal` do Prisma chega no JSON como string** — converter com `Number(...)` antes de formatar, como os convênios já fazem

**Checkpoint**: helpers prontos e tipados.

---

## Fase 4: Frontend — formulário

- [ ] [Frontend] T013 Em `ProcessosVirtuais.tsx`, adicionar ao formulário de autuação os campos "Data de Validade" (DatePicker, reusando o `DatePickerField` já existente no arquivo) e "Valor Total" (input com máscara BRL via `formatCurrencyInput`), ambos marcados como opcionais
- [ ] [Frontend] T014 Agrupar as datas em seções com rótulo explicativo — "Vigência do processo" (Início/Encerramento) e "Prazo monitorado" (Data de Validade, com nota de que é ela que dispara os alertas). Sem isso, o usuário preenche "Encerramento" achando que é a validade e **o alerta nunca dispara** — falha silenciosa (FR-003, Achado 2 do plano)
- [ ] [Frontend] T015 Incluir os dois campos no payload de criação, enviando `undefined` quando em branco (nunca string vazia, que o `z.coerce` transformaria em data/número inválido)

**Checkpoint**: autuação grava prazo e valor.

---

## Fase 5: Frontend — listagem, alertas e filtro

- [ ] [Frontend] T016 Na listagem, exibir a data de validade e o valor total formatado em BRL quando presentes; quando ausentes, não ocupar espaço com aviso vazio (FR-009)
- [ ] [Frontend] T017 Aplicar o badge de alerta por linha usando `getExpiryAlert()`, com intensidade crescente: aviso (30) → atenção (15) → urgente (7) → **crítico contínuo (3, 2, 1, 0)** → vencido (identificação própria, distinta de "vence hoje")
- [ ] [Frontend] T018 Adicionar o atalho "Quase Vencendo" na barra de filtros, enviando `expiringIn=30` (a faixa mais externa, para capturar tudo que já tem algum alerta) e compondo com os filtros existentes em vez de substituí-los
- [ ] [Frontend] T019 Adicionar a ação de editar prazo/valor de um processo existente (modal simples chamando `PATCH /:id/validity`), invalidando a query da listagem para refletir o novo alerta na hora
- [ ] [Frontend] T020 Verificar manualmente: cadastrar processos vencendo em 45, 30, 15, 7, 3, 2, 1, 0 dias e **um já vencido**; conferir que cada um exibe a faixa correta e que a faixa **não muda** ao reabrir a listagem em outro horário do mesmo dia (SC-002); acionar "Quase Vencendo" e conferir o resultado e a paginação

**Checkpoint**: alertas e filtro verificados.

---

## Fase 6: Polish

- [ ] [Backend] T021 [P] `npm run type-check` em `SIMP-BACKEND`, sem erros novos
- [ ] [Frontend] T022 [P] `npm run type-check` e `npm run lint` em `SIMP-FRONTEND`, sem erros novos
- [ ] [Backend] T023 Atualizar `docs/AppFeatures.md` §4.4 (Processos Virtuais) com os campos novos, as faixas de alerta e o filtro `expiringIn`; registrar em `docs/TechStack.md` a extração de `src/lib/currency.ts` e a dívida das três cópias remanescentes

---

## Dependencies & Execution Order

- **Fase 1 → Fase 2 → Fase 3** em sequência (schema → API → tipos do cliente).
- **Fases 4 e 5 dependem da Fase 3**, mas são independentes entre si (formulário vs. listagem) e podem ir em paralelo.
- **Fase 6** depende de todas.

Dentro das fases: T004 → T005 → T006/T007/T008 (independentes entre si) → T009. T010/T011/T012 são independentes entre si.

---

## Notes

- **Total**: 23 tarefas — **3 Banco**, **7 Backend** (incluindo T021), **13 Frontend**.
- **Sem `prisma migrate dev`** (T002): o histórico de migrations do projeto está com drift pré-existente e o comando falha. Uso `db push`, coerente com o que já vem sendo feito desde o hotfix anterior e registrado como dívida em `docs/TechStack.md`.
- **A tarefa de maior risco de erro silencioso é a T011**: se a contagem usar diferença bruta de tempo em vez de dias de calendário, a faixa do alerta muda conforme a hora da consulta — um processo que vence amanhã apareceria como "vence hoje" à tarde. Por isso `differenceInCalendarDays` está explícito na tarefa.
- **Duas diferenças em relação ao pedido literal**, registradas para não passarem despercebidas:
  1. **"(e edição)"** pressupõe um modal de edição que **não existe** — não há rota de update geral para processos virtuais, só `/status` e `/company`. Incluí um `PATCH /:id/validity` estreito (T008/T019) porque, sem ele, todo processo já cadastrado ficaria permanentemente fora do controle de prazos e a funcionalidade só valeria para os criados de agora em diante. Se preferir adiar, T008 e T019 saem e o épico entrega só para processos novos.
  2. **Processos já vencidos** não foram mencionados nas faixas (30/15/7/3), mas são o caso mais grave. Tratei "vencido" como estado próprio, distinto de "vence hoje" — se a preferência for outra, é um ajuste de uma linha em `getExpiryAlert`.
- **Ponto que vale confirmar antes de eu rodar a migration**: `VirtualProcess` **já tem `endDate`** ("Data de Encerramento"). Estou criando `validityDate` como campo novo e distinto, assumindo que validade ≠ encerramento. Se a intenção era monitorar o `endDate` que já existe, não há migration nenhuma a fazer — muda a Fase 1 inteira.
