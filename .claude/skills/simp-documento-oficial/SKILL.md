---
name: simp-documento-oficial
description: Use ao implementar um documento oficial numerado e imutável (rascunho PENDING → emitido ISSUED com PDF + sha256Hash + publicId + ExportedDocument), como a autorização de abastecimento, a ordem de serviço ou o diário de bordo do Frotas. Referência viva: as Diárias (src/services/daily-allowance.service.ts).
---

# Documento oficial: PENDING → ISSUED

Uma vez emitido, o PDF e o `sha256Hash` são prova pública validável no portal. Regenerar o PDF produziria bytes diferentes e dessincronizaria o hash. Por isso a imutabilidade é imposta **no backend**.

Referência: `src/services/daily-allowance.service.ts` (`create`, `update`, `remove`, `issue`) e `src/controllers/daily-allowance.controller.ts`.

## Passos

1. **Modelo.** Campos mínimos, como `DailyAllowance`/`FleetFueling` em `prisma/schema.prisma`:
   - `publicId String @unique @default(uuid())` — vai no QR; a PK nunca vai para a internet.
   - `status` (`PENDING`/`ISSUED`), `sha256Hash String?`, `issuedAt DateTime?`, `pdfFileKey String?`, `createdById`.
   - `sequenceNumber Int`, `year Int`, `formattedNumber String` (numeração legível).
   - Snapshots textuais da dotação, se houver ficha QDD: `qddFichaSnapshot`, `qddFonteSnapshot`, `qddNaturezaSnapshot`.
   - `budgetOverrun Boolean @default(false)`.
   - Valores em `Decimal(15,2)`; litros `Decimal(10,3)`; preço unitário `Decimal(10,4)` (decisão D2).
   - Estado operacional pós-emissão (ex.: `lifecycle` da autorização) é **outro campo**: o documento não muda, o ciclo de uso avança.

2. **Numeração** sequencial por organização e ano, calculada **dentro** de uma transação `Serializable` com `withSerializableRetry` (`src/utils/serializable-retry.util.ts`) — padrão real das Diárias:
   ```ts
   const record = await withSerializableRetry(() =>
     prisma.$transaction(async tx => {
       const last = await tx.dailyAllowance.aggregate({
         where: { organizationId: scope.organizationId, year },
         _max: { sequenceNumber: true },
       })
       const sequenceNumber = (last._max.sequenceNumber ?? 0) + 1
       const formattedNumber = `${String(sequenceNumber).padStart(4, '0')}/${year}`
       return tx.dailyAllowance.create({ data: { /* ... */ sequenceNumber, year, formattedNumber } })
     }, { isolationLevel: 'Serializable' })
   )
   ```
   - `SequenceControl` (usado pela spec técnica para `FLEET_AUTH`/`FLEET_OS`/`FLEET_TRIP`) hoje é **só de Protocolos**: chave única `[organizationId, sector, documentType, year]` e `documentCategory` preso ao enum `OfficialDocumentCategory` (`src/controllers/protocol.controller.ts`). Usá-lo para o Frotas exige mudar o schema; decidir na TASK, explicitamente, entre ele e o padrão das Diárias. Numerar por departamento muda a chave em qualquer dos dois.
   - Adicionar índice único `[organizationId, year, sequenceNumber]` como garantia real sob concorrência.

3. **Rascunho mutável, emitido imutável.** `update` e `remove` recusam a partir da emissão, no service:
   ```ts
   if (current.sha256Hash) {
     throw new DailyAllowanceError('ALREADY_ISSUED', 'Esta diária já foi emitida. Baixe o documento existente.')
   }
   ```
   No Frotas, `FleetError` com o mesmo código, mapeado para 409 no `STATUS_BY_CODE`.

4. **Emissão** (`issue`), na ordem real das Diárias:
   1. Carregar com escopo (`getById(id, scope)`) e recusar se já tiver `sha256Hash`.
   2. Validar regras de emissão (ex.: justificativa de fim de semana) — no servidor, na emissão.
   3. Tirar o snapshot textual da ficha QDD.
   4. **Gerar o PDF fora da transação** (`createFormDocumentPdf` em `src/services/document-pdf.service.ts`, que devolve `{ bytes, sha256Hash }` e recebe `publicId` para o QR de validação). Montar PDF dentro da transação seguraria a conexão e esgotaria o pool.
   5. `saveFile(Buffer.from(bytes), { organizationId, scope, originalName })` (`src/services/storage.service.ts` — hoje grava em disco local).
   6. **Reivindicar a emissão atomicamente** — dois cliques simultâneos não podem gerar dois PDFs:
      ```ts
      const claimed = await tx.dailyAllowance.updateMany({
        where: { id, organizationId: scope.organizationId, sha256Hash: null },
        data: { sha256Hash, pdfFileKey, issuedAt: new Date(), status: 'ISSUED', ...snapshot },
      })
      if (claimed.count === 0) throw new DailyAllowanceError('ALREADY_ISSUED', '...')
      ```
   7. Na mesma transação, **depois** de gravar: `budgetService.detectOverrun(tx, qddItemId)` → se `true`, gravar `budgetOverrun: true`. **Não bloqueia.**
   8. Registrar `ExportedDocument`: `exportedDocumentService.register({ organizationId, documentType: EXPORTED_DOCUMENT_TYPES.X, publicId, bytes, exporterFullName })`. Tipo novo vai em `src/constants/exported-document-types.ts` (com rótulo pt-BR para o portal). Nas Diárias é efeito colateral fora da transação.
   9. Auditoria. No Frotas: `auditLedgerService.record({...}, tx)` **dentro** da transação (decisão D3; skill `simp-auditoria`). As Diárias ainda auditam fora — não copiar essa parte.

5. **Saldo QDD.** Documento que consome ficha entra como mais um termo em `budgetService.getBalancesForItems` **e** em `detectOverrun` (`src/services/budget.service.ts`) — os dois somam os consumidores separadamente; esquecer um deixa saldo e alerta divergentes. Saldo nunca é persistido.

6. **Download** sempre do arquivo original (`pdfFileKey`); nunca regenerar. Rota `GET /:id/pdf` com permissão de leitura; frontend usa `responseType: 'blob'`.

7. **Validação pública.** O QR pequeno aponta para o portal; a rota real é `GET /api/v1/public/documents/validate/:uuid` (`src/routes/document-validation.routes.ts`). A resposta nunca tem PII (nome, placa, valores).

## Checklist

- [ ] `publicId` separado da PK; nenhuma URL pública com ID sequencial ou PK
- [ ] Numeração em transação Serializable + retry + índice único
- [ ] `update`/`remove` recusam com `sha256Hash` preenchido (409), testado em e2e
- [ ] PDF gerado uma vez, fora da transação; claim por `updateMany … sha256Hash: null`
- [ ] Overrun calculado depois de gravar, na mesma transação, sem bloquear
- [ ] Termo novo em `getBalancesForItems` **e** `detectOverrun`
- [ ] `ExportedDocument` registrado; tipo novo em `exported-document-types.ts`
- [ ] Auditoria na transação (Frotas), ação `UPPER_SNAKE`
- [ ] e2e: emitir duas vezes em paralelo → um sucesso; editar emitido → 409 com hash inalterado
