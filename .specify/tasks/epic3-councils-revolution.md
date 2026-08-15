---
description: "Task list for feature: Épico 3 — Conselhos: Mesa Diretora, Trava de 72h e Calendário Oficial"
---

# Tasks: Conselhos — Mesa Diretora, Trava de 72h e Calendário Oficial

**Input**: `.specify/specs/epic3-councils-revolution.md` e `.specify/plans/epic3-councils-revolution.md`

**Tests**: Sem tarefas de teste automatizado dedicadas — verificação manual por história, padrão dos épicos anteriores. `npm run type-check`/`lint` como gates obrigatórios.

**Organização**: Separado em **Banco**, **Backend** e **Frontend**.

---

## Fase 1: Banco de Dados

*(**Nenhuma tarefa.** `CouncilMembership.role` e o enum `CouncilMemberRole` já existem, com default e constraint; `EditMemberModal.tsx` já atribui e exibe os cargos. **Nenhuma migration será criada nem aplicada neste épico.** Ver a nota de escopo ao final.)*

---

## Fase 2: Backend — Trava de compliance de 72h

- [ ] [Backend] T001 Criar `src/services/council-compliance.ts` com a janela (`MEETING_EDIT_WINDOW_HOURS = 72`), `isMeetingFrozen(scheduledAt)` e `assertMeetingEditable(meeting)`. **Comparação de instantes em UTC** (`Date.now() > scheduledAt.getTime() + 72h`), nunca com componentes locais de data (`getHours`/`setHours`) — é por onde o fuso entraria de contrabando. Reunião futura ou de hoje nunca congela
- [ ] [Backend] T002 Aplicar a trava em `council-meeting.controller.ts` nas rotas de **reunião**: `update`, `remove` e `updateStatus`. Alterar status entra na trava de propósito — marcar como "realizada" meses depois altera o significado do registro oficial
- [ ] [Backend] T003 Aplicar a mesma trava nas rotas de **pauta** (`POST`, `PUT`, `DELETE` de agenda) e de **presença** (`PUT attendance`). Sem isso, o conteúdo de uma ata congelada continuaria alterável por outra porta
- [ ] [Backend] T004 Aplicar a trava em `council-document.controller.ts`: `upload` e `remove` de documentos, reaproveitando o helper `resolveMeeting()` que já existe no arquivo. A exclusão precisa da mesma trava do anexo — senão o congelamento seria contornável apagando e reanexando
- [ ] [Backend] T005 Padronizar a recusa: HTTP **403** com `{ error: 'MEETING_FROZEN', message: 'Registro oficial congelado. O prazo de 72h após a reunião foi encerrado.' }`, no mesmo padrão de `MODULE_DISABLED`/`ORGANIZATION_SUSPENDED` já usados no projeto (FR-005)
- [ ] [Backend] T006 Nas rotas de **leitura** de reunião (detalhe e listagem), devolver `isFrozen` (booleano) e o instante-limite calculados **no servidor**. A interface não recalcula a regra — o relógio do navegador do usuário não pode participar da decisão (FR-006, SC-003)
- [ ] [Backend] T007 Verificar manualmente via API: em reunião de 4 dias atrás, as **nove** mutações são recusadas com `MEETING_FROZEN`; em reunião de ontem e em reunião futura, todas funcionam; a leitura devolve `isFrozen` coerente

**Checkpoint**: trava real, cobrindo todas as portas, decidida no servidor.

---

## Fase 3: Frontend — Interface da trava

**Depends on**: Fase 2 (consome `isFrozen`).

- [ ] [Frontend] T008 Em `MeetingDetailPage.tsx`, exibir o badge/aviso **"Registro Oficial Congelado (Prazo de 72h encerrado)"** quando `isFrozen`, em posição visível ao abrir a tela — antes de qualquer tentativa de clique (FR-007)
- [ ] [Frontend] T009 Desabilitar (**não ocultar**) os controles de editar, excluir, anexar ata, alterar pauta e registrar presença quando congelado, com `title` explicando o motivo. Manter visíveis para o usuário entender que a ação existia e deixou de estar disponível (FR-008)
- [ ] [Frontend] T010 Tratar a resposta `MEETING_FROZEN` como mensagem clara em toast, para o caso de a tela estar desatualizada (ex: reunião congelou enquanto o usuário a mantinha aberta)
- [ ] [Frontend] T011 Em `CouncilDetailPage.tsx`, sinalizar na lista de reuniões quais estão congeladas, para o usuário saber antes de entrar
- [ ] [Frontend] T012 Verificar manualmente: reunião de 4 dias atrás mostra o aviso e os controles desabilitados; reunião de ontem não mostra aviso e permite tudo; a decisão exibida bate com a do servidor

**Checkpoint**: Histórias 1 e 2 verificadas.

---

## Fase 4: Frontend — Calendário Anual Oficial (PDF)

**Independente da Fase 3.**

