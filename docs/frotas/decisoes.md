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

## D11 — RLS nas tabelas `fleet_*` adiado até existir um papel de banco da aplicação

2026-10-04

**Decisão.** A TASK 2 não cria políticas de Row-Level Security. O isolamento entre organizações no Frotas é o filtro por `organizationId` aplicado em toda query dos services (vindo sempre do token), coberto por e2e com duas organizações em toda rota.

**Motivo.** A aplicação conecta ao PostgreSQL como `postgres`, que é **superusuário**, e superusuário sempre ignora RLS, mesmo com `FORCE ROW LEVEL SECURITY`. Criar as políticas agora não barraria nada e acrescentaria o `SET LOCAL app.organization_id` em toda transação sem efeito real.

**Pré-condição para retomar:** criar um papel de banco da aplicação sem superusuário e sem `BYPASSRLS`, e trocar o `DATABASE_URL` da aplicação para ele. Isso afeta o sistema inteiro, não só o Frotas. Aí sim: políticas `USING (organization_id = current_setting('app.organization_id'))` nas tabelas `fleet_*`, numa migration nova.

**Sobrepõe:** a spec técnica (TASK 2 "políticas RLS", TASK 5 nível 1 "RLS") e o item do checklist de go-live "RLS ativa em todas as tabelas fleet_*".

## D12 — Cifragem de CPF/CNH com chave do ambiente, derivada por organização

2026-10-04

**Decisão.** CPF e nº da CNH do motorista são gravados só cifrados, com AES-256-GCM (`src/services/fleet-pii.service.ts`):
- chave de dados **por organização**, derivada da chave mestra `FLEET_PII_MASTER_KEY` com HKDF-SHA-256 (info = `organizationId`);
- `organizationId` como dado autenticado (AAD): um texto cifrado copiado para outra organização não decifra;
- busca e unicidade de CPF pelo blind index, HMAC-SHA-256 com a chave separada `FLEET_PII_BLIND_INDEX_KEY`;
- as duas chaves têm 32 bytes em base64, são **obrigatórias em produção** (o boot falha sem elas) e opcionais em dev (sem elas, só o cadastro de motoristas responde 503 com mensagem orientadora);
- a API e a auditoria só expõem as versões mascaradas.

**Motivo.** A spec pede chave de dados por organização envolvida por chave mestra em KMS, mas o ambiente é local e não há KMS. A derivação por HKDF mantém o isolamento criptográfico por prefeitura. Trocar para KMS depois muda só a origem da chave mestra (`keyFromConfig`), não o formato gravado.

**Atenção:** perder ou trocar `FLEET_PII_MASTER_KEY` torna ilegíveis os CPFs/CNHs já gravados (o formato tem prefixo de versão `v1.` para permitir rotação no futuro). O e2e gera chaves aleatórias a cada execução.

## D13 — "Frota geral" e proteção do CPF contra força bruta

2026-10-04 · saiu da revisão de segurança da TASK 1 + 2

**Decisão.**
- **Frota geral.** Veículo ou motorista sem departamento é visível a todos com `fleet:read`, mas só quem tem `fleet:all_departments` cria, altera, exclui ou move registros de/para a frota geral. Usuário restrito cadastra sempre num departamento seu.
- **CPF fora da URL.** Busca por CPF é `POST /api/v1/fleet/drivers/lookup` (CPF no corpo). A busca da listagem é só por nome e recusa dígitos (400); o frontend nunca envia texto com dígito para ela.
- **Máscara curta.** `cpfMasked` mostra só os dígitos 4 a 6 (`***.982.***-**`).
- **Lookup limitado e auditado.** 10 requisições por minuto por IP e um `FLEET_DRIVER_LOOKUP` na trilha a cada chamada (sem o CPF).

**Motivo.** Sem isso: um usuário restrito publicaria para a organização inteira um motorista do seu setor (ou esconderia um da frota geral); um CPF digitado na busca, inteiro ou só o prefixo de 9 dígitos que já o determina, iria para o log de requisição; e a máscara antiga (dígitos 4 a 9) deixava só 1.000 candidatos, recuperáveis pelo lookup em minutos.

## D14 — Matrícula, patrimônio e PDFs autenticados do cadastro

2026-10-04 · decidido com o responsável (matrícula e rodapé) e na revisão de segurança

