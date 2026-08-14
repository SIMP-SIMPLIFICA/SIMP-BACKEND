# Release Notes — Épicos 1, 2 e 3

**Sistema**: SIMP Simplifica — Gestão Municipal Multi-Tenant
**Período**: Julho–Agosto de 2026
**Repositórios**: `SIMP-BACKEND` (Fastify/Prisma/PostgreSQL) e `SIMP-FRONTEND` (React/Vite)
**Processo**: Spec-Driven Development (GitHub Spec Kit), sob a Constituição do projeto v1.0.0

---

## Sumário executivo

Três épicos, entregues em ciclos completos de *specify → plan → tasks → aprovação → implementação → validação*. O eixo comum foi **transformar dados que existiam em comportamento que protege**: em vários casos o campo já estava no banco, a permissão já era referenciada no código, o botão já estava na tela — mas nada disso produzia efeito real.

**O que o negócio ganhou:**

| Frente | Antes | Depois |
|---|---|---|
| **Isolamento de dados** | Módulo de Comunicação expunha usuários e mensagens de todas as organizações | Isolamento por organização com falha fechada |
| **Cobrança / inadimplência** | "Organização inativa" era só um rótulo — os usuários continuavam usando o sistema | Kill switch real: suspende e o acesso cai na requisição seguinte |
| **Compliance legal** | Ata de conselho podia ser alterada meses depois | Registro congela 72h após a reunião, em 9 rotas |
| **Numeração oficial** | Ato Normativo recebia número inventado pelo sistema | Número informado manualmente, com unicidade garantida no banco |
| **Controle de prazos** | Sem visibilidade de vencimentos em processos | Alertas em 30/15/7/3 dias + filtro "Quase Vencendo" |
| **Infraestrutura** | Uploads dependiam de credenciais de nuvem (falhando com HTTP 401) | Armazenamento local em disco — zero credenciais para desenvolver |

---

## Épico 1 — Segurança, RBAC e Bugs Críticos

**Spec**: `.specify/specs/epic1-security-rbac.md`

### Vazamento de dados entre organizações (crítico)

O módulo de Comunicação declarava um hook de autenticação **próprio**, que duplicava ~90% do middleware compartilhado mas **omitia a normalização de `organizationId`**. Quando esse campo chegava ao controller como `undefined`, o Prisma interpretava a cláusula como "sem filtro" — e devolvia destinatários e mensagens de **todas as organizações**.

- Hook duplicado removido; passou a usar o `authenticate` compartilhado
- Filtro de organização com **falha fechada**: sem contexto de organização, a requisição é recusada (403) em vez de consultar sem filtro

> **Lição que se repetiu no projeto**: toda vez que um módulo criou sua própria versão de uma regra compartilhada, ela divergiu. Isso passou a orientar as decisões dos épicos seguintes.

### Permissões fantasma (padrão recorrente — 4 ocorrências)

Rotas referenciavam chaves de permissão que **não existiam no catálogo**, tornando-as impossíveis de conceder a qualquer papel:

| Chave | Efeito | Épico |
|---|---|---|
| `workspaces:read/write/manage`, `tasks:read` | Nenhum admin criava Workspaces | 1 |
| `communication:read` | **Ninguém** conseguia enviar mensagem a colega | 2 |
| `notifications:read/write/manage` | Campainha de notificações em 403 para 100% dos usuários | Hotfix |

Além do catálogo, o papel "admin" **já existente** no banco não recebia chaves novas automaticamente (o upsert de criação não atualiza registros existentes). Criou-se `sync-admin-role-permissions.ts`, idempotente e reutilizável.

### Dados legados sem correção

A correção de vínculo de admin do ciclo anterior só valia para organizações **novas**. Um administrador real (`carlos@gmail.com`) tinha zero papéis vinculados e não conseguia usar o sistema. Script `backfill-admin-roles.ts` corrigiu o acervo existente — **1 usuário reconciliado**.

### Demais correções

- Retry para conflito de serialização (`P2034`) na geração concorrente de protocolos
- Validação de intervalo de datas em Processos Virtuais (backend + frontend)

---

## Épico 2 — UX, Refatoração de Protocolos e Correções de Frontend

**Spec**: `.specify/specs/epic2-ux-protocols.md`

### Erros que se escondiam

