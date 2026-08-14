---
description: "Implementation plan for feature: Hotfix — Armazenamento Local, Permissões de Notificações e Numeração Manual de Atos Normativos"
---

# Implementation Plan: Hotfix — Armazenamento Local, Notificações e Numeração Manual

**Input**: `.specify/specs/hotfix-local-upload-protocols.md`

## Summary

Três problemas independentes, dois deles maiores do que o relato inicial sugeria. A investigação confirmou causas exatas para os três, e encontrou dois riscos de correção incompleta que mudariam o resultado se ignorados.

### Achado 1 — R2 está em 8 controllers, não em 1

Grep por `@aws-sdk` / `r2.send` / `getSignedUrl` em `src/` retorna:

| Controller | Uso |
|---|---|
| `library.controller.ts` | upload, download (presigned), delete, downloadZip |
| `communication.controller.ts` | uploadAttachment, downloadAttachment |
| `task.controller.ts` | uploadAttachment, deleteAttachment, presigned em `details` |
| `virtual-process.controller.ts` | upload, download, delete de documentos |
| `finance-entry.controller.ts` | upload, download, delete de comprovantes |
| `council-document.controller.ts` | upload, download, delete de atas |
| `user.controller.ts` | upload/delete de logo da organização |
| `upload.controller.ts` | upload genérico |

Remover `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` do `package.json` (pedido explícito) faz `tsc` falhar em **todos os 8**. Não existe caminho em que "alterar apenas o `library.controller.ts`" e "remover o SDK" sejam ambos verdadeiros e o projeto compile. Além disso, o HTTP 401 do R2 atinge igualmente os 8 — corrigir só a Biblioteca deixaria anexo de mensagem, anexo de tarefa, documento de processo e comprovante financeiro ainda quebrados.

**Decisão**: migrar os 8, através de um serviço de armazenamento compartilhado. Isso na prática *reduz* o trabalho por controller (cada um passa a chamar 3 funções em vez de montar comandos do SDK) e é a única leitura que satisfaz o objetivo declarado de abandonar o R2.

### Achado 2 — Notificações têm 3 permissões fantasma, não 1

`src/routes/notification.routes.ts` referencia `notifications:read` (linha 11), `notifications:write` (12–14) e `notifications:manage` (15–16). Grep confirma que **nenhuma das três** existe em `src/constants/permissions.ts`. Terceira ocorrência do mesmo padrão neste projeto (Épico 1: `workspaces:*`/`tasks:read`; Épico 2: `communication:read`). Adicionar só `notifications:read` corrigiria a listagem e deixaria marcar-como-lida e excluir ainda em 403.

Nota sobre alcance da correção: `sync-admin-role-permissions.ts` atualiza **apenas o papel de sistema `admin`**. Papéis customizados existentes (confirmado no banco: `diretor_obras`, 42 permissões) não recebem as chaves novas. Isso é intencional e está registrado como premissa na spec — mexer em papéis que o cliente configurou à mão é decisão do administrador, não do deploy.

### Achado 3 — Não existe constraint de unicidade para o número do Ato Normativo

`model OfficialDocument` tem apenas `@@index([organizationId, documentCategory, year])` e `@@index([organizationId, status])` — **nenhum `@@unique`** envolvendo `sequenceNumber`. Uma verificação puramente por `findFirst` antes do `create` (como pedido) é suscetível a corrida: duas requisições simultâneas podem ambas passar na checagem e ambas gravar. A História 3 exige unicidade real (FR-011), então a checagem em consulta precisa ser acompanhada de uma garantia no banco.

Detalhe adicional: `numberingType` hoje é o enum `SEQUENTIAL | RANDOM`. Um ato com número digitado não é nenhum dos dois — gravar `SEQUENTIAL` seria registrar um dado falso sobre a origem do número.

### Achado 4 — A URL de download precisa ser absoluta