**Decisão.**
- **Matrícula** é campo próprio, `FleetDriver.registrationNumber`, e não vínculo com `Beneficiary`. É obrigatória para EFETIVO e COMISSIONADO e única entre ativos na organização. No **cadastro**, se vier em branco, o servidor sugere a matrícula do beneficiário de Diárias com o mesmo CPF. Isso só acontece se o módulo `dailyAllowances` estiver ligado e o usuário tiver alguma permissão `dailyAllowances:*`, porque senão o cadastro revelaria dados de Diárias a quem não os enxerga. A trilha guarda `registrationSource`.
- **Patrimônio** (`assetTag`) é obrigatório para veículo PRÓPRIO e único entre ativos.
- **Registros anteriores às regras.** As duas obrigatoriedades só são conferidas na alteração quando ela toca o campo ou o vínculo/posse. Registros antigos continuam aceitando, por exemplo, troca de situação; o formulário de edição envia tudo e já as exige.
- **Busca por matrícula.** `POST /drivers/search-by-registration` leva o termo no corpo (a tela não distingue matrícula numérica de CPF incompleto) e tem limite de 60/min por IP. Não é auditada: não é oráculo de CPF.
- **PDFs** saem pelo motor universal (D9): relação da frota, relação de motoristas, ficha do veículo e ficha do motorista. São todos `POST`, com os filtros da tela no corpo, limite de 20/min por IP e permissão de leitura.
  - Em cada exportação, `ExportedDocument` e a auditoria (`FLEET_*_EXPORTED`) gravam **na mesma transação**, com `exportedDocumentService.registerInTransaction`. Se o registro falhar, o PDF não é entregue.
  - CPF e CNH aparecem só mascarados. O termo buscado (nome ou matrícula) não é impresso nem auditado.
  - O rodapé padrão segue em toda página, com o nome ofuscado de quem exportou. Na última página vai o bloco **Responsável**, com nome completo e cargo (`User.jobTitle`).
- **Relação da frota** em paisagem com 12 colunas legíveis. Chassi, consumo de referência, regime, ARLA, valor de mercado e entidade proprietária ficam só na ficha.
- **Teto de 2.000 linhas** por relação (`EXPORT_TOO_LARGE`, 422).

**Motivo.** A matrícula de Diárias é cópia em texto e não pertence ao Frotas. Reaproveitá-la como sugestão evita digitação dupla sem acoplar os módulos. A transação única garante que nenhum documento validável saia sem trilha.

## D15 — Redis só para dados temporários com expiração

2026-10-05 · decisão do responsável

**Decisão.** O Redis guarda só o que pode expirar e sumir sem prejuízo, sempre com TTL definido. O que precisa valer para sempre ou servir de prova fica no Postgres.

Na TASK 3:

| Onde | O quê |
| --- | --- |
| **Redis** (com TTL) | a sessão de 30 min do frentista (trava por aparelho); o rate limit da rota pública; travas curtas contra envio simultâneo |
| **Postgres** (não muda) | o token da autorização (só o hash); o contador de placas erradas e o `BLOCKED`; a chave NFC-e usada (constraint única); a auditoria |

**Redis fora do ar:** a rota do frentista responde com mensagem clara ("Sistema temporariamente indisponível, tente em instantes") e **não abre sessão sem trava**. Nunca libera uso sem controle: na falta do Redis, a operação para; ela não segue sem a trava.

**Motivo.** A sessão e o rate limit são estado efêmero por natureza: perdê-los num reinício só obriga o frentista a digitar a placa de novo. Prova (bloqueio, uso único, cupom, trilha) não pode depender de um armazenamento que, no plano atual do Render, nem persiste em disco. Ver `docs/issues/redis-deploy.md`.

## D16 — Regras da emissão da autorização de abastecimento (TASK 3A)

2026-10-05 · decididas com o responsável (placa, contrato) e na implementação