Vários fluxos capturavam a exceção e exibiam um texto genérico, **descartando a mensagem real do backend**. Corrigir isso foi o que permitiu diagnosticar os bugs seguintes — e o próprio usuário identificou o valor: *"a interface gritou exatamente o que o backend reclamou"*.

### Divergência de tipo de ID (2 ocorrências)

Schemas Zod validavam com `.uuid()` campos cujos modelos usam `nanoid()`:

- `departmentId` → toda geração de protocolo de Comunicação falhava com HTTP 400
- `libraryDocumentId` → todo "Anexar PDF" falhava com HTTP 400

Varredura completa dos 26 usos restantes de `.uuid()` confirmou que os demais apontam para modelos genuinamente UUID. **Regra registrada**: 27 dos ~50 modelos usam `nanoid()`/`cuid()` — conferir o `@default` antes de usar `.uuid()`.

### Crash da tela de Workspaces

`<SelectItem value="">` — valor reservado pelo Radix UI para placeholder, que lança erro e derruba a página inteira. Substituído por valor sentinela.

### Protocolos em duas filas

Separação de **Ato Normativo** (fila única, setor central) e **Comunicação** (por departamento) em abas independentes, com permissões granulares `protocols:normativo` e `protocols:comunicacao` — **estritamente aditivas**: quem tinha `protocols:write` não perdeu nada.

Adicionado o indicador "Pendente de Anexo" / "Anexado" na listagem e ação de anexar a posteriori.

---

## Épico 3 — Governança Municipal

### 3.A — Kill Switch de Organizações

**Spec**: `.specify/specs/epic3-org-suspension.md`

O campo `isActive`, o endpoint de alternância e o badge **já existiam** — mas suspender uma organização não impedia nada: seus usuários continuavam logando e consumindo a API inteira.

- Trava dentro do `authenticate`, único ponto por onde toda requisição autenticada passa
- **Super Admin retorna antes de qualquer consulta** — se a ordem fosse invertida, suspender todas as organizações bloquearia a única pessoa capaz de reativá-las
- Cache em memória com invalidação explícita: efeito imediato pelo painel, sem custo de consulta por requisição
- Login também bloqueado, verificado **após** a senha (informar antes revelaria a existência da conta)
- Frontend: interceptação de `ORGANIZATION_SUSPENDED` limpando sessão e cache, com tela dedicada `/acesso-suspenso`

**Valor**: instrumento real de cobrança para inadimplência, com auditoria de quem suspendeu e quando.

### 3.B — Alertas de Vencimento em Processos Virtuais

**Spec**: `.specify/specs/epic3-process-alerts.md`

Campos `validityDate` e `totalValue`, com alertas em faixas de **30 / 15 / 7 / 3 dias** e estado próprio para **vencidos**.

- Contagem por **dia de calendário** (`differenceInCalendarDays`): com subtração bruta de milissegundos, um processo que vence amanhã apareceria como "vence hoje" ao ser consultado à tarde
- Faixa crítica como `dias <= 3`, cobrindo 3/2/1/0 **sem buraco**
- Filtro `expiringIn` no servidor, preservando contagem e paginação
- Endpoint `PATCH /:id/validity` para o acervo já cadastrado — sem ele, os alertas só valeriam para processos criados dali em diante

### 3.C — Documentos compartilhados entre Convênios e Processos

**Spec**: `.specify/specs/epic3-covenants-processes-docs.md`

A relação N:N **já existia**. O que faltava era atribuir um documento do convênio a um processo específico.

- Coluna `virtualProcessId` com **`onDelete: SetNull`** — excluir um processo nunca apaga acervo do convênio; o arquivo volta a ser "geral"
- Validação server-side recusa vincular documento a processo de outro convênio
- Aba do Convênio agrupada por processo; aba do Processo exibe as duas origens com selo de procedência
- **Exclusão permanece na tela de origem**, para que ninguém apague acervo do convênio sem perceber
- Um único arquivo armazenado, visível nas duas telas

### 3.D — Conselhos: Trava de 72h e Calendário Oficial

**Spec**: `.specify/specs/epic3-councils-revolution.md`

**Trava de compliance** — o coração do épico. Passadas 72 horas da reunião, o registro congela.

