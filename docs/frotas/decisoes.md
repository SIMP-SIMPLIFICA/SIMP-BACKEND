# Simplifica Frotas — Decisões que se sobrepõem à spec

2026-10-02 · @Carlos Magno

Estas decisões valem **acima** das duas especificações desta pasta (funcional e técnica de desenvolvimento). Onde a spec disser outra coisa, vale o que está aqui. Regra geral: quando doc e código divergirem, o código decide.

## D1 — As TASKs vêm da spec técnica

**Decisão.** A sequência de trabalho é a da *Especificação Técnica de Desenvolvimento* (TASKs 1 a 10, checklist de go-live), precedida da TASK 0 (ver D5). Uma TASK por sessão.

**Motivo.** A spec funcional só tem Fases; a técnica foi escrita depois da leitura do código e tem entregáveis e gates verificáveis.

## D2 — Dinheiro e quantidades em `Decimal`, nunca `Float` nem `Number`

**Decisão.** Dinheiro em `Decimal(15,2)`, litros em `Decimal(10,3)`, preço unitário em `Decimal(10,4)`. Toda aritmética com `Prisma.Decimal` (`.plus`, `.times`, `.minus`), nunca com `Number`. Centavos em `Int` ficam só onde já existem (`BankAccount.initialBalanceCents`, `FinanceEntry.amountCents`).

**Motivo.** É o padrão do código: Diárias, `FleetFueling`, QDD, Convênios e `budgetService` já usam `Decimal`. A spec técnica pedia centavos/mililitros/milésimos em `Int`. Isso criaria um segundo sistema de unidades, e o saldo QDD soma valores de vários módulos, então misturar unidades seria fonte de erro.

**Sobrepõe:** TASK 2 (`maxAmountCents`, `maxVolumeMl`, `unitPriceCapMilli`, `tankCapacityMl`, `marketValueCents`, `totalCents`…), TASK 5 ("valores em centavos/mililitros") e TASK 10 ("cálculos em inteiros").

## D3 — Auditoria: `record(data, tx?)` e nomes em `UPPER_SNAKE`

**Decisão.** A assinatura alvo é `auditLedgerService.record(data, tx?)`, com `tx` opcional e compatível com as chamadas atuais. No Frotas a chamada é **sempre com `tx`**, e falha de auditoria **derruba a operação**. Nos demais módulos o comportamento atual (fora da transação, erro engolido) não muda. Nomes de ação seguem o padrão existente em `UPPER_SNAKE`: `FLEET_AUTHORIZATION_ISSUED`, `FLEET_PLATE_MISMATCH`. A mudança no `auditLedgerService` é pré-requisito da TASK 1.

**Motivo.** Hoje `record()` grava com o `prisma` global, fora de qualquer transação, e engole erros de propósito. Para o Frotas, a spec exige que a trilha seja prova (o controle interno precisa provar que o hodômetro não foi editado), então ação sem trilha não pode acontecer. Os nomes existentes (`DAILY_ALLOWANCE_ISSUED`, `FLEET_FUELING_ISSUED`) já são `UPPER_SNAKE`, e o painel de auditoria filtra por eles.

**Sobrepõe:** TASK 3 e TASK 6 (`ledger.record(tx, {...})`, `action: 'fleet.auth.issued'`).

## D4 — Erros: `FleetError` + `STATUS_BY_CODE`; `.strict()` em rotas novas

**Decisão.** O Frotas usa `FleetError(code, message, details?)` com um mapa `STATUS_BY_CODE` no controller, igual a `DailyAllowanceError` em `src/services/daily-allowance.service.ts` e `src/controllers/daily-allowance.controller.ts`. As mensagens são orientadoras (o que aconteceu, o dado concreto, o que fazer). Não criar um `AppError` global agora. `.strict()` do Zod é obrigatório só em rotas novas.

**Motivo.** Cada domínio do SIMP já tem sua classe de erro com mapa de status; um `AppError` global seria uma refatoração transversal fora do escopo do Frotas. Hoje nenhum schema do backend usa `.strict()`, e impor em rotas antigas quebraria clientes.

