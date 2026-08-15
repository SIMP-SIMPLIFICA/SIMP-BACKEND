---
description: "Implementation plan for feature: Épico 3 — Vencimentos e Alertas de Processos Virtuais"
---

# Implementation Plan: Épico 3 — Vencimentos e Alertas de Processos Virtuais

**Input**: `.specify/specs/epic3-process-alerts.md`

## Summary

Dois campos novos, um filtro de servidor e uma camada visual de alerta. A parte que exige mais cuidado não é nenhuma das três: é a **aritmética de datas** (uma comparação ingênua faz a faixa do alerta mudar conforme a hora do dia) e o **trajeto do valor monetário** (o `Decimal` do Prisma chega ao frontend como string).

### Achado 1 — Não existe rota de edição de processo virtual

`virtual-process.routes.ts` expõe apenas `POST /`, `GET /`, `GET /:id`, `PATCH /:id/status`, `PATCH /:id/company` e `DELETE /:id`. **Não há update geral.** Consequência direta: sem um caminho de edição, todo processo já cadastrado ficaria permanentemente sem data de validade, e os alertas só valeriam para processos criados depois deste épico — exatamente a lacuna que o Épico 1 teve com a correção que só valia para organizações novas.

**Decisão**: incluir um `PATCH /:id/validity` restrito aos dois campos deste épico, seguindo o precedente estreito que já existe (`/:id/company` faz exatamente isso para dados da empresa). Preferido a um update geral porque este último exigiria lidar com unicidade de `processNumber`, o `refine` de datas e regras de status — escopo bem maior, sem necessidade agora.

### Achado 2 — `endDate` já existe e o novo campo pode ser confundido com ele

O formulário já tem "Data de Início" e "Data de Encerramento" (`startDate`/`endDate`, com validação de intervalo adicionada no Épico 1). "Data de Validade" entra como um terceiro campo de data. Se o usuário preencher o encerramento achando que é a validade, **o alerta nunca dispara** — falha silenciosa, do tipo pior de diagnosticar.

**Decisão**: agrupar os campos em seções visualmente distintas com texto de apoio explicando o papel de cada data — "Vigência do processo" (início/encerramento) vs. "Prazo monitorado" (validade, com aviso de que é ela que gera os alertas). Custo baixo, elimina a ambiguidade na origem.

### Achado 3 — `prisma migrate dev` está quebrado neste projeto

Confirmado no hotfix anterior: a migration `20260408032158_add_organization_modules` falha no shadow database (P3006, `relation "organization_modules" already exists`), o que impede qualquer `migrate dev`. O fluxo em uso é `prisma db push` mais SQL versionado em `prisma/sql/` quando necessário.

**Decisão**: aplicar via `db push` (ambos os campos são aditivos e opcionais — não há risco de perda de dado) e registrar isso na tarefa, em vez de tentar consertar o histórico de migrations aqui. Reconstruir o histórico é um trabalho próprio, já registrado como dívida em `docs/TechStack.md`.

## Technical Context

**Backend**: Fastify 5, Prisma 6.19 + Postgres 16, Zod 3.25.
**Frontend**: React 19 + Vite, TanStack Query 5, shadcn/ui, `date-fns` com locale pt-BR já em uso.