`LibraryPage.tsx:109` faz `const { url } = await libraryService.download(id)` e atribui a um `<a href>`. Hoje o R2 devolve URL absoluta. Se o backend passar a devolver `/uploads/arquivo.pdf`, o navegador resolveria contra a origem do **frontend** (`localhost:5173`), não do backend (`localhost:3000`) — o download quebraria silenciosamente. A URL devolvida precisa ser absoluta, montada a partir de uma base configurável.

## Technical Context

**Backend**: Fastify 5, TypeScript (ESM, `.js` nos imports), Prisma 6.19 + Postgres 16, Zod 3.25. `@fastify/multipart` já registrado com limite de 50 MB (`src/config/plugins.ts:133`). **`@fastify/static@^9.0.0` já consta no `package.json` (linha 41) mas não está registrado** — não é preciso instalar nada.

**Frontend**: React 19 + Vite, `VITE_API_URL="http://localhost:3000"` já configurado.

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First / Zero Cloud Credentials | **Melhora** | Esta é a mudança que finalmente torna o princípio verdadeiro na prática — hoje qualquer fluxo com arquivo exige credencial R2 real. |
| II. Supabase Prohibition | Sim | Não aplicável. |
| III. Municipal Domain Integrity | **Melhora** | Numeração manual de ato normativo corrige um dado com peso legal que hoje é inventado pelo sistema. |
| IV. Multi-Tenant & Module-Gated | Sim | Caminho em disco segmentado por `organizationId`, preservando o isolamento já existente nas chaves do R2. |
| V. Spec-Driven Development | Sim | Fluxo Spec Kit seguido. |
| VI. Environment & Security Baseline | Atenção | Servir `uploads/` estaticamente expõe os arquivos por URL não autenticada a quem souber o caminho. Ver Decisão 3. |

Nenhuma violação bloqueante. O ponto do Princípio VI é tratado explicitamente abaixo, não ignorado.

## Architecture Decisions

1. **Um serviço de armazenamento compartilhado (`src/services/storage.service.ts`) substitui `src/lib/r2.ts`.** Expõe três funções — `saveFile(buffer, { organizationId, scope, originalName })`, `getFileUrl(fileKey)`, `deleteFile(fileKey)` — mantendo o conceito de `fileKey` (`organizations/<orgId>/<scope>/<nome-gerado>`) que os 8 controllers já usam e já persistem no banco. Isso é deliberado: **nenhuma coluna do banco muda de significado**, e a migração de cada controller vira substituição mecânica de 3 chamadas. `src/lib/r2.ts` é removido; `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` saem do `package.json`.

2. **`@fastify/static` registrado com `prefix: '/uploads/'`**, apontando para a pasta `uploads/` na raiz do backend, criada no boot se não existir (`fs.mkdirSync(..., { recursive: true })`). Um único registro cobre os 8 módulos.

3. **Ponto de atenção de segurança, declarado e não escondido**: servir `uploads/` como estático torna todo arquivo acessível por URL sem autenticação — inclusive documentos de Biblioteca com nível de sigilo (`accessLevel`), cuja checagem hoje acontece no endpoint de download. O nome do arquivo em disco é aleatório (16 hex chars via `crypto.randomBytes(8)`), o que torna a URL impossível de adivinhar na prática, mas isso é *segurança por obscuridade*, não controle de acesso. Como o pedido é explícito ("servir a pasta uploads/ publicamente") e o alvo declarado é desenvolvimento local, seguimos com o estático — **registrando aqui que, antes de qualquer uso com dado real de prefeitura, o acesso a arquivos sigilosos deve voltar a passar por um endpoint autenticado.** Isso entra no registro de dívida técnica em `docs/TechStack.md`.

4. **URL de download absoluta**, montada como `${config.app.baseUrl}/uploads/<fileKey>` a partir de uma variável já existente ou nova (`APP_BASE_URL`, default `http://localhost:3000`). Evita o bug silencioso de resolução de origem descrito no Achado 4. Os controllers continuam devolvendo o mesmo formato de resposta (`{ url, fileName, fileSize }`), então **nenhuma mudança é necessária no frontend** para os fluxos de download.