**Decisão.**
- **Placa fora do PDF.** O papel identifica o veículo por modelo, tipo e nº de patrimônio. O frentista digita a placa do veículo à frente dele; se ela estivesse impressa, ele poderia copiá-la do papel.
- **Contrato mínimo já na TASK 3A.** Cadastro enxuto de contratos de combustível (`/api/v1/fleet/contracts`: nº, fornecedor, CNPJ, combustível, preço unitário, vigência, valor total, volume opcional, empenho e ficha), da organização inteira, mantido por quem tem `fleet:manage`. A emissão exige contrato vigente do mesmo combustível. Dele vêm o preço máximo e o CNPJ do posto que a TASK 3B confere contra o cupom. O **saldo do contrato bloqueia** a emissão (limite legal), calculado na leitura e conferido com a linha do contrato travada (`FOR UPDATE`). O saldo da ficha QDD só avisa (`budgetOverrun`).
- **Numeração na emissão.** Padrão das Diárias (`0001/2026`, max+1 em transação Serializable com retry, por organização e ano local), atribuída só ao emitir: rascunho excluído não abre buraco na sequência. `sequenceNumber`, `year` e `formattedNumber` passaram a ser opcionais, com `CHECK` no banco (emitida sempre tem número, hash e PDF).
- **Departamento que ordena.** Quem emite tem `fleet:authorize_fuel` e o departamento no seu escopo. Veículo e motorista são desse departamento ou da frota geral. A ficha QDD é do próprio departamento.
- **Motorista.** Bloqueia CNH vencida, suspensa ou cassada e categoria insuficiente: moto exige A; automóvel, caminhonete, camioneta e utilitário exigem B; caminhão, C; micro-ônibus e ônibus, D; caminhão-trator, E. As categorias de quatro rodas são cumulativas. Para máquina, reboque e outro, a categoria depende de peso e uso, então o sistema só avisa. Também avisa se a CNH vence antes da validade.
- **Combustível compatível.** Flex e híbrido aceitam gasolina ou etanol; motor S500 aceita S500 ou S10, e motor S10 só S10; GNV aceita GNV ou gasolina; elétrico não tem o que abastecer. A autorização e o contrato só usam combustível de bomba (gasolina, etanol, S10, S500, GNV).
- **Limites.** Preço unitário obrigatório (até o do contrato) e litros e/ou valor. O servidor calcula o que faltar em `Decimal`: valor = litros × preço, arredondado ao centavo; litros = valor ÷ preço, para baixo. Com os dois informados, o valor não pode passar de litros × preço.
- **Validade.** Padrão de 3 dias úteis depois de hoje, pulando sábado, domingo e os feriados da organização, até 23:59 de Brasília. Máximo de 30 dias. Na emissão, a validade não pode passar do fim do contrato.
- **Veículo** em manutenção, acidentado, paralisado, a doar ou baixado não recebe autorização.
- **Cancelamento** só de autorização `OPEN` (ou `IN_USE` com a sessão do frentista vencida), com motivo de 10 a 500 caracteres. Libera a reserva no contrato e na ficha.
- **PDF é vale ao portador enquanto aberto.** O download é auditado (`FLEET_AUTHORIZATION_PDF_DOWNLOADED`). Enquanto a autorização está `OPEN` ou `IN_USE`, só quem tem `fleet:authorize_fuel` baixa o PDF; depois, qualquer perfil de leitura o vê. Os escopos `fleet-*` do disco (PDFs e, na TASK 3C, fotos de cupom) **não** são servidos pelo estático `/uploads`: só saem pelas rotas autenticadas.
- **Emissão contra edição concorrente.** A emissão trava a linha da autorização e confere que o rascunho não mudou desde que o PDF foi gerado (`DRAFT_CHANGED`, 409). Sob a trava do contrato, as regras do contrato (excluído, combustível, preço, vigência) são conferidas de novo.
- **Contrato com autorização aberta** não troca CNPJ do posto nem combustível, e não é excluído. A trilha da alteração guarda antes e depois dos campos de preço, saldo e vigência.
- **Portal de validação** mostra a situação da autorização (aberta, em uso, usada, vencida, bloqueada, cancelada), sem placa, nome ou valores.

**Motivo.** Cada regra fecha um caminho de erro ou de fraude que a spec deixava aberto. As de contrato e de placa foram pedidas pelo responsável.

## Também decidido

- **RLS:** ver D11.
- Os achados abaixo ficam **registrados, sem correção agora**: `saveFile` grava em disco local (não há cliente R2); rota pública real é `/api/v1/public/documents/validate/:uuid`; `SequenceControl` (só Protocolos, preso ao enum `OfficialDocumentCategory`) × numeração `max+1` Serializable das Diárias; ausência de RLS; campos padrão da spec (`version`, `deletedAt`, `updatedById`) ausentes; rota atual `/api/v1/fleet-fuelings`; Node 24 local × `.nvmrc` 22.
