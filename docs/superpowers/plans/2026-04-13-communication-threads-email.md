# Communication Threads & Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reply threading (`replyToId`) to `CommunicationDocument` and fire email notifications when messages are created or replied to.

**Architecture:** A single self-relation field on `CommunicationDocument` models thread chains. Email dispatch is added to `EmailService` as two new methods and called inside `CommunicationController.create` fire-and-forget (like existing SSE notifications). No new tables or routes needed.

**Tech Stack:** Prisma ORM, Fastify, Zod, Nodemailer (via existing `EmailService`), TypeScript

---

## Pre-flight context

| File | Current state |
|------|--------------|
| `prisma/schema.prisma` | `CommunicationDocument` has `readAt` but **no** `replyToId`. `DocumentRecipient` has `readAt` ✅ |
| `src/controllers/communication.controller.ts` | `getById` marks recipient `readAt` ✅. `listInbox` returns `isRead` ✅. `create` sends SSE but **no email** |
| `src/services/email.service.ts` | `sendEmail`, `sendPasswordResetEmail`, `sendWelcomeEmail` exist. `config.urls.frontend` is wired. **No communication email methods** |
| `src/schemas/communication.schemas.ts` | `createMessageSchema` has no `replyToId` field |

---

## Task 1: Add `replyToId` self-relation to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma` (lines 422–443, `CommunicationDocument` model)

- [ ] **Step 1: Add fields to `CommunicationDocument`**

Open `prisma/schema.prisma` and replace the `CommunicationDocument` model block with:

```prisma
model CommunicationDocument {
  id      String         @id @default(nanoid())
  title   String         @db.VarChar(500)
  content String         @db.Text
  status  DocumentStatus @default(DRAFT)

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  sentAt    DateTime? @map("sent_at")
  readAt    DateTime? @map("read_at")

  createdBy String @map("created_by")
  creator   User   @relation("DocumentCreator", fields: [createdBy], references: [id])

  organizationId String?       @map("organization_id")
  organization   Organization? @relation(fields: [organizationId], references: [id])

  replyToId String?                @map("reply_to_id")
  replyTo   CommunicationDocument? @relation("Replies", fields: [replyToId], references: [id])
  replies   CommunicationDocument[] @relation("Replies")

  recipients  DocumentRecipient[]
  attachments CommunicationAttachment[]

  @@map("communication_documents")
}
```

- [ ] **Step 2: Push schema to database and regenerate client**

```bash
cd /d/PROJECTS/SIMP-BACKEND
nvm use 22
npx prisma db push
npx prisma generate
```

Expected output: `✔ Your database is now in sync with your Prisma schema.` followed by `✔ Generated Prisma Client`.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(communication): add replyToId self-relation to CommunicationDocument"
```

---

## Task 2: Extend Zod schema to accept `replyToId`

**Files:**
- Modify: `src/schemas/communication.schemas.ts`

- [ ] **Step 1: Add `replyToId` to `createMessageSchema`**

Replace the contents of `src/schemas/communication.schemas.ts` with:

```typescript
import { z } from 'zod'

const recipientSchema = z.object({
  userId: z.string().min(1, 'ID do usuário inválido'),
  role: z.enum(['TO', 'CC', 'BCC']).default('TO')
}).strip()

const attachmentSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(),
  fileType: z.string(),
  fileSize: z.number()
}).strip()

export const createMessageSchema = z.object({
  subject: z.string().min(3, 'O assunto deve ter pelo menos 3 caracteres').max(500),
  body: z.string().min(1, 'O corpo da mensagem é obrigatório'),
  recipients: z.array(recipientSchema).min(1, 'Informe ao menos um destinatário'),
  attachments: z.array(attachmentSchema).optional(),
  replyToId: z.string().optional()
}).strip()

export const updateMessageSchema = createMessageSchema.partial()

export const messageIdSchema = z.object({
  id: z.string()
}).strip()