**Precedente de `Decimal` no projeto**: `Covenant.transferValue` e `counterpartValue` usam `Decimal? @db.Decimal(15, 2)`, e o frontend os converte com `Number(...)` na leitura (`CovenantDetailSheet.tsx:140`) e formata com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` (`CovenantsPage.tsx:45`). Este épico segue exatamente o mesmo padrão.

**Duplicação existente**: `formatCurrencyInput` está reimplementado em três arquivos (`UniversalFinanceModal.tsx`, `CovenantFormDialog.tsx`, `EntryFormDialog.tsx`), e a formatação de exibição em ~5 lugares. Este épico seria o quarto. Ver Decisão 5.

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First / Zero Cloud Credentials | Sim | Nenhuma dependência nova. |
| II. Supabase Prohibition | Sim | Não aplicável. |
| III. Municipal Domain Integrity | **Reforça** | Controle de prazo em processo administrativo tem consequência legal; valores monetários exigem precisão de centavos (Decisão 3). |
| IV. Multi-Tenant & Module-Gated | Sim | Filtro e edição herdam o `orgFilter` e as permissões `processes:*` já existentes. |
| V. Spec-Driven Development | Sim | Fluxo Spec Kit seguido. |
| VI. Environment & Security Baseline | Sim | Sem variável nova; edição sob as permissões vigentes. |

Nenhuma violação.

## Architecture Decisions

1. **Campos no schema seguindo o precedente do `Covenant`**: `validityDate DateTime? @map("validity_date")` e `totalValue Decimal? @db.Decimal(15, 2) @map("total_value")`. Ambos opcionais e aditivos — `db push` os aplica sem tocar em dado existente. `Decimal(15,2)` é o mesmo usado nos convênios, o que mantém uma única convenção monetária no schema.

2. **A contagem de dias é feita no frontend, sobre dias de calendário normalizados.** O backend devolve a data crua; a interface calcula `diffInCalendarDays(validityDate, hoje)` usando `date-fns` (já no projeto, com locale pt-BR).

   Isso resolve o problema central de FR-008: uma subtração bruta de milissegundos faria um processo que vence amanhã às 09h exibir "0 dias" quando consultado hoje às 14h (faltam 19 horas → 0 dias inteiros). `differenceInCalendarDays` compara as datas *do calendário*, ignorando a hora — então "amanhã" é sempre 1, independentemente do horário da consulta. É exatamente o que SC-002 exige.

3. **Faixas de alerta como função pura única, em módulo compartilhado.** Uma função `getExpiryAlert(validityDate)` devolve a faixa (`expired` | `critical` | `urgent` | `warning` | `notice` | `none`) com rótulo e classes de cor. Fonte única, para que listagem, detalhe e qualquer tela futura não divirjam — o mesmo motivo que levou à consolidação de `TASK_STATUS_LABELS` no Épico 2.

   As faixas são avaliadas **da mais grave para a menos grave**, e a crítica é `dias <= 3` (não `dias === 3`), o que garante a continuidade exigida por FR-006 — 3, 2, 1 e 0 caem todos na mesma condição, sem buraco. Vencido (`dias < 0`) é avaliado antes de tudo (FR-007).

4. **Filtro `expiringIn` no servidor, como janela fechada**: `validityDate` entre o início de hoje e o fim do dia `hoje + N`. Filtrar no servidor é o que preserva a correção de `total` e da paginação (FR-011) — filtrar no cliente mostraria "50 resultados" e exibiria 3. Processos sem `validityDate` ficam fora naturalmente, porque `null` não satisfaz o intervalo (FR-009/cenário 2 da História 3).

   O limite inferior ser "hoje" (e não "agora") evita que um processo que vence hoje mais cedo desapareça do filtro no meio do expediente.

5. **Extrair os helpers de moeda para `src/lib/currency.ts`** (`formatCurrencyBRL` para exibição e `parseCurrencyInput`/`formatCurrencyInput` para entrada), e usá-los aqui. Adicionar uma quarta cópia de código já triplicado seria consolidar o problema; a extração é pequena e este épico é a ocasião natural. **Escopo contido**: os três arquivos existentes não serão migrados agora (mudança de risco desnecessário fora do épico) — ficam registrados como dívida a resolver quando cada um for tocado.

6. **Valor trafega como número, não string.** O Zod aceita `z.coerce.number().nonnegative().optional()`; o Prisma cuida da conversão para `Decimal`. Na leitura, o `Decimal` chega ao JSON como **string** — o frontend converte com `Number(...)` antes de formatar, exatamente como os convênios já fazem. Isso está explícito aqui porque é uma pegadinha silenciosa: `"1500.00" + 100` produziria `"1500.00100"` em vez de `1600`.

7. **`PATCH /:id/validity` com schema próprio**, aceitando `validityDate` e `totalValue` (ambos opcionais e anuláveis, para permitir *remover* uma data já gravada — cenário 2 da História 4). Permissões: `processes:write`/`processes:manage`, iguais às de `/:id/company`.

8. **Atalho "Quase Vencendo" como alternância na barra de filtros**, definido como `expiringIn=30` — a faixa mais externa das quatro, para que o atalho capture tudo que já tem algum alerta. Compõe com os filtros existentes por ser apenas mais um parâmetro na mesma query (FR-012).

9. **Processos vencidos permanecem na listagem geral** com indicador próprio, fora do filtro "Quase Vencendo" (que responde "o que vai vencer"). Escondê-los seria o pior resultado possível: sumir com o caso mais grave.

## Project Structure

**Banco** (`SIMP-BACKEND/prisma/`):
- `schema.prisma` — `validityDate` e `totalValue` em `VirtualProcess`
- Aplicação via `prisma db push` (ver Achado 3)

**Backend** (`SIMP-BACKEND/src/`):
- `schemas/virtual-process.schemas.ts` — campos novos em `createVirtualProcessSchema` + novo `updateValiditySchema`
- `controllers/virtual-process.controller.ts` — `expiringIn` no `querySchema` e no `where`; novo `updateValidity`
- `routes/virtual-process.routes.ts` — `PATCH /:id/validity`

**Frontend** (`SIMP-FRONTEND/src/`):
- `lib/currency.ts` — **novo**, helpers compartilhados de moeda
- `lib/processExpiry.ts` — **novo**, `getExpiryAlert()` (fonte única das faixas)
- `types/virtual-process.ts` — campos novos nos tipos e no payload
- `pages/processos-virtuais/ProcessosVirtuais.tsx` — campos no formulário, colunas e badges na listagem, atalho "Quase Vencendo", modal de edição de prazo/valor

## Complexity Tracking

Nenhuma exceção à Constituição necessária.