**Sobrepõe:** TASK 3 e TASK 5 (`AppError(code, status, details)`).

## D5 — `db push`/`migrate reset` negados ao Claude; TASK 0 de baseline

**Decisão.** `prisma db push`, `prisma migrate reset` e `npm run db:push`/`db:reset` ficam negados ao Claude em `.claude/settings.json`. Humanos continuam podendo rodar.

**Motivo.** Com o drift descrito abaixo, um `db push` ou `reset` acidental do agente pode apagar dados de desenvolvimento ou mascarar a necessidade da baseline.

### TASK 0 — migration de baseline (pré-requisito de tudo)

Antes da TASK 1, criar uma migration de baseline que leve o histórico de `prisma/migrations` ao estado real do `schema.prisma`, sem resetar nenhum banco.

O schema tem 62 models, mas as 3 migrations existentes só criam 35 tabelas. `FleetFueling`, `DailyAllowance`, `QddItem`, `Council` e outras nasceram por `prisma db push`. Com esse drift, o primeiro `prisma migrate dev` detecta a divergência e propõe **resetar o banco**. A TASK 1 precisa de uma migration (drop/recriação do `FleetFueling`), então o histórico tem que estar íntegro antes.

**Caminho (não executado; alinhar com o Marllon antes):**

1. Para cada banco existente (dev de cada pessoa, staging, produção), confirmar que ele já bate com o schema. A saída precisa ser vazia:
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
2. ~~Gerar a baseline a partir das migrations existentes.~~ **Substituído pela D10**: o histórico antigo não reexecuta (P3006), então a baseline é única e gerada do schema.
3. Revisar o SQL gerado à mão (incluir os índices parciais e o SQL de `prisma/sql/` que o `db push` não cria).
4. Em cada banco existente, marcar a baseline como aplicada, sem executá-la:
   `npx prisma migrate resolve --applied <timestamp>_baseline_db_push`
5. Bancos novos (inclusive o `_e2e`) passam a rodar todas as migrations normalmente.
6. Avaliar trocar `prisma db push --accept-data-loss` por `prisma migrate deploy` em `src/tests/global-setup-e2e.ts`, para o e2e exercitar as migrations reais.

Daqui em diante, mudança de schema é feita com `prisma migrate dev --create-only` + revisão humana do SQL.

## D6 — Arquitetura em camadas; sem `src/modules/`

**Decisão.** Seguir a arquitetura em camadas do código (`src/controllers`, `src/services`, `src/routes`, `src/schemas`, `src/jobs`, `src/constants`). Não criar `src/modules/fleet/`. No frontend, telas novas em `src/pages/fleet/` e componentes em `src/components/fleet/`; a pasta `src/pages/fleet-fuelings/` é removida na TASK 1.

**Motivo.** Nenhum domínio do SIMP usa pasta de módulo; um único domínio em outra estrutura confundiria a navegação e as regras por caminho (`.claude/rules/fleet.md`).

**Sobrepõe:** a seção "Estrutura de pastas" da spec técnica e a frase "únicas alterações fora de `modules/fleet`" da TASK 1.

## D7 — Hooks portáveis e `settings.local.json` fora do Git

**Decisão.** Os hooks do `.claude/settings.json` usam `$CLAUDE_PROJECT_DIR` e scripts em Node (sem caminho absoluto de uma máquina, sem `jq`). Propor ao Marllon tirar `settings.local.json` do versionamento.

**Motivo.** Os hooks apontavam para `/Users/marllonrodrigues/...` e falhavam em qualquer outra máquina. `settings.local.json` é configuração pessoal por definição e hoje está versionado nos dois repositórios.

## D8 — Kill switch de auditoria prevalece sobre o caminho com `tx`, mas nunca em silêncio

2026-10-03