export type CreateMessageInput = z.infer<typeof createMessageSchema>
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>
```

- [ ] **Step 2: Type-check**

```bash
cd /d/PROJECTS/SIMP-BACKEND
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/communication.schemas.ts
git commit -m "feat(communication): add replyToId to createMessageSchema"
```

---

## Task 3: Add email methods to `EmailService`

**Files:**
- Modify: `src/services/email.service.ts`

- [ ] **Step 1: Add `sendNewCommunicationEmail` and `sendReplyNotificationEmail` methods**

Append the two methods **before** the closing `}` of the `EmailService` class (before line 151 `export const emailService`). Insert after `sendBulkEmail`:

```typescript
  async sendNewCommunicationEmail(
    recipientEmail: string,
    recipientName: string,
    senderName: string,
    subject: string,
    messageId: string
  ): Promise<void> {
    const url = `${config.urls.frontend}/communication?msgId=${messageId}`
    const content = `
      <p>Olá, <strong>${recipientName}</strong>!</p>
      <p>Você recebeu uma nova comunicação de <strong>${senderName}</strong>.</p>
      <p><strong>Assunto:</strong> ${subject}</p>
      <p>Clique no botão abaixo para visualizar a mensagem completa.</p>
    `
    await this.sendEmail({
      to: recipientEmail,
      subject: `Nova comunicação de ${senderName} — SIMP`,
      html: this.generateEmailTemplate(
        'Nova Comunicação Recebida',
        content,
        { text: 'Ver Mensagem', url }
      ),
      text: `Você recebeu uma nova comunicação de ${senderName}.\nAssunto: ${subject}\nAcesse: ${url}`
    })
  }

  async sendReplyNotificationEmail(
    recipientEmail: string,
    recipientName: string,
    replierName: string,
    originalSubject: string,
    messageId: string
  ): Promise<void> {
    const url = `${config.urls.frontend}/communication?msgId=${messageId}`
    const content = `
      <p>Olá, <strong>${recipientName}</strong>!</p>
      <p><strong>${replierName}</strong> respondeu sua comunicação.</p>
      <p><strong>Assunto original:</strong> ${originalSubject}</p>
      <p>Clique no botão abaixo para visualizar a resposta.</p>
    `
    await this.sendEmail({
      to: recipientEmail,
      subject: `${replierName} respondeu sua comunicação — SIMP`,
      html: this.generateEmailTemplate(
        'Sua Comunicação Foi Respondida',
        content,
        { text: 'Ver Resposta', url }
      ),
      text: `${replierName} respondeu sua comunicação.\nAssunto original: ${originalSubject}\nAcesse: ${url}`
    })
  }
```

- [ ] **Step 2: Type-check**

```bash
cd /d/PROJECTS/SIMP-BACKEND
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/email.service.ts
git commit -m "feat(communication): add sendNewCommunicationEmail and sendReplyNotificationEmail to EmailService"
```

---

## Task 4: Wire `replyToId` and email dispatch into `CommunicationController`

**Files:**
- Modify: `src/controllers/communication.controller.ts`

This task has three sub-changes in one file: (a) `create` accepts `replyToId` and fires emails, (b) `getById` includes `replyTo` + `replies`, (c) `listInbox`/`listSent` expose `replyToId`.

- [ ] **Step 1: Add email service import**

At the top of the file, after the existing imports, add:

```typescript
import { emailService } from '@/services/email.service.js'
```

- [ ] **Step 2: Update `create` to persist `replyToId` and fire emails**

Replace the entire `create` method (lines 20–100) with:

```typescript
  async create(request: FastifyRequest<{ Body: CreateMessageInput }>, reply: FastifyReply) {
    try {
      const { subject, body, recipients, attachments, replyToId } = request.body
      const userId = this.getUserId(request)
      const organizationId = request.user.organizationId

      // Validar que todos os destinatários pertencem à mesma org (non-superAdmin)
      if (!request.user.isSuperAdmin && organizationId && recipients?.length) {
        const recipientUserIds = recipients.filter(r => r.userId !== userId).map(r => r.userId)
        if (recipientUserIds.length > 0) {
          const validCount = await prisma.user.count({
            where: { id: { in: recipientUserIds }, organizationId }
          })
          if (validCount !== recipientUserIds.length) {
            return reply.code(403).send({ message: 'Um ou mais destinatários não pertencem a esta organização.' })
          }

          // RBAC: todos os destinatários devem ter communication:read
          const permitted = await getUsersWithPermission(recipientUserIds, 'communication:read')
          const unauthorized = recipientUserIds.filter(id => !permitted.has(id))
          if (unauthorized.length > 0) {
            return reply.code(400).send({ message: PERMISSION_MISSING_MESSAGE })
          }
        }
      }

      const message = await prisma.communicationDocument.create({
        data: {
          title: subject,
          content: body,
          status: 'SENT',
          sentAt: new Date(),
          createdBy: userId,
          organizationId,
          ...(replyToId ? { replyToId } : {}),
          recipients: {
            create: recipients
              .filter(r => r.userId !== userId)
              .map(r => ({
                userId: r.userId,
                role: r.role,
                canView: true
              }))
          },
          attachments: {
            create: attachments?.map(att => ({
              fileName: att.fileName,
              fileUrl: att.fileUrl,
              fileType: att.fileType,
              fileSize: att.fileSize
            })) ?? []
          }
        },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
          recipients: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true, email: true } }
            }
          },
          attachments: true,
          ...(replyToId ? {
            replyTo: {
              select: {
                id: true, title: true,
                creator: { select: { id: true, firstName: true, lastName: true, email: true } }
              }
            }
          } : {})
        }
      })

      const senderName = `${message.creator.firstName} ${message.creator.lastName}`

      // SSE notifications + email — fire-and-forget
      const recipientUsers = message.recipients.map(r => r.user)
      const recipientIds = recipientUsers.map(u => u.id)

      if (recipientIds.length > 0) {
        const distinctIds = [...new Set(recipientIds)] as string[]

        // SSE notification
        notificationService.notifyMany(distinctIds, {
          title: 'Nova Mensagem',
          message: `Você recebeu uma nova mensagem: ${subject}`,
          type: 'DOCUMENT_RECEIVED',
          link: `/communication/${message.id}`,
          entityId: message.id,
        }).catch(err => request.log.error({ err }, 'Falha ao enviar notificações SSE'))

        // Email notification to each recipient
        for (const user of recipientUsers) {
          if (!user.email) continue
          const recipientName = `${user.firstName} ${user.lastName}`
          emailService.sendNewCommunicationEmail(
            user.email,
            recipientName,
            senderName,
            subject,
            message.id
          ).catch(err => request.log.error({ err, to: user.email }, 'Falha ao enviar email de nova mensagem'))
        }
      }

      // If this is a reply, email the original message creator
      if (replyToId && message.replyTo) {
        const originalCreator = (message.replyTo as any).creator
        if (originalCreator?.email && originalCreator.id !== userId) {
          const originalCreatorName = `${originalCreator.firstName} ${originalCreator.lastName}`
          emailService.sendReplyNotificationEmail(
            originalCreator.email,
            originalCreatorName,
            senderName,
            (message.replyTo as any).title,
            message.id
          ).catch(err => request.log.error({ err, to: originalCreator.email }, 'Falha ao enviar email de resposta'))
        }
      }

      return reply.code(201).send(message)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'Erro ao criar mensagem', error })
    }
  }
