# Notification Center — Refatoração Completa

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o NotificationBell atual em um Centro de Notificações Inteligente com preferências por usuário, fila assíncrona de e-mails via BullMQ, auto-limpeza, RBAC estrito e deep links seguros.

**Architecture:** Notification Service existente (SSE + Prisma) é estendido com: (1) modelo `NotificationPreference` dedicado no Prisma para `emailNotifications` e `autoClearDays`; (2) fila BullMQ (`email-notification`) processada por um worker assíncrono que checa a preferência antes de enviar; (3) cron job de auto-limpeza que respeita `autoClearDays` por usuário. O frontend recebe um Popover revampado com abas, ações rápidas e painel de configurações inline.

**Tech Stack:** Fastify 5.7 | Prisma 6 | PostgreSQL 16 | Redis 7 | BullMQ 5 | Nodemailer | TypeScript (CommonJS) | React + Tailwind + Radix UI

---

## Escopo — O que este plano NÃO é

Este repositório é o **backend** (SIMP-BACKEND). As tarefas de frontend (Tasks 7–8) devem ser executadas no repositório **SIMP-FRONTEND** separadamente e são incluídas aqui apenas como referência de contrato de API. Não misturar commits.

---

## Mapa de Arquivos

### Backend (este repo)

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Modify | `prisma/schema.prisma` | Adicionar modelo `NotificationPreference` + índices em `Notification` |
| Auto | `prisma/migrations/*/migration.sql` | Gerado por `prisma migrate dev` |
| Create | `src/lib/redis-bullmq.ts` | Conexão ioredis dedicada para BullMQ (separada do cliente redis existente) |
| Create | `src/queues/email-notification.queue.ts` | Definição da fila BullMQ + helper de enqueue |
| Create | `src/workers/email-notification.worker.ts` | Worker que consome a fila e envia e-mails |
| Create | `src/jobs/auto-clear-notifications.job.ts` | Cron: apaga notificações lidas conforme `autoClearDays` de cada usuário |
| Create | `src/schemas/notification-preference.schema.ts` | Zod schemas para preferências |
| Modify | `src/services/notification.service.ts` | Enfileirar job de e-mail após `notify()` |
| Modify | `src/controllers/notification.controller.ts` | Adicionar `getPreferences` + `updatePreferences` |
| Modify | `src/routes/notification.routes.ts` | Adicionar rotas de preferências |
| Modify | `src/index.ts` | Inicializar worker BullMQ + novo cron job |
| Modify | `SIMP.postman_collection.json` | Documentar novos endpoints |

### Frontend (SIMP-FRONTEND — referência)

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Modify | `src/components/NotificationBell.tsx` | Revamp visual com abas, ações rápidas, painel de config |
| Create | `src/hooks/useNotificationPreferences.ts` | Hook para buscar e atualizar preferências |

---

## Task 1: Schema Prisma — Modelo NotificationPreference

**Files:**
- Modify: `prisma/schema.prisma`

### Contexto
O campo `preferences: Json?` já existe no modelo `User` mas é genérico. Para poder fazer queries eficientes e tipadas (e.g., buscar todos os usuários com `autoClearDays = 7`), criamos um modelo dedicado `NotificationPreference`. Também adicionamos índices em `Notification` para as queries de limpeza automática.

- [ ] **Step 1: Adicionar modelo NotificationPreference e índices ao schema**

Abrir `prisma/schema.prisma` e adicionar após o modelo `Notification` (linha ~400):

```prisma
model NotificationPreference {
  id                 String  @id @default(cuid())
  userId             String  @unique @map("user_id")
  emailNotifications Boolean @default(false) @map("email_notifications")
  autoClearDays      Int     @default(0) @map("auto_clear_days") // 0 = nunca limpar

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notification_preferences")
}
```

Adicionar também índices ao modelo `Notification` existente (já em `prisma/schema.prisma`, localizar o modelo e adicionar antes do `}`):

```prisma
  @@index([userId, read])
  @@index([userId, createdAt])
  @@index([createdAt])
```

Adicionar relação no modelo `User` (após `notifications Notification[]`):

```prisma
  notificationPreference NotificationPreference?
```

- [ ] **Step 2: Criar a migration**

```bash
nvm use 22
npx prisma migrate dev --name add_notification_preferences
```