**Decisão.** Com `ENABLE_AUDIT_LOGS` desligado, `auditLedgerService.record(data, tx)` **não grava** nada, também no caminho transacional, e a operação do chamador segue normalmente. Quando isso acontece com `tx`, o serviço emite `logger.warn` e um evento `warning` no Sentry contendo **apenas** `action` e `resource` (fingerprint por ação + recurso). Nenhum dado pessoal sai: nem `details`, `userId`, `ip`, `resourceId` ou `organizationId`. Sem `tx`, o kill switch continua silencioso, como sempre foi.

**Conflito com a D3.** A D3 diz que, no Frotas, "ação sem trilha não pode acontecer" e que falha de auditoria derruba a operação. Com o kill switch desligado, uma operação do Frotas é confirmada sem trilha, o que a D3 proíbe.

**Motivo.** O kill switch é uma decisão administrativa explícita, e o contrato do serviço sempre disse que ele vale para *qualquer* chamador. Fazer o Frotas ignorá-lo criaria uma exceção escondida num controle de operação. Fazê-lo derrubar as operações transformaria uma flag de observabilidade em botão de desligar o módulo. A D3 trata de **falha** de auditoria (o registro foi tentado e não entrou), e isso continua derrubando a operação; desligar a trilha de propósito é outra coisa. O risco real é alguém desligar a flag por outro motivo sem saber que suspende a prova do Frotas: por isso o aviso no log e no Sentry, agrupado para não gerar um evento por requisição.

**Atenção:** hoje `ENABLE_AUDIT_LOGS=false` **não desliga** nada, por causa do `z.coerce.boolean()` em `src/config/config.ts` (a string `"false"` vira `true`). Ver `docs/issues/config-boolean-flags.md`. Quando a correção entrar, o kill switch passa a funcionar de verdade, e esta decisão passa a ter efeito em produção.

**Sobrepõe:** a D3 no caso específico de kill switch desligado.

## D9 — No MVP, a prova do documento é PDF + `sha256Hash` + QR de validação; sem assinatura gov.br

2026-10-03

**Decisão.** No MVP do Frotas, a autenticidade e a integridade de todo documento emitido (autorização de abastecimento, OS, diário de bordo, relatórios) são provadas por:

- o PDF original, gerado uma única vez e nunca regenerado;
- o `sha256Hash` desse PDF;
- o QR de validação que aponta para o portal público (`publicId` + `ExportedDocument`, rota `GET /api/v1/public/documents/validate/:uuid`).

A assinatura eletrônica gov.br (e a ICP-Brasil) **fica fora** do Frotas até ser habilitada de propósito, com a integração validada em homologação do ITI. Nenhuma TASK do Frotas depende dela, e nenhuma tela do Frotas oferece "assinar".

**Motivo.** A investigação de 2026-10-03 mostrou que a integração real com o gov.br que existe no SIMP (Conselhos) nunca funcionou:

- O código chama endpoints e campos que **não batem** com a API oficial do ITI. Segundo o manual de integração, o authorize/token fica em `https://cas.staging.iti.br/oauth2.0/...`, com escopo `sign`, e a assinatura é `POST /externo/v2/assinarPKCS7` com `{ "hashBase64": ... }`, devolvendo o PKCS#7 binário. O código usa `{GOVBR_AUTH_URL}/authorize` (padrão `sso.staging.acesso.gov.br`), escopo `openid profile email govbr_assinatura`, `POST /api/v1/assinar` com `hashDocumento`/`algoritmoHash`/`tipoAssinatura`/`nivelAssinatura`, e espera um JSON `{ assinatura }`.
- O fluxo real foi escrito em 18/05/2026, e o modo mock entrou cinco dias depois. Desde então o fluxo real só recebeu endurecimento de segurança.
- O `pkcs7Data` gravado nunca é lido: a assinatura não é embutida no PDF nem verificada no portal. A dependência `node-signpdf` não é importada em lugar nenhum.
- Não há nenhum teste do fluxo de assinatura.
- O mock marca o documento como `ASSINADO` com `pkcs7Data = 'MOCK_PKCS7_SIGNATURE_DATA'`, e por causa do `z.coerce.boolean()` não dá para desligá-lo com `USE_MOCK_GOVBR=false`.

