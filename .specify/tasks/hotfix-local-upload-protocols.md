---
description: "Task list for feature: Hotfix — Armazenamento Local, Notificações e Numeração Manual de Atos Normativos"
---

# Tasks: Hotfix — Armazenamento Local, Notificações e Numeração Manual

**Input**: `.specify/specs/hotfix-local-upload-protocols.md` e `.specify/plans/hotfix-local-upload-protocols.md`

**Tests**: Sem tarefas de teste automatizado dedicadas — verificação manual por história, padrão dos Épicos 1 e 2. `npm run type-check`/`lint` seguem como gates obrigatórios.

**Organização**: Por história de usuário; cada tarefa rotulada **[Backend]** ou **[Frontend]**.

---

## Phase 1: Setup / Foundational

**Bloqueia todas as outras fases da História 1** — a camada de armazenamento precisa existir antes de qualquer controller migrar.

- [ ] [Backend] T001 Criar `src/services/storage.service.ts` com `saveFile(buffer, { organizationId, scope, originalName })` → `fileKey`, `getFileUrl(fileKey)` → URL absoluta, e `deleteFile(fileKey)`. Grava sob `uploads/organizations/<orgId>/<scope>/<timestamp>-<8bytes-hex><ext>`, mantendo o mesmo formato de `fileKey` já persistido no banco pelos 8 controllers. Cria os diretórios com `fs.promises.mkdir(..., { recursive: true })`; nome em disco sempre gerado pelo sistema (FR-003)
- [ ] [Backend] T002 Em `src/config/config.ts`, adicionar `APP_BASE_URL` ao schema Zod (default `http://localhost:3000`) e remover o bloco de config `r2`; adicionar `APP_BASE_URL` e remover as `R2_*` do `.env.example`
- [ ] [Backend] T003 Em `src/config/plugins.ts`, registrar `@fastify/static` (já em `package.json:41`, não precisa instalar) com `root` apontando para `uploads/` e `prefix: '/uploads/'`, criando a pasta no boot se não existir
- [ ] [Backend] T004 Adicionar `uploads/` ao `.gitignore`

**Checkpoint**: camada de armazenamento pronta e servindo; nenhum controller migrado ainda.

---

## Phase 2: User Story 1 - Uploads locais sem credencial de nuvem (Priority: P1)

**Goal**: Os 8 controllers gravam e leem do disco local; o SDK da AWS sai do projeto.

**Independent Test**: Subir e baixar um PDF na Biblioteca com o backend rodando sem nenhuma variável `R2_*`.

- [ ] [Backend] T005 [US1] Migrar `src/controllers/library.controller.ts`: `upload` usa `saveFile`, `download` devolve `getFileUrl` (mesmo formato de resposta `{ url, fileName, fileSize }`), `delete` usa `deleteFile`, `downloadZip` lê do disco com `fs.createReadStream` preservando a proteção Zip Slip (`path.basename`)
- [ ] [Backend] T006 [US1] Migrar `src/controllers/communication.controller.ts` (`uploadAttachment`, `downloadAttachment`)
- [ ] [Backend] T007 [US1] Migrar `src/controllers/task.controller.ts` (`uploadAttachment`, `deleteAttachment`, e as URLs assinadas em `details`)
- [ ] [Backend] T008 [US1] Migrar `src/controllers/virtual-process.controller.ts` (upload, download e delete de documentos)
- [ ] [Backend] T009 [US1] Migrar `src/controllers/finance-entry.controller.ts` (upload, download e delete de comprovantes)
- [ ] [Backend] T010 [US1] Migrar `src/controllers/council-document.controller.ts` (upload, download e delete de atas)
- [ ] [Backend] T011 [US1] Migrar `src/controllers/user.controller.ts` (logo da organização) e `src/controllers/upload.controller.ts` (upload genérico)
- [ ] [Backend] T012 [US1] Remover `src/lib/r2.ts` e desinstalar `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`; confirmar via grep que nenhuma referência a `@aws-sdk` ou `r2` sobrou em `src/`
- [ ] [Backend] T013 [US1] Verificar manualmente: com o backend rodando **sem nenhuma variável `R2_*` no `.env`**, subir e baixar um PDF na Biblioteca e um anexo em Comunicação; confirmar que os arquivos existem em `uploads/` no disco e que `git status` não mostra nenhum deles

