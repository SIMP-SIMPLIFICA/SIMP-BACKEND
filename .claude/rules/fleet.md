---
paths:
  - "src/**/*fleet*"
  - "src/**/fleet*/**"
---

# Regras do módulo Frotas (backend)

Valem para todo arquivo do Frotas em `src/` (camadas: `routes/`, `controllers/`, `services/`, `schemas/`, `jobs/`, `tests/`). Decisões que se sobrepõem à spec: `docs/frotas/decisoes.md`.

## Rota pública do frentista (`/api/v1/public/fleet/redeem/*`)

1. **Token do QR só como hash.** Gerar com `randomBytes(16).toString('base64url')` (128 bits), gravar só `sha256` em hex (`redeemTokenHash @unique`), buscar sempre pelo hash. O token nunca vai para banco, log, auditoria, Sentry nem resposta de erro; aparece só no PDF.
2. **Uso único garantido pelo banco, não pela aplicação.** `FleetFuelingRedemption.fuelingId @unique` + transição condicional (`updateMany({ where: { id, lifecycle: 'OPEN' } })` ou `SELECT … FOR UPDATE`) na mesma transação. Segundo envio → 409. Checagem prévia em memória ("já existe?") não conta como garantia.
3. **Bloqueio na 3ª placa errada contado no banco.** `plateAttempts` incrementado dentro da transação com a linha travada; ao chegar em 3 → `BLOCKED`, libera a reserva e notifica o emissor. Nunca contar em cookie, sessão, memória ou Redis — trocar de celular não pode zerar o contador. A resposta não diferencia "não existe" de "expirado".
4. Rate limit por `request.ip` (padrão de `src/routes/document-validation.routes.ts`: `config.rateLimit`). Sem `authMiddleware` nessa rota; sem CPF na resposta (motorista só pelo nome).

## Dados sensíveis

5. **CPF e nº da CNH cifrados em repouso:** AES-256-GCM no campo (`cpfEncrypted`), busca por `cpfBlindIndex` (HMAC-SHA-256 com chave separada). Chaves só por variável de ambiente validada em `src/config/config.ts` — nunca no repositório (adicionar o nome em `.env.example`, sem valor). CPF/CNH mascarados em PDF, log e auditoria.
6. **RLS nas tabelas `fleet_*`:** decisão a tomar na **TASK 2** (hoje nenhuma tabela do SIMP tem RLS). Até lá, o filtro por `organizationId` no service é a única barreira — toda query do Frotas filtra por ele, inclusive `findUnique` (use `findFirst({ where: { id, organizationId } })`).

## Padrões do Frotas (decisões D2–D4)

7. Dinheiro `Decimal(15,2)`, litros `Decimal(10,3)`, preço unitário `Decimal(10,4)`; conta só com `Prisma.Decimal`.
8. Toda escrita: `auditLedgerService.record(data, tx)` dentro da transação, ação `FLEET_*` em `UPPER_SNAKE`; falha de auditoria derruba a operação. Skill `simp-auditoria`.
9. Erros de negócio: `FleetError(code, message, details?)` + `STATUS_BY_CODE` no controller; Zod `.strict()` em toda rota; `P2002` de `nfceKey` vira `409 RECEIPT_ALREADY_USED`, nunca o texto do Prisma.
10. Documento emitido (autorização, OS, diário de bordo) segue a skill `simp-documento-oficial`; o que avança depois da emissão é `lifecycle`, nunca o PDF/hash.
11. Toda rota nova tem e2e com duas organizações e com o módulo desligado (skill `simp-teste-e2e`).
