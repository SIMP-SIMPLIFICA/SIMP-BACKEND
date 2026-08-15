---
description: "Implementation plan for feature: Épico 3 — Conselhos: Mesa Diretora, Trava de 72h e Calendário Oficial"
---

# Implementation Plan: Conselhos — Mesa Diretora, Trava de 72h e Calendário Oficial

**Input**: `.specify/specs/epic3-councils-revolution.md`

## Summary

Dos três requisitos, **um já está pronto** e outro **não precisa de dependência nova**. O trabalho real é a trava de compliance — e o cuidado principal ali não é escrever a condição, é garantir que ela cubra **todas as portas** e que servidor e interface concordem sobre o corte.

### O que já existe (verificado)

| Item | Estado | Evidência |
|---|---|---|
| Cargo no vínculo Usuário↔Conselho | ✅ **completo** | `CouncilMembership.role` (enum `CouncilMemberRole`: PRESIDENTE, VICE_PRESIDENTE, SECRETARIO, MEMBRO_TITULAR, MEMBRO_SUPLENTE), com default e `@@unique([councilId, userId, role])` |
| Interface de atribuição de cargo | ✅ **completo** | `EditMemberModal.tsx` já tem `ROLE_LABELS` em português e Select de cargo |
| Biblioteca de PDF | ✅ **instalada** | `jspdf@4.2.1` + `jspdf-autotable@5.0.7`, com precedente de uso em `src/utils/export.ts` |
| Trava de 72h | ❌ **não existe** | Nenhuma checagem de prazo em `council-meeting.controller.ts` nem em `council-document.controller.ts` |
| Calendário anual em PDF | ❌ não existe | — |

**Conclusão de escopo**: **nenhuma migration**, **nenhuma dependência nova**.

### O ponto crítico da trava: são 9 portas, não 2

`council.routes.ts` expõe estas mutações ligadas a uma reunião:

| Rota | O que altera |
|---|---|
| `PUT /:councilId/meetings/:id` | dados da reunião |
| `DELETE /:councilId/meetings/:id` | a reunião |
| `PATCH /:councilId/meetings/:id/status` | situação |
| `POST /:councilId/meetings/:id/agenda` | item de pauta |
| `PUT /:councilId/meetings/:id/agenda/:itemId` | item de pauta |
| `DELETE /:councilId/meetings/:id/agenda/:itemId` | item de pauta |
| `PUT /:councilId/meetings/:id/attendance` | presença |
| `POST /:councilId/meetings/:meetingId/documents` | anexa ata |
| `DELETE /:councilId/meetings/:meetingId/documents/:docId` | exclui ata |

Proteger só edição/exclusão da reunião e upload/exclusão de ata (o que o pedido cita) deixaria **pauta, presença e status** livres — e alterar a pauta de uma ata congelada altera o conteúdo do registro oficial por outra porta. Cobrir as nove é o que torna a trava real.

## Technical Context

**Backend**: Fastify 5, Prisma 6.19 + Postgres 16, Zod 3.25. `council-document.controller.ts` já tem um helper `resolveMeeting(meetingId, councilId, orgFilter)` que carrega a reunião — ponto natural de encaixe.

**Datas**: `CouncilMeeting.scheduledAt` é `DateTime` (timestamp). O Postgres armazena em UTC; o Node compara em UTC. A comparação de instantes (não de dias de calendário) é o que importa aqui — ver Decisão 2.

**Frontend**: React 19, `date-fns` com locale pt-BR, `jspdf`/`jspdf-autotable` disponíveis. Nome da organização acessível via `useMe()` (`user.organization.name`).

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First | Sim | Nenhuma dependência nova. |
| II. Supabase Prohibition | Sim | Não aplicável. |
| III. Municipal Domain Integrity | **Reforça fortemente** | Ata de conselho é documento de fé pública; a trava é exatamente a proteção de integridade que o princípio pede. |
| IV. Multi-Tenant & Module-Gated | Sim | Herda `orgFilter` e permissões `councils:*` existentes. |
| V. Spec-Driven Development | Sim | Fluxo Spec Kit seguido. |
| VI. Environment & Security Baseline | Sim | Falha fechada; validação server-side. |

Nenhuma violação.

## Architecture Decisions