Saída esperada: `✓ Generated Prisma Client` e arquivo em `prisma/migrations/*/migration.sql`.

- [ ] **Step 3: Verificar migration gerada**

```bash
cat prisma/migrations/$(ls prisma/migrations | tail -1)/migration.sql
```

Deve conter: `CREATE TABLE "notification_preferences"` com colunas `id`, `user_id`, `email_notifications`, `auto_clear_days`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(notifications): add NotificationPreference model and Notification indexes"
```

---

## Task 2: Redis Client para BullMQ

**Files:**
- Create: `src/lib/redis-bullmq.ts`

### Contexto
BullMQ requer uma conexão `ioredis`. O projeto já usa o pacote `redis` (node-redis) em outro lugar — são clientes distintos. Criamos um módulo separado para evitar conflito.

- [ ] **Step 1: Instalar BullMQ**

```bash
nvm use 22
npm install bullmq
```

Saída esperada: `added N packages`. Verificar que `"bullmq"` aparece em `package.json` dependencies.

- [ ] **Step 2: Criar src/lib/redis-bullmq.ts**

```typescript
/**
 * Conexão ioredis dedicada para BullMQ.
 * BullMQ internamente usa ioredis (não o pacote `redis` do projeto).
 * Configuração separada para isolamento de responsabilidade.
 */
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'

export function getBullMQConnection() {
  const url = config.redis?.url ?? process.env.REDIS_URL ?? 'redis://localhost:6379'
  const parsed = new URL(url)

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null // Obrigatório para BullMQ workers
  }
}
```

- [ ] **Step 3: Verificar que config.redis existe**

```bash
grep -n "redis" src/config/config.ts 2>/dev/null || grep -rn "redis" src/config/ 2>/dev/null | head -10
```

Se não existir `config.redis.url`, o fallback `process.env.REDIS_URL` garante funcionamento. Verificar que `.env` tem `REDIS_URL=redis://localhost:6379`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/redis-bullmq.ts package.json package-lock.json
git commit -m "feat(notifications): add BullMQ dependency and ioredis connection helper"
```

---

## Task 3: Fila BullMQ — Definição e Enqueue

**Files:**
- Create: `src/queues/email-notification.queue.ts`

- [ ] **Step 1: Criar src/queues/email-notification.queue.ts**

```typescript
import { Queue } from 'bullmq'
import { getBullMQConnection } from '@/lib/redis-bullmq.js'

export interface EmailNotificationJobData {
  notificationId: string
  userId: string
  userEmail: string
  title: string
  message: string
  link?: string
}

export const emailNotificationQueue = new Queue<EmailNotificationJobData>(
  'email-notifications',
  {
    connection: getBullMQConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 }, // remove jobs completados após 1h
      removeOnFail: { age: 86400 }     // mantém jobs falhos por 24h para debug
    }
  }
)

emailNotificationQueue.on('error', (err) => {
  console.error('[email-notification-queue] Queue error:', err)
})

/**
 * Enfileira um job de envio de e-mail de notificação.
 * Chamado pelo NotificationService após salvar a notificação no banco.
 */
