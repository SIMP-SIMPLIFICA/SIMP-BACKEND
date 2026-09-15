# Postman — SIMP-BACKEND

Coleção completa das rotas ativas do backend, extraída de `src/routes/`, `src/controllers/` e dos
schemas Zod de validação.

## Como importar

1. Postman → **Import** → arraste os dois arquivos:
   - `SIMP-Backend.postman_collection.json`
   - `SIMP-Backend.postman_environment.json`
2. Selecione o Environment **"SIMP-BACKEND — Local"** no seletor do canto superior direito.
3. Ajuste `baseUrl` no Environment se a API não estiver em `http://localhost:3000`.
4. Rode **1. Autenticação & Sessão → Login** (preencha `loginEmail`/`loginPassword` no Environment
   antes). O script em *Tests* salva o token retornado em `{{token}}` automaticamente — todas as
   outras pastas herdam esse Bearer Token da coleção, sem precisar copiar/colar.

Alternativa: **2. Organizações & Multi-Tenant → Onboarding de nova organização (público)** cria uma
organização E um admin numa única chamada, e já salva `token` e `organizationId` no Environment.

## Convenções desta coleção

- **Path params** (`:id`, `:departmentId` etc.) viram variáveis de path editáveis na aba **Params**
  de cada requisição no Postman. Os exemplos usam variáveis de Environment como
  `{{departmentId}}`, `{{dailyAllowanceId}}` — preencha-as com IDs reais (copiados da resposta de um
  `POST` anterior) para encadear as chamadas sem editar a URL toda vez.
- **Corpos de requisição** (`raw json`) seguem estritamente os schemas Zod de criação/edição de cada
  controller — campos opcionais no schema aparecem como opcionais aqui também.
- **Uploads multipart** (logo, PDF, anexos) vêm com o campo `file` do tipo *file*, vazio — selecione
  o arquivo local na aba **Body** antes de enviar.
- **Rotas públicas** (sem autenticação — registro, login, portal de validação por QR Code, health
  check etc.) têm `Auth: No Auth` sobrescrito na própria requisição; todo o resto herda o Bearer da
  coleção.

## Um detalhe da API que vale saber antes de usar

O prefixo das rotas **não é uniforme**. Alguns módulos vivem sob `/api/v1/...`
(auth, users, roles, admin, communication, settings, audit, daily-allowances, beneficiaries,
fleet-fuelings, library, upload, utilities/calendar, utilities/notes) e outros na **raiz do
servidor**, sem o prefixo `/api/v1` (departments, budget-laws, qdd-items, virtual-processes,
covenants, protocols, councils, support, finance, workspaces, tasks, notifications). Isso está
correto — não é um erro da coleção — e reflete `src/config/routes.ts` e `src/app.ts` tal como estão
hoje no código. Cada requisição já usa o prefixo certo para a rota correspondente.

## Pastas

1. Autenticação & Sessão
2. Organizações & Multi-Tenant
3. Usuários & Perfis (RBAC)
4. Departamentos & Vínculos
5. Planejamento Orçamentário (Leis Orçamentárias, QDD)
6. Diárias (Daily Allowances) — inclui Beneficiários
7. Processos Virtuais & Convênios
8. Conselhos Municipais
9. Frota / Abastecimentos
10. Trilha de Auditoria (Audit Ledger)
11. Protocolos & Atos Normativos
12. Financeiro
13. Biblioteca de Documentos
14. Comunicação Interna
15. Workspaces & Tarefas
16. Utilidades (Calendário, Notas, Notificações, Upload genérico)
17. Suporte
18. Validação Pública & Saúde do Sistema

**252 requisições** ao todo, mapeando toda a árvore de rotas registrada em `registerRoutes()` e em
`app.ts` (upload/library, registrados fora de `registerRoutes` por herança do boot original).

## Regenerando a coleção

Se as rotas mudarem, o gerador que produziu estes dois arquivos está em `gen-postman.mjs`, neste
mesmo diretório. Ele lê nada do código automaticamente — é uma lista curada manualmente a partir de
`src/routes/`, `src/controllers/` e `src/schemas/` — então uma rota nova precisa ser adicionada ao
script à mão. Para regenerar:

```
node postman/gen-postman.mjs postman
```

Isso sobrescreve os dois arquivos `.json` neste diretório (preserva o `README.md`).