1. **Uma função única de decisão, compartilhada por todas as rotas**: `assertMeetingEditable(meeting)` em um módulo de domínio de conselhos (ex: `src/services/council-compliance.ts`), lançando/retornando a recusa padronizada. Todas as nove rotas chamam a mesma função.

   Motivo: nove implementações separadas divergiriam — foi exatamente assim que o módulo de Comunicação vazou dados no Épico 1 (hook de auth próprio em vez do compartilhado). Uma função, um comportamento.

2. **A contagem é de instantes, em UTC — não de dias de calendário.** `agora > scheduledAt + 72h` congela. Isso é o **oposto** da escolha feita no épico de alertas de vencimento (`differenceInCalendarDays`), e a diferença é proposital:

   - Lá, a pergunta era "quantos dias faltam", e a resposta não podia mudar conforme a hora da consulta.
   - Aqui, o prazo é literalmente "72 horas" — um instante exato. Arredondar para dia de calendário daria a alguém até ~24h a mais ou a menos de janela, dependendo do horário da reunião.

   Como `Date` em JS é sempre um instante absoluto (UTC internamente), a comparação já é imune a fuso: o servidor no Brasil e o banco em UTC chegam ao mesmo resultado. **Não usar** componentes locais de data (`getHours`, `setHours`) nessa conta, que é onde o fuso entraria de contrabando.

3. **Servidor é a fonte da verdade; a interface recebe o veredito pronto.** Em vez de o frontend recalcular a regra (arriscando divergir por relógio do cliente adiantado/atrasado), a API passa a devolver, junto da reunião, um campo `isFrozen` e o instante-limite. A tela só reflete.

   Isso resolve FR-006 e SC-003 na origem — o relógio do navegador do usuário deixa de participar da decisão.

4. **Código de erro `MEETING_FROZEN`** (HTTP 403), no mesmo padrão de `MODULE_DISABLED` e `ORGANIZATION_SUSPENDED` já usados no projeto, para que a interface distinga isso de falta de permissão (FR-005).

5. **PDF gerado no cliente com `jspdf` + `jspdf-autotable`**, seguindo o precedente de `src/utils/export.ts`.

   Alternativas descartadas: (a) `window.print()` + CSS `@media print` — usado nos Protocolos, mas depende do diálogo de impressão do navegador e não produz arquivo com layout garantido, insuficiente para um documento oficial com linhas de assinatura; (b) gerar no backend — exigiria uma dependência nova de renderização (Puppeteer/PDFKit) e um endpoint novo, sem ganho, já que todos os dados necessários já estão na tela; o projeto inclusive já removeu uma referência morta a Puppeteer.

6. **Assinaturas montadas a partir dos membros ativos com cargo de Mesa** (`PRESIDENTE`, `VICE_PRESIDENTE`, `SECRETARIO`, filtrando `isActive`). Se um cargo não existir, a linha correspondente é omitida em vez de sair em branco com rótulo — um documento oficial com "Presidente: ________" sem presidente cadastrado induz a erro. Se houver duplicidade de cargo (erro de cadastro), todas as ocorrências entram, sem quebrar (Edge Case).

7. **Alteração de status entra na trava** (Edge Case explícito). Marcar uma reunião como "realizada" ou "cancelada" meses depois altera o significado do registro oficial tanto quanto editar o título.

8. **Sem mecanismo de desbloqueio.** Nenhum papel reabre um registro congelado. Um "destravar" seria uma funcionalidade de exceção com auditoria própria e regra de quem pode — decisão de negócio que não foi pedida e não deve ser inventada aqui.

## Project Structure

**Backend** (`SIMP-BACKEND/src/`):
- `services/council-compliance.ts` — **novo**: `isMeetingFrozen()`, `assertMeetingEditable()`, constante da janela
- `controllers/council-meeting.controller.ts` — trava em update, remove, updateStatus, pauta (3) e attendance; `isFrozen` nas respostas de leitura
- `controllers/council-document.controller.ts` — trava em upload e remove de documentos

**Frontend** (`SIMP-FRONTEND/src/`):
- `pages/councils/MeetingDetailPage.tsx` — badge de congelado + controles desabilitados
- `pages/councils/CouncilDetailPage.tsx` — botão "Exportar Calendário Anual" (+ seleção de ano) e indicação de congelamento na lista
- `utils/councilCalendarPdf.ts` — **novo**: geração do PDF, no padrão de `utils/export.ts`

**Sem migration Prisma. Sem dependência nova.**

## Complexity Tracking

Nenhuma exceção à Constituição necessária.
