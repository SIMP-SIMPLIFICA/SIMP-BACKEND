# Flags booleanas de ambiente ignoram o valor `"false"`

2026-10-03 · aberto · **não corrigir antes de conferir os valores do `.env` de produção (Render)**

## Problema

Sete variáveis em `src/config/config.ts` usam `z.coerce.boolean()`. Esse coerce é `Boolean(valor)`, e variável de ambiente é sempre string, então:

| Valor no `.env` | Resultado hoje |
| --- | --- |
| `true` | `true` |
| `false` | **`true`** (`Boolean("false") === true`) |
| `0`, `no`, `off`, `False` | **`true`** |
| vazio (`FLAG=`) | `false` (único jeito de desligar hoje) |
| ausente | o `.default(...)` (todos são `true`) |

Na prática, **nenhuma dessas flags pode ser desligada com `false`**. O próprio projeto já conhece o problema: o teste do kill switch em `src/test/audit-ledger.service.spec.ts` mocka `config` em vez da variável justamente por isso. As flags mais novas já usam o padrão certo (`HONEYPOT_ENABLED`, `TURNSTILE_ENABLED`, linhas 76–98).

## Flags afetadas

| Linha | Flag | Lida em | O que controla | Hoje com `"false"` | Depois da correção, com `"false"` | Risco em produção |
| --- | --- | --- | --- | --- | --- | --- |
| 161 | `USE_MOCK_GOVBR` (default `true`) | `src/controllers/govbr-signing.controller.ts:26` (`IS_MOCK_GOVBR`, usado nas linhas 105 e 167) | Assinatura gov.br das atas de Conselhos: no mock, o OAuth é pulado e o `SignatureRequest` vira `ASSINADO` com `pkcs7Data: 'MOCK_PKCS7_SIGNATURE_DATA'` | **Mock continua ligado**: documentos marcados como assinados sem assinatura real | Fluxo real do gov.br; exige `GOVBR_CLIENT_ID`, `GOVBR_CLIENT_SECRET`, `GOVBR_REDIRECT_URI`, `GOVBR_AUTH_URL`, `GOVBR_SIGN_API_URL` válidos | 🔴 **ALTO, nos dois sentidos.** Se produção tem `false`, hoje há assinaturas falsas registradas como válidas, um problema de integridade **já existente**, e a correção liga o gov.br real (sem credenciais válidas, a assinatura quebra). Se produção não define a flag, o default `true` mantém o mock em produção de qualquer forma. Levantar quantos `SignatureRequest` com `pkcs7Data = 'MOCK_PKCS7_SIGNATURE_DATA'` existem em produção. |
| 117 | `ENABLE_AUDIT_LOGS` (default `true`) | `src/services/audit-ledger.service.ts` (`record`) | Kill switch de toda a trilha de auditoria (decisão D8) | Auditoria continua gravando | Auditoria **para de gravar** em todos os módulos; no caminho com `tx` (Frotas), sai `logger.warn` + evento no Sentry | 🔴 **ARRISCADO.** Se produção tem `false`, a correção apaga a trilha de compliance a partir do deploy, sem erro visível nos módulos antigos. |
| 126 | `ENABLE_REQUEST_LOGGING` (default `true`) | `src/config/plugins.ts:181` | Hook `onRequest` que loga `Incoming request` (método + URL) | Log de requisição continua | Log de requisição desligado | 🟡 **MODERADO.** Perda de observabilidade (correlação de incidentes) se produção tem `false`. Não afeta funcionalidade. |
| 118 | `SWAGGER_ENABLED` (default `true`) | `src/config/plugins.ts:156` | Registro do Swagger UI em `/documentation`, **só quando `isDevelopment`** | Swagger em dev | Sem Swagger em dev | 🟢 **BAIXO.** Em produção o `isDevelopment` já bloqueia. O `render.yaml` define `"true"`. |
| 114 | `ENABLE_2FA` (default `true`) | **nenhum lugar** (`config.features.twoFactor` sem leitor) | Nada hoje | Sem efeito | Sem efeito | 🟢 **NENHUM**, mas a flag engana: quem configurar `false` acha que desligou 2FA. |
| 115 | `ENABLE_EMAIL_VERIFICATION` (default `true`) | **nenhum lugar** (`config.features.emailVerification` sem leitor) | Nada hoje | Sem efeito | Sem efeito | 🟢 **NENHUM.** `render.yaml` e `.github/workflows/ci.yml` definem `"false"` achando que desligam algo; não desligam nada. |
| 116 | `ENABLE_PASSWORD_RESET` (default `true`) | **nenhum lugar** (`config.features.passwordReset` sem leitor) | Nada hoje | Sem efeito | Sem efeito | 🟢 **NENHUM**, mesma observação. |

## Correção proposta

**Não usar `z.stringbool()`.** O projeto está no Zod **3.25.76** (`package.json`: `^3.22.4`). `z.stringbool` existe só na API v4, acessível pelo subpath `zod/v4`, mas schemas v3 e v4 não se misturam no mesmo `z.object` do `envSchema`. Usar exigiria migrar o schema inteiro para v4, o que é outra tarefa.

**Usar parser explícito**, no padrão que o arquivo já tem em `HONEYPOT_ENABLED`, extraído para um helper:

```ts
/** "true"/"false" exatos; qualquer outro valor derruba o boot (fail-fast). */
const envBoolean = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform(v => v === 'true')

ENABLE_AUDIT_LOGS: envBoolean('true'),
USE_MOCK_GOVBR: envBoolean('true'),
```

Além de corrigir `"false"`, isso **recusa o boot** com valores como `1`, `0`, `TRUE`, `yes` ou vazio. Hoje esses valores passam calados (e o vazio desliga). É o mesmo princípio "config fail-fast" do resto do arquivo, mas é uma mudança de comportamento por si só (ver checklist).

## Checklist antes de corrigir

- [ ] Ler no painel do Render (staging e produção) o valor **exato** de cada uma das 7 variáveis, inclusive se está ausente ou vazio.
- [ ] Qualquer valor diferente de `true`/`false` exatos (`1`, `True`, vazio…) vai derrubar o boot com o parser novo: normalizar no Render **antes** do deploy.
- [ ] `USE_MOCK_GOVBR`: decidir com o Marllon o valor de produção. Antes, contar em produção os `SignatureRequest` com `pkcs7Data = 'MOCK_PKCS7_SIGNATURE_DATA'` e decidir o que fazer com eles. Se o destino é o gov.br real, validar as credenciais em homologação.
- [ ] `ENABLE_AUDIT_LOGS`: se produção tem `false`, decidir se é intencional antes que a correção desligue a trilha (ver D8 em `docs/frotas/decisoes.md` do workspace).
- [ ] Remover ou implementar `ENABLE_2FA`, `ENABLE_EMAIL_VERIFICATION` e `ENABLE_PASSWORD_RESET` (flags sem leitor); limpar `render.yaml`, `ci.yml` e `.env.example` de acordo.
- [ ] Teste unitário do helper: `"true"` → `true`, `"false"` → `false`, ausente → default, `"1"` → erro.
