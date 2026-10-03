---
name: simp-auditoria
description: Use ao gravar trilha de auditoria no backend do SIMP — toda escrita do Frotas, download de PDF, visualização de foto de cupom, geração de relatório. Cobre auditLedgerService.record dentro da transação, nomes de ação em UPPER_SNAKE e mascaramento de CPF/CNH.
---

# Auditoria via `auditLedgerService`

A trilha é `AuditLog`, gravada pela interface `LedgerAdapter` (`src/services/audit-ledger.service.ts`), que só expõe `record`/`query`. Um trigger de banco (`prisma/sql/002-immutable-audit.sql`) bloqueia UPDATE/DELETE. O ponto de entrada é `auditLedgerService.record(...)` — nunca `prisma.auditLog.create` direto.

## Estado atual × alvo (decisão D3)

| | Hoje | Alvo (pré-requisito da TASK 1) |
| --- | --- | --- |
| Assinatura | `record(data)` | `record(data, tx?)` — `tx` opcional, chamadas atuais continuam valendo |
| Transação | grava com o `prisma` global, fora de qualquer transação | com `tx`, grava em `tx.auditLog.create` dentro da transação do chamador |
| Falha | engolida e logada | sem `tx`: igual a hoje; **com `tx`: lança e derruba a operação** |
| `ENABLE_AUDIT_LOGS=false` | desliga tudo | mantido para os módulos antigos; decidir na TASK 1 se vale para o Frotas |

Enquanto o alvo não existir, **não** escrever código do Frotas que audita fora da transação "por enquanto". Implementar o alvo primeiro.

## Passos

1. **Implementar o alvo** (uma vez, na TASK 1): `LedgerAdapter.record(data, tx?)`; o `localAdapter` usa `(tx ?? prisma).auditLog.create`; o `qldbAdapter` lança se receber `tx` (QLDB não participa da transação do Postgres). Teste unitário cobrindo os dois caminhos.
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

- [ ] `record(data, tx?)` implementado e testado antes do primeiro uso no Frotas
- [ ] Toda escrita do Frotas chama `record(..., tx)` dentro da mesma `$transaction`
- [ ] Ação e resource em `UPPER_SNAKE` com prefixo `FLEET_`
- [ ] CPF/CNH mascarados; token do QR ausente; foto só como hash
- [ ] `reason` presente onde a TASK 6 exige
- [ ] e2e confere a linha em `AuditLog` para o caminho feliz e que a operação é desfeita se a auditoria falhar
