# SIMP Backend

Backend do **SIMP — Sistema Integrado de Gestão Municipal**. Plataforma SaaS B2B para administração municipal.

**Stack:** Fastify 5.7 · Prisma 6 · PostgreSQL 16 · Redis 7 · TypeScript · JWT/Argon2 · Cloudflare R2 · Brevo (email)

**Repositório frontend:** [SIMP-FRONTEND](https://github.com/SIMP-SIMPLIFICA/SIMP-FRONTEND)

---

## Pré-requisitos

- Node 22 (`nvm use 22`)
- Docker e Docker Compose
- PostgreSQL 16 (via Docker ou externo)
- Redis 7 (via Docker ou externo)

---

## Setup local

```bash
# 1. Instalar dependências
nvm use 22
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# 3. Subir PostgreSQL + Redis
docker-compose up -d

# 4. Gerar client Prisma + aplicar migrations
npx prisma generate
npx prisma migrate dev

# 5. Popular banco com dados iniciais
npm run db:seed

# 6. Iniciar servidor de desenvolvimento
npm run dev
```

Servidor disponível em `http://localhost:3000`

---

## Variáveis de ambiente

Copiar `.env.example` e preencher:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | ✅ | Connection string PostgreSQL |
| `REDIS_URL` | ✅ | Connection string Redis |
| `JWT_ACCESS_SECRET` | ✅ | Segredo JWT access token (32+ chars) |
| `JWT_REFRESH_SECRET` | ✅ | Segredo JWT refresh token (32+ chars) |
| `SESSION_SECRET` | ✅ | Segredo de sessão (32+ chars) |
| `APP_URL` | ✅ | URL do backend (ex: `http://localhost:3000`) |
| `FRONTEND_URL` | ✅ | URL do frontend (ex: `http://localhost:5173`) |
| `CORS_ORIGIN` | ✅ | Origins permitidos no CORS (vírgula-separados) |
| `SMTP_HOST` | ✅ | Host SMTP (Brevo em produção) |
| `SMTP_PORT` | ✅ | Porta SMTP |
| `SMTP_USER` | ✅ | Usuário SMTP |
| `SMTP_PASS` | ✅ | Senha SMTP |
| `R2_ACCOUNT_ID` | ✅ | ID da conta Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | ✅ | Access key R2 |
| `R2_SECRET_ACCESS_KEY` | ✅ | Secret key R2 |
| `R2_BUCKET_NAME` | ✅ | Nome do bucket R2 |
| `R2_PUBLIC_URL` | ✅ | URL pública do bucket R2 |
| `SENTRY_DSN` | opcional | DSN do Sentry para error tracking |
| `BETTERSTACK_SOURCE_TOKEN` | opcional | Token Betterstack para logs |

Gerar segredos seguros:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Comandos

```bash
# Desenvolvimento
npm run dev              # Servidor com hot-reload

# Build
npm run build            # Compila TypeScript para dist/src/
npm start                # Inicia servidor compilado

# Banco de dados
npx prisma migrate dev   # Cria e aplica migration de desenvolvimento
npx prisma migrate deploy  # Aplica migrations em produção
npx prisma generate      # Gera Prisma Client
npx prisma studio        # GUI do banco (localhost:5555)
npm run db:seed          # Popula banco com dados iniciais

# Qualidade
npm run lint             # ESLint
npm run lint:fix         # ESLint com auto-fix
npx tsc -b               # Type check (usar este, não tsc --noEmit)

# Testes
npm run test             # Vitest
npm run test:coverage    # Vitest com cobertura
```

---

## Estrutura do projeto

```
src/
├── config/          # Configurações (database, redis, sentry, env)
├── controllers/     # Handlers de cada módulo
├── middleware/      # authenticate, authorize, rateLimiter
├── plugins/         # Fastify plugins (jwt, cors, multipart...)
├── routes/          # Definição de rotas por módulo
├── services/        # Lógica de negócio (pdf, certificate, email...)
├── utils/           # Utilitários (pagination, r2, pdf.utils...)
└── index.ts         # Entry point

prisma/
├── schema.prisma    # Schema do banco
├── migrations/      # Histórico de migrations
└── seeds/           # Dados iniciais
```

---

## Módulos da API

| Módulo | Prefixo | Descrição |
|--------|---------|-----------|
| Auth | `/api/v1/auth` | Login, registro, refresh, 2FA, reset de senha |
| Users | `/api/v1/users` | CRUD de usuários + busca org-scoped |
| Roles | `/api/v1/roles` | RBAC — papéis e permissões |
| Organizations | `/api/v1/organizations` | Multi-tenant — gestão de organizações |
| Finance | `/api/v1/finance` | Lançamentos, categorias, contas, relatórios, exportação |
| Workspaces | `/api/v1/workspaces` | Boards Kanban, membros |
| Tasks | `/api/v1/tasks` | Tarefas, checklist, comentários, anexos |
| Communication | `/api/v1/communication` | Ofícios, memorandos, mensagens |
| Virtual Process | `/api/v1/virtual-process` | Processos digitais municipais |
| Notifications | `/api/v1/notifications` | SSE — notificações em tempo real |
| Calendar | `/api/v1/calendar` | Eventos do calendário |
| Notes | `/api/v1/notes` | Anotações |
| Upload | `/api/v1/upload` | Upload genérico → Cloudflare R2 |
| Admin | `/api/v1/admin` | Painel superadmin |

Documentação interativa: `http://localhost:3000/documentation` (Swagger)

---

## Deploy (Render)

O arquivo `render.yaml` define o blueprint do ambiente dev:

- **Serviço:** `simp-backend-dev` (branch `develop`, free plan, Oregon)
- **Build:** `npm ci --include=dev && npx prisma generate && npm run build`
- **Start:** `npx prisma migrate deploy && node dist/src/index.js`
- **Banco:** PostgreSQL `simp-db-dev` (free, expira periodicamente)
- **Cache:** Redis `simp-redis-dev` (free)

Auto-deploy ativado na branch `develop`.

---

## Contas de desenvolvimento (após seed)

| Role | Email | Senha |
|------|-------|-------|
| Super Admin | admin@example.com | Admin123!@# |
| Admin Itapevi | admin.itapevi@example.com | Admin123!@# |
| Admin Cotia | admin.cotia@example.com | Admin123!@# |

> Alterar todas as senhas antes de expor em produção real.

---

## CI/CD

| Pipeline | Trigger | O que faz |
|----------|---------|-----------|
| `ci.yml` | push/PR → develop/main | Lint + type check + testes + build |
| `security.yml` | push/PR + semanal | npm audit + CodeQL + TruffleHog + Claude Review |
| `failure-analyst.yml` | CI falha | Claude Haiku analisa logs → Issue + Discord |
| `meta-agent.yml` | Mensal | Revisa versões de dependências → PR de manutenção |
| `pr-review.yml` | Todo PR | Claude AI faz code review |
