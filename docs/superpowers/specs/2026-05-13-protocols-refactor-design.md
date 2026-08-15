# Design Spec: Refatoração Completa de Protocolos
**Data:** 2026-05-13  
**Status:** APROVADO  
**Repos afetados:** SIMP-BACKEND, SIMP-FRONTEND

---

## Contexto e Motivação

O módulo de protocolos precisa de três evoluções simultâneas:

1. **Motor de sequência mais granular** — a fila de numeração deve ser isolada por departamento real (FK), não por código de setor em string.
2. **UX da tabela poluída** — ações inline (Emitir, Cancelar) congestionam a tabela; detalhes e ações devem viver num painel lateral.
3. **Filtros de extrato** — o usuário precisa filtrar por mês (server-side) e imprimir o extrato resultante.

---

## Decisões Arquiteturais (resultado das 3 perguntas de design)

| # | Questão | Decisão |
|---|---------|---------|
| Q1 | NORMATIVO sem departamento | `departmentId = null`; `sector = 'CENTRAL'` como snapshot imutável |
| Q2 | Campo `sector` vs `departmentId` | **Opção B — snapshot + FK viva**: `sector` congelado no momento da criação; `departmentId` FK viva para filtros e permissões |
| Q3 | Filtro de mês | **Server-side**: `month?` na query string → range `createdAt` no Prisma |

---

## FASE 1 — Backend (SIMP-BACKEND)

### 1.1 Schema Prisma

**`OfficialDocument`** — adicionar campo:
```prisma
departmentId String? @map("department_id")
department   Department? @relation(fields: [departmentId], references: [id], onDelete: SetNull)
```
`sector` permanece como snapshot string imutável.

**`SequenceControl`** — mudanças no unique:
- Remover `documentCategory` da chave única.
- Nova chave: `@@unique([organizationId, sector, documentType, year])`.
- Adicionar campo `departmentId String? @map("department_id")` para auditoria (sem ser parte da chave).
- Nota: `sector` permanece not-null (NORMATIVO usa `'CENTRAL'`), o que resolve o problema de `NULL ≠ NULL` do PostgreSQL em unique constraints.

**`Department`** — adicionar relação reversa:
```prisma
officialDocuments OfficialDocument[]
```

### 1.2 `protocol.controller.ts`

**`generate()`:**
- Schema: troca `sector: z.string()` por `departmentId: z.string().uuid().optional()`.
- Lógica COMUNICACAO: valida que `departmentId` existe e pertence à org → extrai `dept.code` → usa como `sector` snapshot.
- Lógica NORMATIVO: `departmentId = undefined` (fica null no banco); `sector = 'CENTRAL'`.
- Validação: NORMATIVO → `numberingType` é forçado para `SEQUENTIAL` (nunca RANDOM).
- Salva `departmentId` no `OfficialDocument`.

**`list()`:**
- Adicionar `month: z.coerce.number().int().min(1).max(12).optional()` no `listQuerySchema`.
- Quando `month` presente: `createdAt: { gte: new Date(year, month-1, 1), lt: new Date(year, month, 1) }`.
- Shared inbox: troca `where.sector = deptCode` por `where.departmentId = dept.id`.

**Sem mudança em:** `updateStatus()`, `delete()`, `getSequences()`.

### 1.3 Migration Strategy

- `db:push` em dev (sem migration nomeada).
- Dados existentes: `departmentId = null` em todos os registros antigos (retrocompatível).
- `SequenceControl` existente: nova chave é subset da antiga (sem `documentCategory`). Caso haja duplicatas entre categorias no mesmo setor, será irrelevante pois o `sector` já as diferencia.

---

## FASE 2 — Frontend UX (SIMP-FRONTEND)

### 2.1 `OfficialProtocolsPage.tsx`

**Tabela — limpeza visual:**
- Coluna Assunto: `<p className="line-clamp-1 max-w-[180px] text-sm text-slate-700">`.
- Remover `recipient` inline da coluna Assunto.
- Coluna Ações: apenas `<Button variant="ghost">` com `<Eye>` + "Visualizar". Remover botões Emitir e Cancelar desta coluna.

**Filtros — adições:**
- `<Select>` de mês (0 = "Todos os meses", 1–12 = Jan–Dez). Quando selecionado, envia `month` para `useProtocols`.
- Botão `<Button variant="outline">` com ícone `<Printer>` e texto "Imprimir Extrato" — chama `window.print()`.

