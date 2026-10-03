---
name: simp-auditoria
description: Use ao gravar trilha de auditoria no backend do SIMP — toda escrita do Frotas, download de PDF, visualização de foto de cupom, geração de relatório. Cobre auditLedgerService.record dentro da transação, nomes de ação em UPPER_SNAKE e mascaramento de CPF/CNH.
---

# Auditoria via `auditLedgerService`

A trilha é `AuditLog`, gravada pela interface `LedgerAdapter` (`src/services/audit-ledger.service.ts`), que só expõe `record`/`query`. Um trigger de banco (`prisma/sql/002-immutable-audit.sql`) bloqueia UPDATE/DELETE. O ponto de entrada é `auditLedgerService.record(...)` — nunca `prisma.auditLog.create` direto.

## Comportamento de `record(data, tx?)` (decisões D3 e D8)

Implementado no pré-requisito da TASK 1. `tx` é opcional e as chamadas sem ele não mudaram.

| | Sem `tx` (módulos existentes) | Com `tx` (Frotas: sempre) |
| --- | --- | --- |
| Onde grava | `prisma` global, fora de transação | `tx.auditLog.create`, dentro da transação do chamador |
| Se a gravação falha | erro engolido e logado | **erro propagado**: o `$transaction` desfaz a operação inteira |
| `ENABLE_AUDIT_LOGS` desligado (D8) | não grava, em silêncio | não grava, a operação segue **e** sai `logger.warn` + evento `warning` no Sentry só com `action` e `resource` |
| Driver `qldb` | falha logada, não propagada | recusa `tx` com erro explícito (QLDB não participa de transação do Postgres) |

A D8 explica por que o kill switch prevalece sobre a D3: **falha** de auditoria derruba a operação, mas **desligar a trilha de propósito** não derruba. Atenção: hoje `ENABLE_AUDIT_LOGS=false` não desliga nada por causa do `z.coerce.boolean()` (ver `docs/issues/config-boolean-flags.md`).

Testes de referência: `src/test/audit-ledger.service.spec.ts` (unitário) e `src/tests/audit-ledger-transaction.e2e.spec.ts` (rollback contra Postgres real, com a falha provocada por chave estrangeira inválida).

## Passos

1. **Não grave auditoria do Frotas sem `tx`**, nem "por enquanto". Também não chame `prisma.auditLog.create` direto: o caminho sem `tx` engole erros e não serve como prova.
2. **Chamar dentro da transação**, depois da escrita, com o estado relevante:
   ```ts
   await prisma.$transaction(async tx => {
     const updated = await tx.fleetFueling.update({ /* ... */ })
     await auditLedgerService.record({
       userId: scope.userId,
       organizationId: scope.organizationId,
       action: 'FLEET_AUTHORIZATION_ISSUED',
       resource: 'FLEET_FUELING',
       resourceId: updated.id,
       ip: request.ip,
       userAgent: request.headers['user-agent'],
       details: { number: updated.formattedNumber, vehicleId: updated.vehicleId, reason: null },
     }, tx)
   })
   ```
   Campos de `AuditRecord` hoje: `userId`, `action`, `resource`, `resourceId`, `ip`, `userAgent`, `organizationId`, `details` (vai para `metadata`), `success`, `errorMessage`. `before`/`after`/`reason`/`requestId` da spec entram em `details`.
3. **Nome da ação em `UPPER_SNAKE`**, prefixo do domínio: `FLEET_VEHICLE_CREATED`, `FLEET_AUTHORIZATION_ISSUED`, `FLEET_AUTHORIZATION_CANCELLED`, `FLEET_PLATE_MISMATCH`, `FLEET_AUTHORIZATION_BLOCKED`, `FLEET_REDEEM_SUBMITTED`, `FLEET_RECEIPT_VIEWED`, `FLEET_PDF_DOWNLOADED`. Não usar `fleet.auth.issued` (spec) nem minúsculas (`user_created`, legado). `resource` também em `UPPER_SNAKE` (`FLEET_FUELING`, como `DAILY_ALLOWANCE`).
4. **Mascarar dados sensíveis** antes de pôr em `details`: CPF como `***.456.789-**`, CNH só os 4 últimos dígitos, nunca o token do QR (nem o hash dele), foto só como `sha256`. Nome de quem emitiu: usar `anonymizeUserName` (`src/utils/lgpd-anonymizer.util.ts`) como as Diárias fazem; ver as demais funções desse arquivo antes de escrever máscara nova.
5. **Rota pública** (frentista): `userId: null`, `details.actor = 'public:redeem'`, `ip` e `userAgent` sempre preenchidos.
6. **Motivo obrigatório** em cancelamento, liberação de bloqueio e estorno: validar no Zod e gravar em `details.reason`.
7. **Leitura também é auditada** no Frotas: download de PDF, visualização de foto e geração de relatório (TASK 6, "Acesso").

## Checklist

- [ ] Nenhuma auditoria do Frotas sem `tx` nem por `prisma.auditLog.create` direto
- [ ] Toda escrita do Frotas chama `record(..., tx)` dentro da mesma `$transaction`
- [ ] Ação e resource em `UPPER_SNAKE` com prefixo `FLEET_`
- [ ] CPF/CNH mascarados; token do QR ausente; foto só como hash
- [ ] `reason` presente onde a TASK 6 exige
- [ ] e2e confere a linha em `AuditLog` para o caminho feliz e que a operação é desfeita se a auditoria falhar
