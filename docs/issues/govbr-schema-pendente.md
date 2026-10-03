# Schema da assinatura gov.br: remoção pendente

2026-10-03 · aberto · **entra na primeira migration depois do baseline (TASK 0, decisão D5 em `docs/frotas/decisoes.md`)**

## Contexto

O código da assinatura gov.br foi removido em 2026-10-03 (decisão D9): controller `govbr-signing.controller.ts`, rotas `/councils/sign/*`, job `cleanup-govbr-states`, variáveis `GOVBR_*` e `USE_MOCK_GOVBR`, permissão `councils:sign` e dependência `node-signpdf`. A integração real nunca funcionou contra a API do ITI, e só o mock era exercitado. Enquanto existiu, `USE_MOCK_GOVBR=false` não desligava o mock (bug do `z.coerce.boolean()`, ver `config-boolean-flags.md`).

O **schema** ficou de propósito: hoje o banco só muda por `db push`, e o histórico de migrations está defasado (TASK 0). Remover models agora geraria uma migration impossível de aplicar sem o baseline.

## O que continua no schema (sem nenhum código lendo ou escrevendo, exceto o seed)

| Item | Onde | Tabela/tipo no banco |
| --- | --- | --- |
| `model SignatureRequest` | `prisma/schema.prisma` | `signature_requests` |
| `model GovBrOAuthState` | `prisma/schema.prisma` | `govbr_oauth_states` |
| `enum SignatureStatus` (`PENDENTE`, `ASSINADO`, `FALHOU`, `EXPIRADO`) | `prisma/schema.prisma` | tipo `"SignatureStatus"` |
| Relação `signatureRequests` | `model Organization` | — |
| Relação `signatureRequests` (`"SignatureRequester"`) | `model User` | — |
| Relação `signatureRequests` | `model CouncilDocument` | — |

## Na mesma migration (e no mesmo PR)

1. Remover os dois models, o enum e as três relações acima de `prisma/schema.prisma`.
2. Gerar com `npx prisma migrate dev --create-only --name remove_govbr_signature` e revisar o SQL: `DROP TABLE "signature_requests"`, `DROP TABLE "govbr_oauth_states"` e `DROP TYPE "SignatureStatus"`, nessa ordem.
3. Remover de `prisma/seeds/seed.ts` as duas limpezas que ainda tocam essas tabelas: `prisma.signatureRequest.deleteMany()` e `prisma.govBrOAuthState.deleteMany()`.
4. **Antes de aplicar em produção:** conferir se há linhas. Pelo bug acima, qualquer `ASSINADO` existente é mock (`pkcs7_data = 'MOCK_PKCS7_SIGNATURE_DATA'`), não uma assinatura real. Decidir com o Marllon se vale exportar essas linhas antes do drop.
   ```sql
   SELECT status, (pkcs7_data = 'MOCK_PKCS7_SIGNATURE_DATA') AS mock, count(*)
   FROM signature_requests GROUP BY 1, 2;
   ```

## Não precisa de migration, mas pode ser limpo

- **`councils:sign` em roles existentes.** O backend ignora essa string: `Role.permissions` é `Json` sem validação contra o catálogo, `checkPermission` só testa se a permissão exigida pela rota está no conjunto, e nenhuma rota exige mais `councils:sign`. O editor de roles do frontend preserva a string ao salvar (sem checkbox para ela). A role global `admin` perde a permissão sozinha na próxima chamada de `ensureAdminRole`. Para limpar as demais, se quiser:
  ```sql
  UPDATE roles
  SET permissions = (SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
                     FROM jsonb_array_elements(permissions::jsonb) p
                     WHERE p <> '"councils:sign"'::jsonb)
  WHERE permissions::jsonb ? 'councils:sign';
  ```
- **`buildTrustedRedirect`** (`src/utils/url-security.ts`) ficou sem chamador; o `sanitizeRedirectTarget` que ele usa continua coberto por testes. Manter ou remover junto.
- **`.specify/memory/constitution.md`** ainda cita `USE_MOCK_GOVBR` e o controller removido; atualizar quando a constituição for revisada.