- [ ] [Frontend] T013 Criar `src/utils/councilCalendarPdf.ts` usando `jspdf` + `jspdf-autotable` (**já instalados**, precedente em `src/utils/export.ts` — nenhuma dependência nova)
- [ ] [Frontend] T014 Montar o **cabeçalho oficial**: nome da organização (via `useMe()` → `user.organization.name`) e nome do conselho, mais o ano de referência (FR-010)
- [ ] [Frontend] T015 Montar a **tabela de reuniões** do ano escolhido com Data, Pauta/Tema e Situação, usando os rótulos de status em português já existentes na tela (FR-011)
- [ ] [Frontend] T016 Montar o **rodapé de assinaturas**: linhas tracejadas com nome e cargo dos membros **ativos** da Mesa Diretora (`PRESIDENTE`, `VICE_PRESIDENTE`, `SECRETARIO`). Cargo ausente → linha omitida, não linha em branco rotulada (um "Presidente: ____" sem presidente cadastrado induz a erro). Cargo duplicado por erro de cadastro não pode quebrar a geração (FR-012)
- [ ] [Frontend] T017 Adicionar o botão "Exportar Calendário Anual" com seletor de ano em `CouncilDetailPage.tsx`, filtrando as reuniões pelo ano escolhido (FR-009)
- [ ] [Frontend] T018 Verificar manualmente os casos-limite: ano **sem reuniões** gera documento indicando ausência (não falha nem sai vazio); conselho **sem Presidente/Secretário** gera sem quebrar; reuniões de outros anos não entram (FR-013)

**Checkpoint**: História 3 verificada.

---

## Fase 5: Polish

- [ ] [Backend] T019 [P] `npm run type-check` em `SIMP-BACKEND`, sem erros novos
- [ ] [Frontend] T020 [P] `npm run type-check` e `npm run lint` em `SIMP-FRONTEND`, sem erros novos
- [ ] [Backend] T021 Atualizar `docs/AppFeatures.md` §4.9 (Conselhos): a trava de 72h (janela, rotas cobertas, código `MEETING_FROZEN`, decisão no servidor), o calendário anual em PDF, e o registro de que **não há mecanismo de desbloqueio** — reabrir um registro congelado exigiria funcionalidade própria com auditoria própria

---

## Dependencies & Execution Order

- **Fase 2 é a base.** A Fase 3 consome o `isFrozen` que ela produz.
- **Fases 3 e 4 são independentes entre si** e podem ir em paralelo depois da Fase 2.
- **Fase 4 não depende da Fase 2** tecnicamente (só lê dados que já existem), mas vem depois por prioridade — a integridade legal (P1) antes do documento (P2).
- **Fase 5** depende de todas.

Dentro das fases: T001 → T002/T003/T004 (as três consomem o helper) → T005 → T006 → T007. T013 → T014/T015/T016 → T017 → T018.

---

## Notes

- **Total**: 21 tarefas — **0 Banco**, **7 Backend**, **11 Frontend**, **3 polish/documentação**.
- **Sem migration e sem dependência nova**, e esta é a maior diferença em relação ao pedido literal:
  - **O requisito 1 (Mandatos/Mesa Diretora) já está inteiramente implementado.** `CouncilMembership.role` é um enum `CouncilMemberRole` com `PRESIDENTE`, `VICE_PRESIDENTE`, `SECRETARIO`, `MEMBRO_TITULAR`, `MEMBRO_SUPLENTE`, com default e `@@unique([councilId, userId, role])`; e `EditMemberModal.tsx` já atribui e exibe os cargos com rótulos em português. O pedido dizia "atualize o modelo... crie e aplique a migration" — não há o que atualizar.
    **Vale sua confirmação**: se a intenção era **renomear** `MEMBRO_TITULAR` → "Conselheiro(a)" e `MEMBRO_SUPLENTE` → "Suplente", isso é troca de rótulo na interface (uma linha em `ROLE_LABELS`, sem migration). Se for para mudar os **valores do enum no banco**, aí sim exige migration e atualização dos registros existentes — me avise e eu incluo.
  - **`jspdf` e `jspdf-autotable` já estão instalados** (`package.json:37-38`), com precedente de uso em `src/utils/export.ts`.
- **A trava alcança 9 rotas, não 2.** O pedido cita edição/exclusão da reunião e upload/exclusão de atas; incluí também **pauta (3 rotas), presença e status**, porque alterar a pauta de uma ata congelada altera o conteúdo do registro oficial pela porta dos fundos. Se preferir escopo estrito, T003 sai — mas a trava fica contornável.
- **Decisão de data deliberadamente diferente do épico anterior**: aqui a comparação é de **instantes em UTC** (`agora > scheduledAt + 72h`), não `differenceInCalendarDays`. O prazo é literalmente "72 horas"; arredondar para dia de calendário daria a alguém até ~24h a mais ou a menos de janela conforme o horário da reunião.
- **O servidor decide, a interface reflete** (T006): a API devolve `isFrozen` pronto. Se o frontend recalculasse, o relógio do navegador do usuário entraria na decisão e um registro poderia parecer editável e ser recusado.
- **Sem mecanismo de desbloqueio** — nenhum papel reabre registro congelado. Se a prefeitura precisar disso (ex: determinação judicial), é funcionalidade própria com auditoria própria, fora deste escopo.