Prometer assinatura no Frotas sobre essa base seria vender uma prova que não existe. O trio PDF + hash + QR já funciona, é testado (Diárias) e é verificável por terceiros.

**Sobrepõe:**
- Spec funcional: seção "Assinatura digital" (gov.br avançada, ICP-Brasil, PAdES, `SignedDocument`, `SignaturePort`), na parte que toca o MVP.
- Spec técnica: o uso de "Assinatura gov.br (`SignatureRequest`, landing de retorno)" como componente reutilizável, e o "assinar" de `fleet:reports` ("Gerar e assinar relatórios" passa a ser só "Gerar relatórios" no MVP).

O destino do código de assinatura existente nos Conselhos (remover ou corrigir) é decidido à parte.

## D10 — Histórico de migrations substituído por uma baseline única (`0_baseline`)

2026-10-03 · substitui o passo 2 da D5

**Decisão.** As três migrations antigas (`20260408032157_init`, `20260408032158_add_organization_modules`, `20260426120000_department_is_active_code_unique`) foram apagadas. No lugar entra `prisma/migrations/0_baseline`, gerada com `prisma migrate diff --from-empty --to-schema-datamodel` mais o SQL de `prisma/sql/` (índice único parcial de Atos Normativos e trigger de imutabilidade de `audit_logs`). Bancos que já existem são marcados com `DELETE` dos registros antigos em `_prisma_migrations` + `prisma migrate resolve --applied 0_baseline`. Bancos novos (o `_e2e` e o futuro banco de produção) recebem tudo por `prisma migrate deploy`. O e2e passou a usar `migrate deploy` em vez de `db push`.

**Motivo.**
- **P3006 em banco novo:** a `init` já criava `organization_modules`, e a migration seguinte tentava criá-la de novo. Nenhum banco novo conseguia reexecutar o histórico, nem o shadow do `migrate dev`, nem o `--from-migrations` previsto na D5.
- **P3009 com registro de falha:** o banco de dev registrava a segunda migration como falha. Nesse estado o `migrate deploy` se recusa a rodar, e o `migrate dev` exige reset.
- Corrigir editando as migrations antigas mudaria um histórico já registrado (e a terceira também falharia no dev, porque a coluna `is_active` já existia). Uma baseline única é verificável: banco novo + `migrate deploy` fica idêntico ao schema (`migrate diff` vazio), e o Prisma não acusa o índice parcial nem o trigger como drift.

**Por que o `DELETE` em `_prisma_migrations`:** testado numa cópia do dev. Sem ele, o deploy funciona, mas o `migrate dev` exige reset porque há migrations "aplicadas no banco e ausentes da pasta". O `DELETE` só toca metadados; nenhum dado de negócio muda.

**Consequências.**
- Daqui em diante, toda mudança de schema é `prisma migrate dev --create-only` + revisão do SQL + `prisma migrate deploy` (ou `migrate dev` em dev). `db push` não é mais usado em nenhum banco.
- O banco de dev local foi marcado com `resolve`, então **não** recebeu o índice parcial nem o trigger (nunca os teve). Os bancos criados por `migrate deploy` têm os dois. Ver `docs/frotas/task0-baseline.md` e `docs/issues/audit-trigger-bloqueia-exclusoes.md`.
- Procedimento local e de deploy futuro: `docs/frotas/task0-baseline.md`.

## Também decidido

- **RLS** não é invariante: é decisão a tomar na TASK 2. Hoje nenhuma tabela do SIMP tem RLS.
- Os achados abaixo ficam **registrados, sem correção agora**: `saveFile` grava em disco local (não há cliente R2); rota pública real é `/api/v1/public/documents/validate/:uuid`; `SequenceControl` (só Protocolos, preso ao enum `OfficialDocumentCategory`) × numeração `max+1` Serializable das Diárias; ausência de RLS; campos padrão da spec (`version`, `deletedAt`, `updatedById`) ausentes; rota atual `/api/v1/fleet-fuelings`; Node 24 local × `.nvmrc` 22.