```

- [ ] **Step 3: Update `getById` to include thread data**

In `getById`, replace the `include` block inside `prisma.communicationDocument.findFirst` (the current `include` starts after `where: { id, ...orgFilter },`):

```typescript
      include: {
        creator: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
        attachments: true,
        recipients: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } }
          }
        },
        replyTo: {
          select: {
            id: true, title: true, sentAt: true,
            creator: { select: { id: true, firstName: true, lastName: true, avatar: true } }
          }
        },
        replies: {
          orderBy: { sentAt: 'asc' },
          select: {
            id: true, title: true, sentAt: true,
            creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            recipients: {
              select: { userId: true, readAt: true }
            }
          }
        }
      }
```

- [ ] **Step 4: Expose `replyToId` in `listInbox` and `listSent`**

In `listInbox`, add `replyToId: true` to the `select` block:

```typescript
      select: {
        id: true, title: true, status: true, sentAt: true, replyToId: true,
        creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        recipients: { where: { userId }, select: { readAt: true } }
      }
```

In `listSent`, add `replyToId: true` to the `select` block:

```typescript
      select: {
        id: true, title: true, status: true, sentAt: true, replyToId: true,
        recipients: {
          select: {
            userId: true, role: true, readAt: true,
            user: { select: { id: true, firstName: true, lastName: true, avatar: true } }
          }
        }
      }
```

- [ ] **Step 5: Type-check**

```bash
cd /d/PROJECTS/SIMP-BACKEND
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/communication.controller.ts src/services/email.service.ts
git commit -m "feat(communication): wire replyToId persistence, thread includes, and email notifications on create"
```

---

## Task 5: Smoke test

- [ ] **Step 1: Start backend**

```bash
cd /d/PROJECTS/SIMP-BACKEND
nvm use 22
npm run dev
```

- [ ] **Step 2: Send a test message via the frontend or curl and verify:**
  - POST `/messages` with a valid body (no `replyToId`) → 201, recipient receives SSE notification, email fires (check SMTP logs)
  - GET `/messages/:id` as the recipient → `readAt` on `DocumentRecipient` is set, response includes `replyTo: null` and `replies: []`
  - POST `/messages` with `replyToId` set to the first message's ID → 201, original creator receives a reply email

- [ ] **Step 3: Final type-check + lint**

```bash
cd /d/PROJECTS/SIMP-BACKEND
npx tsc --noEmit
npx eslint src/controllers/communication.controller.ts src/services/email.service.ts src/schemas/communication.schemas.ts
```

Expected: zero errors, zero lint errors.
