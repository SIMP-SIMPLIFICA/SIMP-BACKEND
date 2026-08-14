---
description: "Implementation plan for feature: Épico 3 — Documentos compartilhados entre Convênios e Processos Virtuais"
---

# Implementation Plan: Documentos compartilhados entre Convênios e Processos Virtuais

**Input**: `.specify/specs/epic3-covenants-processes-docs.md`

## Summary

O pedido descreve quatro frentes; a investigação mostrou que **duas já estão prontas** e uma terceira está pela metade. O trabalho real se concentra em uma coluna nova, uma regra de validação e a normalização de dois formatos de documento na leitura.

### O que já existe (verificado)

| Item | Estado | Evidência |
|---|---|---|
| Relação N:N Convênio ↔ Processo | ✅ **completa e funcional** | `Covenant.virtualProcesses` ↔ `VirtualProcess.covenants`; tabela `_CovenantToVirtualProcess` confirmada no banco com FKs e índices |
| `LibraryDocument.covenantId` | ✅ existe, com índice | `schema.prisma:770`, `@@index([covenantId])` |
| Aba Documentos do convênio mesclando duas fontes | ⚠️ **parcial** — já mescla, mas em lista plana | `CovenantDetailSheet.tsx:501-509` |
| Upload de convênio | ⚠️ usa `libraryService.upload(formData, covenantId)` | `CovenantDetailSheet.tsx:522` |
| `LibraryDocument.virtualProcessId` | ❌ **não existe** | — |
| Documentos de convênio na aba do processo | ❌ **não existe** | `getProcessDetails` só inclui `documents` (VirtualProcessDocument) |

**Conclusão de escopo**: nenhuma migration de relacionamento. A única mudança de schema é uma coluna opcional (`virtualProcessId`) em `LibraryDocument`.

### O problema central: dois modelos de documento com formatos diferentes

| | `LibraryDocument` (convênio) | `VirtualProcessDocument` (processo) |
|---|---|---|
| id | `nanoid()` | `uuid()` |
| arquivo | `fileKey` | `fileUrl` |
| nome | `title` + `fileName` | `fileName` |
| classificação | `accessLevel` (sigilo), `categoryId` | `tag`, `description` |
| download | `GET /api/v1/library/:id/download` | `GET /virtual-processes/:id/documents/:docId/download` |
| exclusão | `library:delete` | dono do processo, janela de 24h |

As duas telas precisam mostrar os dois juntos. Unificar os modelos seria uma refatoração de grande porte (migração de dados, impacto em Biblioteca, Conselhos e Processos) — fora de escopo. A saída é **normalizar na leitura**, mantendo o armazenamento como está.

## Technical Context

**Backend**: Fastify 5, Prisma 6.19 + Postgres 16, Zod 3.25. Upload de convênio hoje passa pelo `library.controller.ts::upload`, que já lê `covenantId` dos campos multipart.

**Frontend**: React 19, TanStack Query 5. `CovenantDetailSheet.tsx` já carrega `libraryService.list({ covenantId })` e `covenant.virtualProcesses[].documents`.

**Migration**: `prisma migrate dev` segue bloqueado (drift P3006, registrado em `docs/TechStack.md`). Uso `db push` — a coluna é opcional e aditiva, sem risco para dado existente.

## Constitution Check

| Princípio | Conformidade | Nota |
|---|---|---|
| I. Local-First | Sim | Sem dependência nova; arquivos seguem no storage local. |
| II. Supabase Prohibition | Sim | Não aplicável. |
| III. Municipal Domain Integrity | **Atenção** | Documento de convênio é acervo com valor legal — daí a Decisão 6 (exclusão permanece na tela de origem) e a Decisão 4 (nível de sigilo preservado). |
| IV. Multi-Tenant & Module-Gated | Sim | Consultas herdam o `orgFilter` existente. |
| V. Spec-Driven Development | Sim | Fluxo Spec Kit seguido. |
| VI. Environment & Security Baseline | Sim | Sem variável nova; validação server-side em FR-005. |

Nenhuma violação.

## Architecture Decisions