- **9 rotas cobertas, não 2**: além de editar/excluir reunião e anexar/excluir atas, alcança **status, pauta e presença** — alterar a pauta de uma ata congelada mudaria o registro oficial pela porta dos fundos
- Comparação de **instantes em UTC** (o prazo é literalmente 72 horas; arredondar para dia daria até ~24h a mais ou a menos conforme o horário da reunião)
- **Servidor é a fonte da verdade**: a API devolve `isFrozen` pronto, para que o relógio do navegador do usuário não participe da decisão sobre um registro oficial
- **Sem mecanismo de desbloqueio** — congelou, acabou

**Calendário Anual Oficial** em PDF, com cabeçalho institucional, tabela de reuniões e linhas de assinatura da Mesa Diretora. Casos-limite tratados: ano sem reuniões gera documento com aviso; cargo ausente omite a linha em vez de imprimir "Presidente: ____" vazio.

Rótulos de cargo passaram a exibir "Conselheiro(a)" e "Suplente" — **sem migration**, apenas apresentação.

---

## Hotfix — Armazenamento Local (Local-First)

**Spec**: `.specify/specs/hotfix-local-upload-protocols.md`

Todos os uploads falhavam com HTTP 401 do Cloudflare R2. A decisão foi abandonar o storage de nuvem.

- **8 controllers migrados** (não apenas Biblioteca): Comunicação, Tarefas, Processos Virtuais, Financeiro, Conselhos, Biblioteca, avatar/logo e upload genérico
- SDK da AWS removido do projeto; `storage.service.ts` grava em disco local
- Mesmo formato de `fileKey` preservado — nenhum dado existente precisou migrar

**Valor**: cumpre o Princípio I da Constituição ("Local-First, zero credenciais de nuvem"), que até então era violado por qualquer fluxo com arquivo.

---

## Qualidade e testes

Suíte automatizada cobrindo as regras críticas de negócio destes épicos:

| Suíte | Testes | Foco |
|---|---|---|
| `council-compliance.spec.ts` | 17 | Trava de 72h: limites exatos, independência de fuso, entradas inválidas |
| `auth-middleware-suspension.spec.ts` | 8 | Kill switch: imunidade do Super Admin, falha fechada, cache e reativação |
| Suítes pré-existentes | 3 | Helpers de autenticação |
| **Total** | **28** | `test:coverage` verde |

`council-compliance.ts` com **100% de cobertura**.

Também foi corrigido um teste **pré-existente quebrado** (`auth_db.spec.ts`), que passava um id não-UUID a uma coluna `@db.Uuid` — falha introduzida quando os tipos foram alinhados na estabilização inicial. O CI estava vermelho antes destas mudanças.

---

## Padrões estabelecidos

Decisões que passaram a orientar o projeto:

1. **Uma regra, um lugar.** Toda vez que um módulo criou sua própria cópia de uma regra compartilhada, ela divergiu (vazamento de Comunicação, rótulos duplicados, helpers de moeda triplicados).
2. **Falha fechada.** Sem contexto de organização, recusa — nunca consulta sem filtro.
3. **O servidor decide, a interface reflete.** Estados com peso legal (`isFrozen`, `isActive`) não são recalculados no cliente.
4. **Códigos de erro legíveis por máquina** (`MODULE_DISABLED`, `ORGANIZATION_SUSPENDED`, `MEETING_FROZEN`) para o cliente distinguir causas.
5. **Correções alcançam o acervo existente**, não só registros novos — daí os scripts de backfill e o endpoint de edição de vigência.
6. **Aritmética de data conforme a pergunta**: dias de calendário para "quantos dias faltam"; instantes UTC para "72 horas exatas".

---

## Dívidas técnicas registradas

Documentadas em `docs/TechStack.md` §11:

- **Segurança**: `uploads/` é servido sem autenticação, inclusive documentos com nível de sigilo. Aceito conscientemente para desenvolvimento local; **exige endpoint autenticado antes de uso com dado real**
- Histórico de migrations do Prisma com drift (`migrate dev` bloqueado; fluxo atual é `db push` + SQL versionado)
- ESLint não instalado no backend
- Arquivos hospedados no R2 antes da migração não foram transferidos
- Resolução de permissões ainda triplicada em três módulos
- Helpers de moeda: três cópias remanescentes a migrar para `lib/currency.ts`

---

## Documentação relacionada

- `docs/AppFeatures.md` — inventário funcional, com as seções novas de cada épico
- `docs/TechStack.md` — decisões de stack e registro de dívida técnica
- `.specify/specs/` e `.specify/plans/` — especificações e planos completos de cada ciclo