**Print CSS (inline `<style>` ou classe `print:`):**
```css
@media print {
  /* Ocultar: nav, sidebar, header da página, filtros, paginação, botões de ação */
  /* Mostrar: título do extrato com período (ex: "Extrato de Protocolos — Maio/2026"), tabela completa */
}
```

**State:** adicionar `monthFilter: number` (0 = todos).

### 2.2 Novo `ProtocolViewSheet.tsx`

Substitui `ProtocolDetailsDialog.tsx` (que pode ser removido ou mantido como fallback).

**Estrutura:**
```tsx
<Sheet open={!!doc} onOpenChange={v => !v && onClose()}>
  <SheetContent side="right" className="w-[480px] sm:max-w-lg flex flex-col p-0">
    <SheetHeader className="px-6 pt-6 pb-4 border-b">
      <SheetTitle className="font-mono">{doc.formattedNumber}</SheetTitle>
      <p className="text-xs text-slate-400">{doc.documentType}</p>
    </SheetHeader>
    <ScrollArea className="flex-1">
      {/* Campos: Status, Categoria, Setor, Criado por, Data, Destinatário completo, Assunto completo */}
    </ScrollArea>
    <div className="px-6 py-4 border-t flex flex-col gap-2">
      {/* Ações contextuais */}
    </div>
  </SheetContent>
</Sheet>
```

**Ações no sheet (condicionais):**
- `Baixar PDF`: visível se `doc.libraryDocumentId`.
- `Marcar como Emitido`: visível se `canAct && doc.status === 'RESERVADO'`.
- `Cancelar Documento`: visível se `canAct && doc.status !== 'CANCELADO'`.

### 2.3 `GenerateProtocolModal.tsx`

- `FormState.sector: string` → `FormState.departmentId: string`.
- `SelectItem value={d.code}` → `value={d.id}`.
- Submit: `{ departmentId: form.departmentId }` em vez de `{ sector: form.sector }`.
- NORMATIVO: não envia `departmentId` (undefined).

### 2.4 `protocols.ts`

- `OfficialDocument`: adicionar `departmentId: string | null`.
- `GenerateDocumentDTO`: troca `sector: string` por `departmentId?: string`.
- Params do `list`: adicionar `month?: number`.

---

## Edge Cases e Compatibilidade Retroativa

**Shared inbox com dados históricos:** Documentos criados antes da migração têm `departmentId = null`. O filtro da shared inbox deve usar `OR` para incluir ambos:
```typescript
where.OR = [
  { departmentId: dept.id },
  { departmentId: null, sector: dept.code }, // docs legados
]
```

**Conflito de código 'CENTRAL':** Se existir um departamento com `code = 'CENTRAL'`, sua fila de sequência colidiria com normativos. Adicionar validação na criação de departamento: código 'CENTRAL' é reservado.

**`SequenceControl` unique key migration:** A nova chave `[organizationId, sector, documentType, year]` remove `documentCategory`. Conflito só ocorre se um mesmo `(org, sector, docType, year)` tiver dois registros com categorias diferentes. Como NORMATIVO sempre usou `sector='CENTRAL'` e COMUNICACAO nunca usa 'CENTRAL' em condições normais, o risco é mínimo. Verificar antes do `db:push` em produção.

---

## Invariantes e Guardrails

| Regra | Onde enforçar |
|-------|--------------|
| NORMATIVO → sempre SEQUENTIAL | `generate()` controller: se NORMATIVO, `numberingType = 'SEQUENTIAL'` forçado |
| Número nunca volta após cancelamento | Sem mudança (não há rollback de `SequenceControl`) |
| `sector` imutável após criação | Nunca incluir `sector` em `updateStatus()` |
| `departmentId` validado na org | `generate()`: `prisma.department.findFirst({ where: { id, organizationId } })` |
| Filtro de mês só com year | Frontend: month só aparece ativo se `yearFilter` estiver selecionado |

---

## Fora de Escopo

- Migração de `departmentId` em registros históricos (fica `null` — aceitável).
- Mudança nos endpoints de `getSequences()` e `delete()`.
- Renomear `sector` no banco (campo imutável, só adicionar FK).
- Relatório de extrato como PDF gerado pelo servidor (usa `window.print()`).