5. **`downloadZip` da Biblioteca passa a ler do disco** (`fs.createReadStream`) em vez de `GetObjectCommand` + `transformToByteArray()`. Simplifica o código e preserva a proteção contra Zip Slip já existente (`path.basename`).

6. **Novo valor `MANUAL` no enum `OfficialDocumentNumberingType`**, via migration Prisma aditiva. Um ato com número digitado pelo usuário não é `SEQUENTIAL` nem `RANDOM`; gravar um desses seria registrar informação falsa sobre a procedência de um número oficial (Princípio III). Migration puramente aditiva — nenhum registro existente muda.

7. **Unicidade do Ato Normativo garantida em duas camadas.** (a) A verificação por consulta pedida no relato (`findFirst` antes do `create`) produz a mensagem exata exigida — `Já tem outra lei/documento com esse numero existente.` — que é o que o usuário vê. (b) Um índice único parcial no banco (`@@unique([organizationId, documentCategory, sequenceNumber, year])`, aplicável apenas quando `documentCategory = 'NORMATIVO'`) garante FR-011 sob concorrência; a violação (`P2002`) é capturada e traduzida para a **mesma** mensagem, de modo que o usuário nunca vê um erro técnico. Como Prisma não expressa índice único parcial declarativamente, o índice é criado por SQL bruto dentro da migration (`CREATE UNIQUE INDEX ... WHERE document_category = 'NORMATIVO'`). Escolhi índice parcial em vez de total porque documentos de Comunicação legitimamente repetem `sequenceNumber` entre setores diferentes — um índice total quebraria o fluxo de Comunicação existente.

8. **Zeros à esquerda normalizados na entrada.** "Número da Lei/Ato" é recebido como número inteiro (`z.coerce.number().int().positive()`), o que faz "007" e "7" convergirem para o mesmo valor antes de qualquer comparação — resolvendo o edge case sem lógica extra. `sequenceNumber` já é `Int?` no schema, então isso apenas alinha a entrada ao tipo já armazenado.

9. **Ramificação por categoria no `generate()`**, não um endpoint novo. O controller já ramifica em `isNormativo`; a mudança troca o bloco que consulta `sequenceControl` por leitura dos campos manuais, e mantém intacto todo o caminho de Comunicação (incluindo o `withSerializableRetry` do Épico 1). O formatador `buildFormattedNumber` já produz `TIPO Nº 007/2026` para normativos sem sufixo de setor — continua servindo sem alteração.

## Project Structure

**Backend** (`SIMP-BACKEND/`):
- `src/services/storage.service.ts` — **novo**, substitui `src/lib/r2.ts` (**removido**)
- `src/config/plugins.ts` — registro do `@fastify/static`
- `src/config/config.ts` — `APP_BASE_URL`; remoção do bloco `r2`
- 8 controllers — substituição das chamadas do SDK pelas do serviço
- `src/constants/permissions.ts` — categoria `notifications` (`read`/`write`/`manage`)
- `src/controllers/protocol.controller.ts` + `generateSchema` — numeração manual e checagem de duplicata
- `prisma/schema.prisma` + nova migration — enum `MANUAL` e índice único parcial
- `package.json` — remoção dos dois pacotes AWS
- `.gitignore` — `uploads/`
- `.env.example` — `APP_BASE_URL`, remoção das `R2_*`
- `docs/TechStack.md` §11 — registro da dívida técnica da Decisão 3

**Frontend** (`SIMP-FRONTEND/src/`):
- `pages/protocolos/GenerateProtocolModal.tsx` — campos "Número da Lei/Ato" e "Ano" para Ato Normativo
- `lib/api/protocols.ts` — DTO com os campos novos

Nenhuma mudança de frontend é necessária para o armazenamento local (Decisão 4).

## Complexity Tracking

Nenhuma exceção à Constituição necessária. O ponto do Princípio VI (Decisão 3) é um risco aceito conscientemente para desenvolvimento local, com remediação registrada como dívida técnica — não uma violação silenciosa.