**Checkpoint**: US1 verificada — zero dependência de credencial de nuvem para arquivos.

---

## Phase 3: User Story 2 - Notificações acessíveis (Priority: P1)

**Independente das outras fases** — pode ser feita em paralelo.

- [ ] [Backend] T014 [US2] Em `src/constants/permissions.ts`, adicionar a categoria `notifications` com as **três** chaves que as rotas já referenciam: `notifications:read`, `notifications:write` e `notifications:manage` (só `read` deixaria marcar-lida e excluir ainda em 403)
- [ ] [Backend] T015 [US2] Rodar `npx tsx prisma/scripts/sync-admin-role-permissions.ts` e reportar o output (quantas chaves foram adicionadas ao papel "admin")
- [ ] [Backend][Frontend] T016 [US2] Verificar manualmente como Admin: abrir a campainha de notificações (lista carrega sem 403), marcar uma como lida, marcar todas como lidas, e excluir uma

**Checkpoint**: US2 verificada.

---

## Phase 4: User Story 3 - Numeração manual de Ato Normativo (Priority: P1)

**Independente das Fases 2 e 3.**

- [ ] [Backend] T017 [US3] Em `prisma/schema.prisma`, adicionar o valor `MANUAL` ao enum `OfficialDocumentNumberingType` (aditivo, nenhum registro existente muda)
- [ ] [Backend] T018 [US3] Criar a migration Prisma incluindo, além do enum, o índice único parcial em SQL bruto: `CREATE UNIQUE INDEX ... ON official_documents (organization_id, sequence_number, year) WHERE document_category = 'NORMATIVO'` — parcial de propósito, pois documentos de Comunicação repetem `sequenceNumber` legitimamente entre setores
- [ ] [Backend] T019 [US3] Em `src/controllers/protocol.controller.ts`, estender `generateSchema` com `sequenceNumber` e `year` opcionais (`z.coerce.number().int().positive()` — a coerção já normaliza "007" → 7, resolvendo o edge case de zeros à esquerda) e adicionar um `.refine()` que os torna obrigatórios quando `documentCategory === 'NORMATIVO'`
- [ ] [Backend] T020 [US3] No `generate()`, ramificar: para `NORMATIVO`, usar os valores manuais, gravar `numberingType: 'MANUAL'` e **não** tocar em `sequenceControl`; antes do `create`, fazer o `findFirst` por `[organizationId, documentCategory: 'NORMATIVO', sequenceNumber, year]` e, se encontrar, responder `409` com a mensagem exata `Já tem outra lei/documento com esse numero existente.`. O caminho de Comunicação (incluindo `withSerializableRetry`) permanece intacto
- [ ] [Backend] T021 [US3] Envolver o `create` em `try/catch` que captura a violação de índice único (`P2002`) e a traduz para a **mesma** mensagem exata do T020 — garante FR-011 sob concorrência sem expor erro técnico ao usuário
- [ ] [Frontend] T022 [US3] Em `src/lib/api/protocols.ts`, adicionar `sequenceNumber?: number` e `year?: number` ao `GenerateDocumentDTO`
- [ ] [Frontend] T023 [US3] Em `GenerateProtocolModal.tsx`, quando `category === 'NORMATIVO'`: exibir os campos obrigatórios "Número da Lei/Ato" e "Ano" (ano com default no ano corrente), incluí-los em `isValid` e no payload, e remover o aviso de numeração automática. A aba Comunicação permanece exatamente como está
- [ ] [Backend][Frontend] T024 [US3] Verificar manualmente: registrar um Ato Normativo com número e ano digitados (grava exatamente os valores informados); tentar registrar o mesmo número/ano de novo (recusa com a mensagem exata); registrar "007" e depois "7" no mesmo ano (o segundo deve ser recusado); gerar uma Comunicação (comportamento inalterado)