1. **Uma única mudança de schema**: `virtualProcessId String? @map("virtual_process_id")` em `LibraryDocument`, com relação opcional para `VirtualProcess`, `onDelete: SetNull` e `@@index([virtualProcessId])`.

   `SetNull` (e não `Cascade`) é deliberado: excluir um processo **não pode apagar** um documento do acervo do convênio — o arquivo apenas volta a ser "geral do convênio". Isso responde ao Edge Case de exclusão de processo, e é a escolha conservadora para documento com valor legal.

2. **Validação server-side do vínculo** (FR-005): antes de gravar, o backend confirma que o `virtualProcessId` informado está de fato entre os processos vinculados àquele convênio. A interface já vai oferecer só os corretos, mas a regra precisa existir no servidor — a interface não é fronteira de segurança.

3. **Normalização na leitura, não no armazenamento.** O backend passa a devolver, junto do processo, os documentos de convênio atribuídos a ele, marcados com uma origem (`source: 'covenant' | 'process'`). O frontend consome uma forma unificada mínima: `{ id, fileName, uploadedAt, source, downloadUrl }`. Cada tela mantém suas próprias ações conforme a origem.

   Alternativa descartada: unificar os dois modelos em um só — migração de dados e reescrita de quatro módulos, desproporcional ao ganho aqui.

4. **Nível de sigilo preservado ao atravessar a tela** (FR-008): documentos de convênio carregam `accessLevel`, cuja checagem hoje vive no endpoint de download da Biblioteca. Ao exibi-los na tela do processo, o **download continua passando pelo endpoint da Biblioteca** — não por um atalho novo no controller de processos. Assim a regra de sigilo é aplicada uma vez só, no lugar onde já existe, sem uma segunda implementação para divergir.

5. **Agrupamento calculado no frontend, a partir de `covenant.virtualProcesses`.** A aba do convênio já recebe os processos vinculados com seus documentos; basta distribuir os `LibraryDocument` nos baldes por `virtualProcessId` e juntar, em cada balde, os `VirtualProcessDocument` daquele processo (FR-009 e o cenário 4 da História 2). Sobra o balde "Gerais". Não exige endpoint novo nem consulta adicional — o dado já está na tela.

6. **A gestão (excluir) permanece na tela de origem.** A aba do processo exibe os documentos do convênio como leitura + download, sem botão de excluir. Motivo: o dono do processo apagaria acervo do convênio sem perceber, e as regras de exclusão dos dois modelos são diferentes (permissão `library:delete` vs. janela de 24h do processo). Misturá-las numa tela só produziria comportamento imprevisível.

7. **Reaproveitar o upload da Biblioteca**, apenas aceitando mais um campo multipart (`virtualProcessId`), em vez de criar uma rota de upload própria para convênios. O caminho já existe e funciona; uma rota paralela seria uma segunda porta para o mesmo efeito — e duas portas divergem com o tempo (foi exatamente o que causou o vazamento do módulo de Comunicação no Épico 1).

8. **Select de processo condicional** (FR-011): renderizado apenas quando `covenant.virtualProcesses.length > 0`. Cada opção exibe "Processo nº X — Secretaria — Objeto", o mesmo texto do cabeçalho dos blocos, para que a escolha no upload e o resultado na tela usem a mesma identificação.

## Project Structure

**Banco** (`SIMP-BACKEND/prisma/`):
- `schema.prisma` — `virtualProcessId` opcional em `LibraryDocument` (+ relação inversa em `VirtualProcess`)
- Aplicação via `prisma db push`

**Backend** (`SIMP-BACKEND/src/`):
- `controllers/library.controller.ts` — aceitar `virtualProcessId` no upload + validar o vínculo com o convênio
- `controllers/virtual-process.controller.ts` — `getProcessDetails` passa a incluir os `LibraryDocument` atribuídos ao processo, com marcação de origem

**Frontend** (`SIMP-FRONTEND/src/`):
- `lib/api/library.ts` — `upload` aceita `virtualProcessId`
- `pages/convenios/CovenantDetailSheet.tsx` — agrupamento por processo + Select no upload
- `pages/processos-virtuais/ProcessosVirtuais.tsx` — aba Documentos exibindo as duas origens com indicação de procedência

## Complexity Tracking

Nenhuma exceção à Constituição necessária.