export async function enqueueEmailNotification(data: EmailNotificationJobData): Promise<void> {
  await emailNotificationQueue.add('send-email', data, {
    jobId: `notif-email-${data.notificationId}` // idempotência: evita duplicatas
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/queues/email-notification.queue.ts
git commit -m "feat(notifications): add BullMQ email notification queue"
```

---

## Task 4: Worker BullMQ — Processar Envio de E-mail

**Files:**
- Create: `src/workers/email-notification.worker.ts`

- [ ] **Step 1: Criar src/workers/email-notification.worker.ts**

```typescript
import { Worker, Job } from 'bullmq'
import { getBullMQConnection } from '@/lib/redis-bullmq.js'
import { emailService } from '@/services/email.service.js'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'
import type { EmailNotificationJobData } from '@/queues/email-notification.queue.js'

/**
 * Worker que consome a fila 'email-notifications'.
 * Verifica preferência do usuário (emailNotifications === true) antes de enviar.
 * Segurança: re-verifica a preferência no momento do processamento,
 * não no enqueue — evita envio se o usuário desativou após o enqueue.
 */
async function processEmailNotification(job: Job<EmailNotificationJobData>): Promise<void> {
  const { userId, userEmail, title, message, link, notificationId } = job.data

  logger.info({ jobId: job.id, notificationId, userId }, '[email-worker] Processando job')

  // Re-verifica preferência em tempo real (Zero Trust)
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId }
  })

  if (!pref?.emailNotifications) {
    logger.info({ userId, notificationId }, '[email-worker] Usuário sem emailNotifications. Pulando.')
    return
  }

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const actionUrl = link ? `${frontendUrl}${link}` : frontendUrl

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><style>
      body { font-family: sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
      .card { background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb; }
      .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #111827; }
      .message { font-size: 16px; color: #374151; margin-bottom: 24px; }
      .btn { display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
             text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
      .footer { margin-top: 24px; font-size: 12px; color: #9ca3af; }
    </style></head>
    <body>
      <div class="card">
        <div class="title">🔔 ${title}</div>
        <div class="message">${message}</div>
        ${link ? `<a href="${actionUrl}" class="btn">Ver detalhes</a>` : ''}
        <div class="footer">
          Você recebeu esta notificação do SIMP — Sistema Integrado de Gestão Municipal.<br>
          Para não receber mais e-mails, acesse suas preferências de notificação.
        </div>
      </div>
    </body>
    </html>
  `

  await emailService.sendEmail({
    to: userEmail,
    subject: `[SIMP] ${title}`,
    html,
    text: `${title}\n\n${message}${link ? `\n\nAcesse: ${actionUrl}` : ''}`
  })

  logger.info({ userId, notificationId }, '[email-worker] E-mail enviado com sucesso')
}

let worker: Worker | null = null

export function startEmailNotificationWorker(): void {
  worker = new Worker<EmailNotificationJobData>(
    'email-notifications',
    processEmailNotification,
    {
      connection: getBullMQConnection(),
      concurrency: 5 // processa até 5 e-mails simultaneamente
    }
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, '[email-worker] Job concluído')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, '[email-worker] Job falhou')
  })

  logger.info('[email-worker] Worker de e-mail iniciado')
}

export async function stopEmailNotificationWorker(): Promise<void> {
  if (worker) {
    await worker.close()
    logger.info('[email-worker] Worker encerrado gracefully')
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workers/email-notification.worker.ts
git commit -m "feat(notifications): add BullMQ email notification worker with per-user preference check"
```

---

## Task 5: Auto-Clear Cron Job

**Files:**
- Create: `src/jobs/auto-clear-notifications.job.ts`

- [ ] **Step 1: Criar src/jobs/auto-clear-notifications.job.ts**

```typescript
import cron from 'node-cron'
import { prisma } from '@/lib/prisma.js'
import { logger } from '@/utils/logger.js'

/**
 * Apaga notificações lidas mais antigas que `autoClearDays` dias,
 * respeitando a preferência individual de cada usuário.
 * Nunca apaga de usuários com autoClearDays = 0 (nunca limpar).
 *
 * Roda todo dia às 02:00 (horário do servidor).
 */
export function startAutoClearNotificationsJob(): void {
  const schedule = process.env.NOTIFICATION_CLEAR_CRON ?? '0 2 * * *'

  cron.schedule(schedule, async () => {
    logger.info('[auto-clear-notifications] Iniciando limpeza de notificações lidas...')

    try {
      // Busca usuários que optaram por auto-limpeza (autoClearDays > 0)
      const preferences = await prisma.notificationPreference.findMany({
        where: { autoClearDays: { gt: 0 } },
        select: { userId: true, autoClearDays: true }
      })

      if (preferences.length === 0) {
        logger.info('[auto-clear-notifications] Nenhum usuário com auto-limpeza configurada.')
        return
      }

      let totalDeleted = 0

      // Processa cada usuário individualmente para respeitar seu limiar de dias
      await Promise.allSettled(
        preferences.map(async ({ userId, autoClearDays }) => {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - autoClearDays)

          const result = await prisma.notification.deleteMany({
            where: {
              userId,
              read: true,
              createdAt: { lt: cutoff }
            }
          })

          totalDeleted += result.count
        })
      )

      logger.info(`[auto-clear-notifications] ${totalDeleted} notificação(ões) removida(s).`)
    } catch (err) {
      logger.error(err, '[auto-clear-notifications] Erro durante limpeza')
    }
  })

  logger.info(`[auto-clear-notifications] Job agendado: "${schedule}"`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/jobs/auto-clear-notifications.job.ts
git commit -m "feat(notifications): add auto-clear cron job respecting per-user autoClearDays preference"
```

---

## Task 6: Atualizar NotificationService — Enqueue de E-mail

**Files:**
- Modify: `src/services/notification.service.ts`

- [ ] **Step 1: Ler o arquivo atual** (já lido acima — linha 27 é o método `notify`)

- [ ] **Step 2: Atualizar o método notify para enfileirar e-mail**

Substituir o arquivo `src/services/notification.service.ts` pelo seguinte conteúdo:

```typescript
import { prisma } from '@/lib/prisma.js'
import type { FastifyReply } from 'fastify'
import type { ServerResponse } from 'node:http'
import { EventEmitter } from 'events'
import { enqueueEmailNotification } from '@/queues/email-notification.queue.js'
import { logger } from '@/utils/logger.js'

export interface NotifyData {
  userId: string
  title: string
  message: string
  type: string
  link?: string
  entityId?: string
}

class NotificationService extends EventEmitter {
  private clients: Map<string, (FastifyReply & { raw: ServerResponse })[]> = new Map()

  addClient(userId: string, reply: FastifyReply & { raw: ServerResponse }) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, [])
    }
    this.clients.get(userId)?.push(reply)

    reply.raw.on('close', () => {
      this.removeClient(userId, reply)
    })
  }

  removeClient(userId: string, reply: FastifyReply & { raw: ServerResponse }) {
    const userClients = this.clients.get(userId)
    if (userClients) {
      this.clients.set(userId, userClients.filter(c => c !== reply))
    }
  }

  async notify(data: NotifyData) {
    // 1. Salvar no banco
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type,
        link: data.link,
        entityId: data.entityId,
        read: false
      }
    })

    // 2. Enviar real-time via SSE (se o usuário estiver online)
    const userClients = this.clients.get(data.userId)
    if (userClients && userClients.length > 0) {
      const payload = `data: ${JSON.stringify(notification)}\n\n`
      userClients.forEach(client => client.raw.write(payload))
    }

    // 3. Enfileirar e-mail assíncrono (fire-and-forget seguro)
    // O worker re-verifica a preferência do usuário antes de enviar.
    this.scheduleEmailJob(notification.id, data).catch(err => {
      logger.error({ err, notificationId: notification.id }, '[notification-service] Falha ao enfileirar e-mail')
    })

    return notification
  }

  private async scheduleEmailJob(notificationId: string, data: NotifyData): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true }
    })

    if (!user?.email) return

    await enqueueEmailNotification({
      notificationId,
      userId: data.userId,
      userEmail: user.email,
      title: data.title,
      message: data.message,
      link: data.link
    })
  }

  async notifyMany(userIds: string[], data: Omit<NotifyData, 'userId'>) {
    return Promise.all(userIds.map(id => this.notify({ ...data, userId: id })))
  }
}

export const notificationService = new NotificationService()
```

- [ ] **Step 3: Verificar tipos**

```bash
nvm use 22
npx tsc -b --noEmit 2>&1 | grep -i "notification" | head -20
```

Saída esperada: sem erros relacionados a notification.

- [ ] **Step 4: Commit**

```bash
git add src/services/notification.service.ts
git commit -m "feat(notifications): enqueue async email job from notify() — fire and forget with user re-check"
```

---

## Task 7: Zod Schemas de Preferências

**Files:**
- Create: `src/schemas/notification-preference.schema.ts`

- [ ] **Step 1: Criar src/schemas/notification-preference.schema.ts**

```typescript
import { z } from 'zod'

export const updatePreferenceSchema = z.object({
  emailNotifications: z.boolean({
    required_error: 'emailNotifications é obrigatório',
    invalid_type_error: 'emailNotifications deve ser boolean'
  }),
  autoClearDays: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(7),
    z.literal(30)
  ], {
    errorMap: () => ({ message: 'autoClearDays deve ser 0, 1, 7 ou 30' })
  })
})

export type UpdatePreferenceInput = z.infer<typeof updatePreferenceSchema>
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/notification-preference.schema.ts
git commit -m "feat(notifications): add Zod schema for notification preferences"
```

---

## Task 8: Controller — Adicionar Endpoints de Preferências

**Files:**
- Modify: `src/controllers/notification.controller.ts`

- [ ] **Step 1: Substituir o controller com os novos métodos**

Adicionar os dois novos métodos ao final da classe `NotificationController`, antes do `}` de fechamento:

```typescript
  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;

    // Upsert garante que todo usuário sempre tem uma preference (com defaults)
    const pref = await prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId, emailNotifications: false, autoClearDays: 0 }
    });

    return reply.send({ data: pref });
  }

  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const { updatePreferenceSchema } = await import('../schemas/notification-preference.schema.js');
    const userId = request.user.id;

    const body = updatePreferenceSchema.parse(request.body);

    const pref = await prisma.notificationPreference.upsert({
      where: { userId },
      update: {
        emailNotifications: body.emailNotifications,
        autoClearDays: body.autoClearDays
      },
      create: {
        userId,
        emailNotifications: body.emailNotifications,
        autoClearDays: body.autoClearDays
      }
    });

    return reply.send({ data: pref });
  }
```

Também adicionar o import do schema no topo do arquivo (após os imports existentes):

```typescript
import { updatePreferenceSchema } from '../schemas/notification-preference.schema.js';
```

(Ou manter o dynamic import dentro do método — ambos funcionam em CJS.)

- [ ] **Step 2: Verificar types**

```bash
nvm use 22
npx tsc -b --noEmit 2>&1 | grep -i "controller\|prefer" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/notification.controller.ts
git commit -m "feat(notifications): add getPreferences and updatePreferences controller methods"
```

---

## Task 9: Rotas — Adicionar Endpoints de Preferências

**Files:**
- Modify: `src/routes/notification.routes.ts`

- [ ] **Step 1: Adicionar as duas novas rotas**

O arquivo atual tem 16 linhas. Adicionar antes da última linha (`}`):

```typescript
  app.get('/preferences', { preHandler: requirePermission(['notifications:read']) }, notificationController.getPreferences);
  app.patch('/preferences', { preHandler: requirePermission(['notifications:write']) }, notificationController.updatePreferences);
```

Arquivo final:

```typescript
import { FastifyInstance } from 'fastify';
import { NotificationController } from '../controllers/notification.controller.js';
import { authMiddleware, requirePermission } from '../middleware/auth.middleware.js';

const notificationController = new NotificationController();

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/stream', notificationController.stream);
  app.get('/', { preHandler: requirePermission(['notifications:read']) }, notificationController.list);
  app.patch('/:id/read', { preHandler: requirePermission(['notifications:write']) }, notificationController.markAsRead);
  app.patch('/read-all', { preHandler: requirePermission(['notifications:write']) }, notificationController.markAllRead);
  app.delete('/', { preHandler: requirePermission(['notifications:manage']) }, notificationController.deleteAll);
  app.delete('/:id', { preHandler: requirePermission(['notifications:manage']) }, notificationController.delete);
  app.get('/preferences', { preHandler: requirePermission(['notifications:read']) }, notificationController.getPreferences);
  app.patch('/preferences', { preHandler: requirePermission(['notifications:write']) }, notificationController.updatePreferences);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/notification.routes.ts
git commit -m "feat(notifications): expose GET/PATCH /preferences endpoints"
```

---

## Task 10: Inicializar Worker e Novo Job em index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Adicionar imports no topo de src/index.ts**

Após a linha `import { startExpireTasksJob } from './jobs/expire-tasks.job.js'`, adicionar:

```typescript
import { startEmailNotificationWorker, stopEmailNotificationWorker } from './workers/email-notification.worker.js'
import { startAutoClearNotificationsJob } from './jobs/auto-clear-notifications.job.js'
```

- [ ] **Step 2: Inicializar na função start()**

Após a linha `startExpireTasksJob()`, adicionar:

```typescript
    startEmailNotificationWorker()
    startAutoClearNotificationsJob()
```

- [ ] **Step 3: Encerrar worker no shutdown graceful**

Localizar o arquivo `src/utils/graceful-shutdown.ts` e verificar se há hook de shutdown. Se houver, adicionar `stopEmailNotificationWorker()`. Se não houver, adicionar listener em `index.ts` após `server.listen()`:

```typescript
    // Graceful shutdown do BullMQ worker
    const shutdown = async () => {
      await stopEmailNotificationWorker()
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
```

- [ ] **Step 4: Build completo**

```bash
nvm use 22
npx tsc -b
npm run lint
npm run build
```

Saída esperada: zero erros de type, zero erros de lint, build passa.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(notifications): start BullMQ email worker and auto-clear cron job on server startup"
```

---

## Task 11: Atualizar Postman Collection

**Files:**
- Modify: `SIMP.postman_collection.json`

- [ ] **Step 1: Adicionar novos endpoints na pasta Notifications**

Localizar a pasta `Notifications` na collection e adicionar dois novos requests:

**GET /api/v1/notifications/preferences**
```json
{
  "name": "Get Notification Preferences",
  "request": {
    "method": "GET",
    "header": [{ "key": "Authorization", "value": "Bearer {{accessToken}}" }],
    "url": { "raw": "{{baseUrl}}/api/v1/notifications/preferences", "host": ["{{baseUrl}}"], "path": ["api", "v1", "notifications", "preferences"] }
  }
}
```

**PATCH /api/v1/notifications/preferences**
```json
{
  "name": "Update Notification Preferences",
  "request": {
    "method": "PATCH",
    "header": [
      { "key": "Authorization", "value": "Bearer {{accessToken}}" },
      { "key": "Content-Type", "value": "application/json" }
    ],
    "body": {
      "mode": "raw",
      "raw": "{\n  \"emailNotifications\": true,\n  \"autoClearDays\": 7\n}"
    },
    "url": { "raw": "{{baseUrl}}/api/v1/notifications/preferences", "host": ["{{baseUrl}}"], "path": ["api", "v1", "notifications", "preferences"] }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add SIMP.postman_collection.json
git commit -m "docs(postman): add notification preferences endpoints"
```

---

## Task 12: Testes de Integração (Vitest)

**Files:**
- Create: `src/tests/notifications/notification-preferences.test.ts`

- [ ] **Step 1: Criar testes dos novos endpoints**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma.js'

// Testes de integração leves — verificam lógica sem HTTP
// Para testes HTTP completos usar Postman/supertest

describe('NotificationPreference', () => {
  const testUserId = 'test-user-pref-' + Date.now()

  afterAll(async () => {
    await prisma.notificationPreference.deleteMany({ where: { userId: testUserId } })
  })

  it('deve criar preferência com defaults ao fazer upsert sem registro prévio', async () => {
    const pref = await prisma.notificationPreference.upsert({
      where: { userId: testUserId },
      update: {},
      create: { userId: testUserId, emailNotifications: false, autoClearDays: 0 }
    })

    expect(pref.emailNotifications).toBe(false)
    expect(pref.autoClearDays).toBe(0)
  })

  it('deve atualizar preferência de emailNotifications', async () => {
    await prisma.notificationPreference.upsert({
      where: { userId: testUserId },
      update: { emailNotifications: true, autoClearDays: 7 },
      create: { userId: testUserId, emailNotifications: true, autoClearDays: 7 }
    })

    const updated = await prisma.notificationPreference.findUnique({ where: { userId: testUserId } })
    expect(updated?.emailNotifications).toBe(true)
    expect(updated?.autoClearDays).toBe(7)
  })

  it('deve rejeitar autoClearDays inválido via Zod', async () => {
    const { updatePreferenceSchema } = await import('@/schemas/notification-preference.schema.js')

    expect(() =>
      updatePreferenceSchema.parse({ emailNotifications: true, autoClearDays: 15 })
    ).toThrow()
  })

  it('deve aceitar autoClearDays válidos: 0, 1, 7, 30', async () => {
    const { updatePreferenceSchema } = await import('@/schemas/notification-preference.schema.js')

    for (const days of [0, 1, 7, 30] as const) {
      expect(() =>
        updatePreferenceSchema.parse({ emailNotifications: false, autoClearDays: days })
      ).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Rodar testes**

```bash
nvm use 22
npx vitest run src/tests/notifications/ --passWithNoTests
```

Saída esperada: todos os testes passando.

- [ ] **Step 3: Commit**

```bash
git add src/tests/
git commit -m "test(notifications): add integration tests for NotificationPreference"
```

---

## Task 13: Frontend — Hook de Preferências (SIMP-FRONTEND)

> **Atenção:** Esta task deve ser executada no repositório `SIMP-FRONTEND`, não neste.

**Files:**
- Create: `src/hooks/useNotificationPreferences.ts`

**Contrato de API:**

```
GET  /api/v1/notifications/preferences
Response: { data: { id, userId, emailNotifications, autoClearDays } }

PATCH /api/v1/notifications/preferences
Body:    { emailNotifications: boolean, autoClearDays: 0 | 1 | 7 | 30 }
Response: { data: { id, userId, emailNotifications, autoClearDays } }
```

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface NotificationPreference {
  id: string
  userId: string
  emailNotifications: boolean
  autoClearDays: 0 | 1 | 7 | 30
}

export function useNotificationPreferences() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<NotificationPreference>({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await api.get('/notifications/preferences')
      return res.data.data
    }
  })

  const mutation = useMutation({
    mutationFn: async (payload: Pick<NotificationPreference, 'emailNotifications' | 'autoClearDays'>) => {
      const res = await api.patch('/notifications/preferences', payload)
      return res.data.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['notification-preferences'], updated)
    }
  })

  return { preferences: data, isLoading, updatePreferences: mutation.mutateAsync }
}
```

---

## Task 14: Frontend — NotificationBell Revamp (SIMP-FRONTEND)

> **Atenção:** Esta task deve ser executada no repositório `SIMP-FRONTEND`, não neste.

**Files:**
- Modify: `src/components/NotificationBell.tsx`

### Estrutura Visual (baseada na referência Dribbble)

```
┌─────────────────────────────────────────┐
│  🔔 Notificações          [⚙️ Config]   │
├──────────────┬──────────────────────────┤
│  Todas  │  Não lidas (3)               │  ← Tabs
├──────────────────────────────────────────┤
│  [Avatar] Título                         │
│           Mensagem preview...     10m    │
│           [Marcar lida] [Excluir]        │
├──────────────────────────────────────────┤
│  [Avatar] Título                  1h    │
│           ...                            │
└──────────────────────────────────────────┘
```

### Ícones por tipo de notificação

| `type` | Ícone | Cor |
|--------|-------|-----|
| `TASK_STATUS` | `CheckCircle` | azul |
| `WORKSPACE` | `Layers` | roxo |
| `FINANCE` | `DollarSign` | verde |
| `DOCUMENT` | `FileText` | âmbar |
| `SYSTEM` | `Bell` | cinza |

### Painel de Config (ao clicar em ⚙️)

```
┌──────────────────────────────────────────┐
│  ← Voltar        Configurações           │
├──────────────────────────────────────────┤
│  Notificações por e-mail    [Toggle ●]   │
│  Limpar notificações lidas após:         │
│  [Select: Nunca / 1 dia / 7 dias / 30d] │
│                         [Salvar]         │
└──────────────────────────────────────────┘
```

**Comportamento de deep link:**
- Ao clicar numa notificação: `navigate(notification.link)` + `markAsRead(notification.id)` (otimista: atualiza UI antes de aguardar resposta da API)
- O campo `link` vem do backend no formato `/workspaces/:id?taskId=:taskId`

---

## Checklist de Segurança

- [ ] `userId` vem sempre do JWT (`request.user.id`), nunca do body ou params
- [ ] `prisma.notification.deleteMany({ where: { id, userId } })` — escopo duplo garante que um user não apaga notificação de outro (mesmo que manipule o ID na URL)
- [ ] `prisma.notificationPreference.upsert({ where: { userId } })` — userId sempre do JWT
- [ ] Worker re-verifica preferência no momento do processamento (Zero Trust, não no enqueue)
- [ ] Todos os endpoints de notificação estão sob `authMiddleware` + `requirePermission`
- [ ] Nenhum campo `password`, `refreshToken`, `resetToken` retornado nas queries

---

## Verificação Final

- [ ] `npx tsc -b` — zero erros
- [ ] `npm run lint` — zero erros
- [ ] `npm run build` — sucesso
- [ ] Servidor inicia sem erro e loga: `[email-worker] Worker de e-mail iniciado`
- [ ] GET `/api/v1/notifications/preferences` retorna `{ data: { emailNotifications: false, autoClearDays: 0 } }`
- [ ] PATCH `/api/v1/notifications/preferences` com `{ emailNotifications: true, autoClearDays: 7 }` persiste no banco
- [ ] PATCH com `autoClearDays: 15` retorna `400 Validation error`
- [ ] Worker enfileira job ao chamar `notificationService.notify()`
- [ ] BullMQ dashboard (se Redis Insight instalado) mostra fila `email-notifications`