**Checkpoint**: US3 verificada.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] [Backend] T025 [P] Rodar `npm run type-check` em `SIMP-BACKEND` — atenção especial aqui: é o gate que confirma que nenhuma referência ao SDK removido sobrou nos 8 controllers
- [ ] [Frontend] T026 [P] Rodar `npm run type-check` e `npm run lint` em `SIMP-FRONTEND` e confirmar zero erros novos
- [ ] [Backend] T027 Atualizar `docs/TechStack.md`: §5/§6 (R2 substituído por armazenamento local em disco) e §11 — registrar (a) a dívida técnica da Decisão 3 (arquivos servidos estaticamente sem autenticação, incluindo documentos com `accessLevel` de sigilo — precisa voltar a um endpoint autenticado antes de uso com dado real), (b) a terceira ocorrência de permissão fantasma (`notifications:*`), e (c) que não houve migração retroativa dos arquivos já hospedados no R2

---

## Dependencies & Execution Order

### Entre fases

- **Fase 1 bloqueia a Fase 2** — o serviço de armazenamento precisa existir antes de qualquer controller migrar.
- **Fases 2, 3 e 4 são independentes entre si** — arquivos e módulos diferentes, podem ser feitas em qualquer ordem ou em paralelo.
- **Fase 5 depende de todas as anteriores.**

### Dentro de cada fase

- Fase 1: T001 → T002/T003 (o registro do estático depende do caminho definido no serviço); T004 a qualquer momento.
- Fase 2: T005–T011 são independentes entre si (um controller cada), mas **T012 só depois de todos** — remover o SDK antes de migrar todos quebraria o build. T013 por último.
- Fase 3: T014 → T015 → T016, estritamente sequencial.
- Fase 4: T017 → T018 (migration precisa do schema) → T019 → T020 → T021; T022/T023 em paralelo ao backend; T024 por último.

### Oportunidades de paralelismo

- As três histórias (Fases 2, 3, 4) podem ser tocadas em paralelo por pessoas/sessões diferentes.
- T005–T011 (migração dos 8 controllers) são naturalmente paralelizáveis.

---

## Notes

- **Total**: 27 tarefas (T001–T027) — 22 Backend, 2 Frontend, 3 mistas/polish.
- **Por história**: Setup 4 · US1 (armazenamento local) 9 · US2 (notificações) 3 · US3 (numeração manual) 8 · Polish 3.
- **Esta é a única migration Prisma do hotfix** (T018) — enum `MANUAL` + índice único parcial, ambos aditivos.
- **T012 é o ponto de não-retorno** da Fase 2: depois de remover o SDK, qualquer controller não migrado impede a compilação. Por isso T025 (type-check backend) é o gate mais importante desta entrega.
- **Diferença de escopo em relação ao pedido original**, registrada aqui para não passar despercebido: o relato pedia alterar `library.controller.ts`; este plano cobre 8 controllers. O motivo está no plano (Achado 1) — remover o SDK, também pedido explicitamente, quebra os outros 7, e o HTTP 401 já os afeta hoje. Se a preferência for manter o escopo estritamente na Biblioteca, o SDK precisa **permanecer** instalado e os outros 7 módulos continuarão falhando no upload — nesse caso, T006–T012 saem e o épico entrega uma correção parcial.
- **Ponto de segurança consciente** (Decisão 3 do plano): servir `uploads/` estaticamente expõe arquivos por URL sem autenticação, inclusive documentos de Biblioteca com nível de sigilo. Aceito para desenvolvimento local conforme pedido explícito, com remediação registrada em T027.
