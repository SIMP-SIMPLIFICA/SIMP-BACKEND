# Gestão de Conselhos Municipais + Assinatura Gov.br — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o módulo completo de Gestão de Conselhos Municipais com membros, reuniões, atas e integração de assinatura avançada via OAuth2/gov.br (ambiente staging).

**Architecture:** Módulo multi-tenant isolado por `organizationId`, protegido por feature flag `COUNCILS` e permissões granulares `councils:*`. Backend Fastify segue o padrão flat-controller existente (sem services separados). A integração gov.br usa OAuth2 com PKCE + state/nonce para proteção CSRF, nunca armazenando credenciais — apenas tokens temporários de curta duração e o resultado PKCS#7 assinado.

**Tech Stack:** Fastify + Prisma (PostgreSQL), Zod, `node:crypto` (SHA-256), `node:https`/fetch para chamadas gov.br, React + TanStack Query + Radix UI no frontend.

---

## Índice

1. [Modelagem de Dados (Prisma Schema)](#1-modelagem-de-dados)
2. [Sistema de Permissões e Módulo](#2-rbac-e-módulo)
3. [Fluxo de Backend](#3-fluxo-de-backend)
4. [Fluxo de Frontend](#4-fluxo-de-frontend)
5. [Plano de Execução — Checklist](#5-plano-de-execução)
6. [Variáveis de Ambiente Necessárias](#6-variáveis-de-ambiente)
7. [Anotações de Segurança](#7-segurança)

---

## 1. Modelagem de Dados

### 1.1 Diagrama de Entidades

```
Organization
  └── Council (1:N)
        ├── CouncilMember (N:M via CouncilMembership)
        └── CouncilMeeting (1:N)
              ├── MeetingAgendaItem (1:N)
              └── CouncilDocument (1:N)
                    └── SignatureRequest (1:N)

GovBrOAuthState (tabela temporária, TTL de 10 min)
```

### 1.2 Enums Novos

```prisma
enum CouncilMemberRole {
  PRESIDENTE
  VICE_PRESIDENTE
  SECRETARIO
  MEMBRO_TITULAR
  MEMBRO_SUPLENTE
}

enum MeetingStatus {
  AGENDADA
  EM_ANDAMENTO
  CONCLUIDA
  CANCELADA
}

enum CouncilDocumentType {
  ATA
  RESOLUCAO
  CONVOCACAO
  PARECER
  OUTROS
}

enum SignatureStatus {
  PENDENTE
  ASSINADO
  FALHOU
  EXPIRADO
}
```

### 1.3 Modelos Novos (adicionar ao `prisma/schema.prisma`)

```prisma
// ─── Conselhos Municipais ──────────────────────────────────────────────────────

model Council {
  id             String   @id @default(nanoid())
  organizationId String   @map("organization_id")
  name           String
  acronym        String?
  description    String?  @db.Text
  legalBasis     String?  @map("legal_basis")    // Lei/decreto de criação
  isActive       Boolean  @default(true)          @map("is_active")
  createdAt      DateTime @default(now())          @map("created_at")
  updatedAt      DateTime @updatedAt               @map("updated_at")

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  memberships  CouncilMembership[]
  meetings     CouncilMeeting[]

  @@unique([organizationId, acronym])
  @@index([organizationId, isActive])
  @@map("councils")
}

model CouncilMembership {
  id        String            @id @default(nanoid())
  councilId String            @map("council_id")
  userId    String            @map("user_id")
  role      CouncilMemberRole @default(MEMBRO_TITULAR)
  startDate DateTime?         @map("start_date")
  endDate   DateTime?         @map("end_date")
  isActive  Boolean           @default(true)  @map("is_active")
  createdAt DateTime          @default(now()) @map("created_at")

  // Campo obrigatório para garantir isolamento no tenant check
  organizationId String @map("organization_id")

  council      Council      @relation(fields: [councilId], references: [id], onDelete: Cascade)
  user         User         @relation("CouncilMemberships", fields: [userId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([councilId, userId, role])
  @@index([organizationId])
  @@index([councilId, isActive])
  @@map("council_memberships")
}

model CouncilMeeting {
  id             String        @id @default(nanoid())
  organizationId String        @map("organization_id")
  councilId      String        @map("council_id")
  title          String
  description    String?       @db.Text
  location       String?
  scheduledAt    DateTime      @map("scheduled_at")
  endedAt        DateTime?     @map("ended_at")
  status         MeetingStatus @default(AGENDADA)
  quorum         Int?          // número de presentes
  createdById    String        @map("created_by_id")
  createdAt      DateTime      @default(now()) @map("created_at")
  updatedAt      DateTime      @updatedAt       @map("updated_at")

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  council      Council            @relation(fields: [councilId], references: [id], onDelete: Cascade)
  createdBy    User               @relation("CouncilMeetingCreator", fields: [createdById], references: [id])
  agendaItems  MeetingAgendaItem[]
  documents    CouncilDocument[]

  @@index([organizationId, scheduledAt])
  @@index([councilId, status])
  @@map("council_meetings")
}

model MeetingAgendaItem {
  id          String  @id @default(nanoid())
  meetingId   String  @map("meeting_id")
  order       Int
  title       String
  description String? @db.Text
  approved    Boolean? // null = não votado, true/false = resultado

  meeting CouncilMeeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  @@index([meetingId])
  @@map("meeting_agenda_items")
}

model CouncilDocument {
  id             String              @id @default(nanoid())
  organizationId String              @map("organization_id")
  meetingId      String              @map("meeting_id")
  documentType   CouncilDocumentType @default(ATA) @map("document_type")
  title          String
  fileKey        String              @map("file_key")   // chave no R2
  fileName       String              @map("file_name")
  fileSize       Int                 @map("file_size")
  mimeType       String              @default("application/pdf") @map("mime_type")
  sha256Hash     String?             @map("sha256_hash")  // hex digest do PDF
  uploadedById   String              @map("uploaded_by_id")
  createdAt      DateTime            @default(now()) @map("created_at")
  updatedAt      DateTime            @updatedAt       @map("updated_at")

  organization      Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  meeting           CouncilMeeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  uploadedBy        User               @relation("CouncilDocumentUploader", fields: [uploadedById], references: [id])
  signatureRequests SignatureRequest[]

  @@index([organizationId])
  @@index([meetingId])
  @@map("council_documents")
}

// ─── Assinaturas Gov.br ────────────────────────────────────────────────────────

model SignatureRequest {
  id             String          @id @default(nanoid())
  organizationId String          @map("organization_id")
  documentId     String          @map("document_id")
  requestedById  String          @map("requested_by_id")
  status         SignatureStatus @default(PENDENTE)

  // Armazenados temporariamente; limpos após assinatura ou expiração
  accessToken    String?  @map("access_token")    // gov.br bearer token (TTL curto)
  pkcs7Data      String?  @db.Text @map("pkcs7_data")  // resultado PKCS#7 assinado (base64)

  signedAt   DateTime? @map("signed_at")
  expiresAt  DateTime? @map("expires_at")  // validade do access_token
  errorMsg   String?   @map("error_msg")

  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt       @map("updated_at")

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document     CouncilDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  requestedBy  User            @relation("SignatureRequester", fields: [requestedById], references: [id])

  @@index([organizationId, status])
  @@index([documentId])
  @@map("signature_requests")
}

model GovBrOAuthState {
  id             String   @id @default(nanoid())
  state          String   @unique  // random 32 bytes hex — parâmetro CSRF
  nonce          String             // random 32 bytes hex — para ID token
  documentId     String   @map("document_id")
  userId         String   @map("user_id")
  organizationId String   @map("organization_id")
  createdAt      DateTime @default(now()) @map("created_at")
  expiresAt      DateTime @map("expires_at")  // now + 10 min

  @@index([state])
  @@index([expiresAt])   // para limpeza periódica de estados expirados
  @@map("govbr_oauth_states")
}
```

### 1.4 Relações a adicionar em modelos existentes

**`Organization`** — adicionar:
```prisma
councils          Council[]
councilMemberships CouncilMembership[]
councilMeetings   CouncilMeeting[]
councilDocuments  CouncilDocument[]
signatureRequests SignatureRequest[]
```

**`User`** — adicionar:
```prisma
councilMemberships CouncilMembership[]     @relation("CouncilMemberships")
councilMeetingsCreated CouncilMeeting[]    @relation("CouncilMeetingCreator")
uploadedCouncilDocs CouncilDocument[]      @relation("CouncilDocumentUploader")
signatureRequests  SignatureRequest[]       @relation("SignatureRequester")
```

---

## 2. RBAC e Módulo

### 2.1 String do módulo (feature flag)

```
COUNCILS
```

Registrado em `OrganizationModule.module`. Ativado via SuperAdmin no painel admin (mesmo padrão dos outros módulos existentes).

### 2.2 Strings de permissão

| Permissão | O que permite |
|---|---|
| `councils:read` | Ver lista de conselhos, reuniões e documentos |
| `councils:write` | Criar/editar conselhos, gerenciar membros, criar reuniões, pauta e fazer upload de documentos |
| `councils:admin` | Tudo acima + deletar, alterar status de qualquer reunião |
| `councils:sign` | Iniciar o fluxo de assinatura gov.br para um documento |

### 2.3 Regras de acesso por endpoint

| Endpoint | Permissões aceitas |
|---|---|
| `GET /councils` | `councils:read` ou superior |
| `POST /councils` | `councils:write` ou superior |
| `PUT /councils/:id` | `councils:write` ou superior |
| `DELETE /councils/:id` | `councils:admin` |
| Membros (CRUD) | `councils:write` ou superior |
| Reuniões (leitura) | `councils:read` ou superior |
| Reuniões (criar/editar) | `councils:write` ou superior |
| Reuniões (deletar) | `councils:admin` |
| Documentos (upload) | `councils:write` ou superior |
| Documentos (deletar) | `councils:admin` |
| Assinatura (iniciar) | `councils:sign` |
| Assinatura (callback) | Rota pública com validação state — sem JWT, mas com state CSRF |
| Assinatura (status) | `councils:read` ou superior |

### 2.4 Middleware de uso

Igual ao padrão do `protocol.routes.ts`:

```typescript
app.addHook('preHandler', authMiddleware)
app.addHook('preHandler', requireModule('COUNCILS'))
```

E por rota: `{ preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }`

---

## 3. Fluxo de Backend

### 3.1 Estrutura de arquivos

```
src/
  controllers/
    council.controller.ts           ← CRUD de conselhos + membros
    council-meeting.controller.ts   ← CRUD reuniões + pauta
    council-document.controller.ts  ← Upload, hash, delete de documentos
    govbr-signing.controller.ts     ← OAuth2 flow + requisição de assinatura
  routes/
    council.routes.ts               ← Monta todos os sub-controllers acima
```

### 3.2 `council.controller.ts` — Endpoints

```
GET    /councils              → list()       — paginado, filtro por isActive
POST   /councils              → create()     — Zod: name, acronym?, description?, legalBasis?
GET    /councils/:id          → get()        — inclui membros ativos e próximas reuniões
PUT    /councils/:id          → update()
DELETE /councils/:id          → remove()     — soft delete (isActive = false)

GET    /councils/:id/members  → listMembers()
POST   /councils/:id/members  → addMember()  — Zod: userId, role, startDate?, endDate?
PUT    /councils/:id/members/:membershipId → updateMember()
DELETE /councils/:id/members/:membershipId → removeMember()
```

**Padrão de isolamento tenant** (igual ao restante da codebase):
```typescript
const council = await prisma.council.findFirst({
  where: { id, organizationId }   // sempre scoped
})
if (!council) return reply.code(404).send({ error: 'Not Found' })
```

### 3.3 `council-meeting.controller.ts` — Endpoints

```
GET    /councils/:councilId/meetings          → list()
POST   /councils/:councilId/meetings          → create()
GET    /councils/:councilId/meetings/:id      → get()
PUT    /councils/:councilId/meetings/:id      → update()
DELETE /councils/:councilId/meetings/:id      → remove()    — admin only
PATCH  /councils/:councilId/meetings/:id/status → updateStatus()  — AGENDADA→EM_ANDAMENTO→CONCLUIDA

POST   /councils/:councilId/meetings/:id/agenda        → addAgendaItem()
PUT    /councils/:councilId/meetings/:id/agenda/:itemId → updateAgendaItem()
DELETE /councils/:councilId/meetings/:id/agenda/:itemId → removeAgendaItem()
```

Zod schema de criação de reunião:
```typescript
const createMeetingSchema = z.object({
  title:       z.string().min(3).max(300),
  description: z.string().max(2000).optional(),
  location:    z.string().max(500).optional(),
  scheduledAt: z.coerce.date(),
})
```

### 3.4 `council-document.controller.ts` — Endpoints

```
GET    /councils/:councilId/meetings/:meetingId/documents        → list()
POST   /councils/:councilId/meetings/:meetingId/documents        → upload()
DELETE /councils/:councilId/meetings/:meetingId/documents/:docId → remove()  — admin only
GET    /councils/:councilId/meetings/:meetingId/documents/:docId/download → download()
```

**Geração do SHA-256** (feita no upload, antes de salvar no R2):

```typescript
import { createHash } from 'node:crypto'

// req.body é o Buffer do arquivo recebido via multipart
function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
```

O hash em HEX é armazenado em `CouncilDocument.sha256Hash`. Para envio ao gov.br ele precisa ser convertido para **Base64**:

```typescript
function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64')
}
```

### 3.5 `govbr-signing.controller.ts` — Fluxo OAuth2

#### Visão Geral do Fluxo

```
[Frontend] → POST /sign/initiate     → gera state+nonce, salva em GovBrOAuthState
           ← { authorizationUrl }    ← URL gov.br com ?state=...&nonce=...&redirect_uri=...
[Browser]  → Redireciona para gov.br SSO
[gov.br]   → Redireciona de volta para redirect_uri?code=...&state=...
[Backend]  → GET /sign/callback      → valida state, troca code por token, chama API de assinatura
           → atualiza SignatureRequest (status=ASSINADO, pkcs7Data=...)
[Frontend] → Polling GET /sign/status/:requestId → exibe resultado
```

#### Endpoints

```
POST /councils/sign/initiate
  Body: { documentId: string }
  Auth: councils:sign
  → Valida que documento existe e pertence à org
  → Gera state = randomBytes(32).toString('hex')
  → Gera nonce = randomBytes(32).toString('hex')
  → Salva GovBrOAuthState { state, nonce, documentId, userId, organizationId, expiresAt: now+10min }
  → Cria SignatureRequest { documentId, requestedById, status: PENDENTE }
  → Retorna { authorizationUrl, signatureRequestId }

GET /sign/callback   ← ROTA PÚBLICA (sem authMiddleware, mas com validação CSRF obrigatória)
  Query: { code: string, state: string }
  → Busca GovBrOAuthState por state
  → Se não encontrado ou expiresAt < now → 400 CSRF_INVALID
  → Deleta o registro de estado imediatamente (one-time use)
  → Troca code por access_token via POST para gov.br /token
  → Busca hash do documento (CouncilDocument.sha256Hash)
  → Converte sha256Hash de HEX para Base64
  → POST para gov.br /api/v1/assinar com { hashDocumento: base64Hash, ... }
  → Recebe PKCS#7 (base64)
  → Atualiza SignatureRequest { status: ASSINADO, pkcs7Data, accessToken: null, signedAt }
  → Redireciona para URL de sucesso no frontend

GET /councils/sign/:requestId/status
  Auth: councils:read
  → Retorna { status, signedAt, errorMsg } — nunca expõe pkcs7Data nem accessToken
```

#### Troca de Código (code → access_token) — Detalhes

```typescript
// POST https://sso.staging.acesso.gov.br/token
const tokenResponse = await fetch(`${GOVBR_AUTH_URL}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  process.env.GOVBR_REDIRECT_URI,   // ngrok/tunnel em dev
    client_id:     process.env.GOVBR_CLIENT_ID,
    client_secret: process.env.GOVBR_CLIENT_SECRET,
  }).toString(),
})
const { access_token } = await tokenResponse.json()
```

#### Chamada de Assinatura — Detalhes

```typescript
// POST https://assinatura-api.staging.iti.br/api/v1/assinar
const signResponse = await fetch(`${GOVBR_SIGN_API_URL}/api/v1/assinar`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type':  'application/json',
  },
  body: JSON.stringify({
    hashDocumento:     hexToBase64(sha256Hash),  // Base64 do SHA-256
    algoritmoHash:     'SHA256withRSA',
    tipoAssinatura:    'ATTACHED',               // ou DETACHED
    nivelAssinatura:   'AD_RB',
  }),
})
const { assinatura } = await signResponse.json()  // PKCS#7 base64
```

### 3.6 Registro das rotas em `src/config/routes.ts`

```typescript
import { councilRoutes } from '@/routes/council.routes.js'
// ...
await server.register(councilRoutes, { prefix: '/councils', logLevel: 'info' })
```

### 3.7 `council.routes.ts` — Estrutura

```typescript
export async function councilRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)
  app.addHook('preHandler', requireModule('COUNCILS'))

  // CRUD conselhos
  app.get('/',    { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, councilController.list)
  app.post('/',   { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, councilController.create)
  app.get('/:id', { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, councilController.get)
  app.put('/:id', { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, councilController.update)
  app.delete('/:id', { preHandler: [requireAnyPermission(['councils:admin'])] }, councilController.remove)

  // Membros
  app.get('/:id/members',                          { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, councilController.listMembers)
  app.post('/:id/members',                         { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, councilController.addMember)
  app.put('/:id/members/:membershipId',            { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, councilController.updateMember)
  app.delete('/:id/members/:membershipId',         { preHandler: [requireAnyPermission(['councils:admin'])] }, councilController.removeMember)

  // Reuniões
  app.get('/:councilId/meetings',                  { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, meetingController.list)
  app.post('/:councilId/meetings',                 { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, meetingController.create)
  app.get('/:councilId/meetings/:id',              { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, meetingController.get)
  app.put('/:councilId/meetings/:id',              { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, meetingController.update)
  app.delete('/:councilId/meetings/:id',           { preHandler: [requireAnyPermission(['councils:admin'])] }, meetingController.remove)
  app.patch('/:councilId/meetings/:id/status',     { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, meetingController.updateStatus)

  // Pautas
  app.post('/:councilId/meetings/:id/agenda',          { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, meetingController.addAgendaItem)
  app.put('/:councilId/meetings/:id/agenda/:itemId',   { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, meetingController.updateAgendaItem)
  app.delete('/:councilId/meetings/:id/agenda/:itemId',{ preHandler: [requireAnyPermission(['councils:admin'])] }, meetingController.removeAgendaItem)

  // Documentos
  app.get('/:councilId/meetings/:meetingId/documents',          { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, documentController.list)
  app.post('/:councilId/meetings/:meetingId/documents',         { preHandler: [requireAnyPermission(['councils:write', 'councils:admin'])] }, documentController.upload)
  app.delete('/:councilId/meetings/:meetingId/documents/:docId',{ preHandler: [requireAnyPermission(['councils:admin'])] }, documentController.remove)
  app.get('/:councilId/meetings/:meetingId/documents/:docId/download', { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin'])] }, documentController.download)

  // Assinatura Gov.br
  app.post('/sign/initiate', { preHandler: [requireAnyPermission(['councils:sign', 'councils:admin'])] }, signingController.initiate)
  // ATENÇÃO: /sign/callback é público (sem authMiddleware neste bloco) — registrar separado:
  app.get('/sign/:requestId/status', { preHandler: [requireAnyPermission(['councils:read', 'councils:write', 'councils:admin', 'councils:sign'])] }, signingController.status)
}

// Registrar callback OAuth2 SEM authMiddleware (rota pública com validação state própria)
export async function councilPublicRoutes(app: FastifyInstance) {
  app.get('/councils/sign/callback', signingController.callback)
}
```

---

## 4. Fluxo de Frontend

> O frontend vive em um repositório separado (SIMP-FRONTEND). Este plano descreve as interfaces e contratos esperados para que o frontend possa ser implementado de forma independente.

### 4.1 Estrutura de arquivos (frontend)

```
src/
  pages/
    councils/
      CouncilsPage.tsx                ← Lista todos os conselhos
      CouncilDetailPage.tsx           ← Detalhe: membros + reuniões futuras
      MeetingDetailPage.tsx           ← Detalhe da reunião: pauta + documentos + assinaturas
  components/
    councils/
      CreateCouncilModal.tsx
      EditCouncilModal.tsx
      ManageMembersModal.tsx          ← Tabela de membros com add/edit/remove
      CreateMeetingModal.tsx
      AgendaItemsEditor.tsx           ← Edição inline da pauta (reorder, add, delete)
      UploadDocumentModal.tsx         ← Upload de PDF + preview do hash SHA-256
      SignatureStatusBadge.tsx        ← Badge com status da assinatura (PENDENTE/ASSINADO/etc)
  services/
    councils.ts                       ← Funções fetch para todos os endpoints
  hooks/
    useCouncils.ts                    ← TanStack Query hooks
    useGovBrSigning.ts                ← Gerencia redirect OAuth2 + polling de status
```

### 4.2 Telas principais

#### `CouncilsPage`
- Tabela com: Nome, Sigla, Status (ativo/inativo), Nº de membros, Próxima reunião
- Botão "Novo Conselho" → `CreateCouncilModal`
- Linha clicável → navega para `CouncilDetailPage`

#### `CouncilDetailPage`
- Cabeçalho: nome, sigla, base legal, botão "Editar"
- Aba "Membros": tabela com cargo, suplência, datas, botões gerenciar
- Aba "Reuniões": lista de reuniões com status, data, botão "Nova Reunião"
- Cada reunião clicável → `MeetingDetailPage`

#### `MeetingDetailPage`
- Cabeçalho: título, status badge, local, data/hora, quórum
- Seção "Pauta": `AgendaItemsEditor` (reordenável)
- Seção "Documentos": lista de arquivos com tipo, nome, status de assinatura
  - Botão "Assinar com Gov.br" ao lado de cada documento (visível para `councils:sign`)
  - Badge de status: `SignatureStatusBadge`
- Botão "Upload de Documento" → `UploadDocumentModal`

### 4.3 Fluxo de Assinatura no Frontend

```
1. Usuário clica "Assinar com Gov.br" em um documento
2. useGovBrSigning.initiate(documentId) → POST /councils/sign/initiate
3. Backend retorna { authorizationUrl, signatureRequestId }
4. Frontend salva signatureRequestId em sessionStorage
5. window.location.href = authorizationUrl  → redireciona para gov.br
6. gov.br redireciona de volta para o frontend (ex: /councils/sign/return?...)
   ou diretamente para o backend (depende da config da redirect_uri)
7. Se redirect_uri aponta para o frontend: frontend faz fetch para /sign/callback com ?code=...&state=...
   Se redirect_uri aponta para o backend: backend processa direto, redireciona para página de sucesso
8. Frontend faz polling de GET /councils/sign/{requestId}/status a cada 3s até status != PENDENTE
9. Exibe toast de sucesso ou erro conforme resultado
```

**Nota sobre `redirect_uri` em desenvolvimento:**
- Em dev com ngrok: `GOVBR_REDIRECT_URI = https://<ngrok-id>.ngrok-free.app/councils/sign/callback`
- O backend processa o callback diretamente e redireciona o browser para `${FRONTEND_URL}/councils/sign/return?requestId={id}`
- O frontend lê `requestId` da query string e inicia o polling

### 4.4 `useGovBrSigning` hook

```typescript
function useGovBrSigning() {
  const initiate = async (documentId: string) => {
    const { authorizationUrl, signatureRequestId } = await api.post('/councils/sign/initiate', { documentId })
    sessionStorage.setItem('govbr_signature_id', signatureRequestId)
    window.location.href = authorizationUrl
  }

  const pollStatus = (requestId: string) => useQuery({
    queryKey: ['signature-status', requestId],
    queryFn: () => api.get(`/councils/sign/${requestId}/status`),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'PENDENTE' ? 3000 : false  // para quando não está mais pendente
    },
    enabled: !!requestId,
  })

  return { initiate, pollStatus }
}
```

### 4.5 `UploadDocumentModal`

- Input de arquivo aceita apenas `application/pdf`
- Após seleção do arquivo: computa SHA-256 no browser via `crypto.subtle.digest`
- Exibe hash como "Impressão digital do documento: `abc123...`"
- Ao confirmar: POST multipart para backend
- Backend recomputa SHA-256 server-side e salva em `CouncilDocument.sha256Hash`
- Frontend exibe toast de sucesso

---

## 5. Plano de Execução

### Passo 1 — Prisma Schema (Backend)

- [ ] Adicionar os 4 novos enums ao `prisma/schema.prisma`
- [ ] Adicionar os 6 novos modelos ao `prisma/schema.prisma`
- [ ] Adicionar as novas relações em `Organization` e `User`
- [ ] Rodar `npm run db:generate` para atualizar Prisma Client
- [ ] Rodar `npm run db:push` para aplicar no banco local
- [ ] Validar TypeScript: `npx tsc -b --noEmit`
- [ ] Commit: `feat(schema): add councils, meetings, documents, govbr signature models`

### Passo 2 — Permissões e Módulo (Backend)

- [ ] Confirmar que a string `COUNCILS` está documentada (nenhum código precisa ser alterado — a infra de módulos já suporta qualquer string)
- [ ] Criar role de seed ou documentar as permissions `councils:read`, `councils:write`, `councils:admin`, `councils:sign` para serem adicionadas manualmente via Admin Panel
- [ ] Testar `requireModule('COUNCILS')` manualmente habilitando o módulo via `OrganizationModule` no banco
- [ ] Commit: `feat(rbac): document councils permissions and module flag`

### Passo 3 — Controller de Conselhos e Membros (Backend)

- [ ] Criar `src/controllers/council.controller.ts` com `list`, `create`, `get`, `update`, `remove`
- [ ] Adicionar `listMembers`, `addMember`, `updateMember`, `removeMember` no mesmo controller
- [ ] Criar `src/routes/council.routes.ts` (apenas as rotas de conselhos e membros por ora)
- [ ] Registrar em `src/config/routes.ts`
- [ ] Testar com `curl` ou Insomnia os endpoints básicos
- [ ] Commit: `feat(councils): council CRUD and membership management endpoints`

### Passo 4 — Controller de Reuniões e Pauta (Backend)

- [ ] Criar `src/controllers/council-meeting.controller.ts`
- [ ] Adicionar rotas de reuniões e pauta em `council.routes.ts`
- [ ] Testar criação de reunião, mudança de status e adição de pautas
- [ ] Commit: `feat(councils): meeting and agenda management endpoints`

### Passo 5 — Controller de Documentos + Hash SHA-256 (Backend)

- [ ] Criar `src/controllers/council-document.controller.ts`
- [ ] Implementar upload com cálculo SHA-256 usando `node:crypto`
- [ ] Implementar geração de `hexToBase64` helper
- [ ] Adicionar rotas de documentos em `council.routes.ts`
- [ ] Testar upload de PDF e verificar que `sha256Hash` é salvo corretamente
- [ ] Commit: `feat(councils): document upload with SHA-256 hash computation`

### Passo 6 — Variáveis de Ambiente Gov.br (Config)

- [ ] Adicionar ao `.env.example`: `GOVBR_CLIENT_ID`, `GOVBR_CLIENT_SECRET`, `GOVBR_REDIRECT_URI`, `GOVBR_AUTH_URL`, `GOVBR_SIGN_API_URL`, `FRONTEND_URL`
- [ ] Preencher `.env` local com credenciais de staging
- [ ] Configurar ngrok: `ngrok http 3333` e atualizar `GOVBR_REDIRECT_URI`
- [ ] Registrar a `redirect_uri` no portal de staging do gov.br
- [ ] Commit: `chore(env): add govbr staging environment variables template`

### Passo 7 — Controller de Assinatura Gov.br (Backend)

- [ ] Criar `src/controllers/govbr-signing.controller.ts`
- [ ] Implementar `initiate()`: gera state/nonce, salva `GovBrOAuthState`, cria `SignatureRequest`, retorna URL
- [ ] Implementar `callback()`: valida state, one-time delete, troca code por token, chama API de assinatura, salva PKCS#7
- [ ] Implementar `status()`: retorna status sem expor dados sensíveis
- [ ] Adicionar rotas de assinatura em `council.routes.ts` (incluindo `councilPublicRoutes` sem auth para callback)
- [ ] Registrar `councilPublicRoutes` separado em `routes.ts`
- [ ] Testar fluxo completo com ngrok + staging gov.br
- [ ] Commit: `feat(councils): govbr oauth2 signing flow with csrf protection`

### Passo 8 — Limpeza Periódica de States Expirados (Backend)

- [ ] Criar `src/jobs/cleanup-govbr-states.job.ts` (igual ao padrão dos outros jobs)
- [ ] Registrar no `src/index.ts`
- [ ] Commit: `feat(councils): periodic cleanup of expired govbr oauth states`

### Passo 9 — Frontend: Serviços e Hooks

- [ ] Criar `src/services/councils.ts` com todas as funções de fetch
- [ ] Criar `src/hooks/useCouncils.ts` com TanStack Query hooks
- [ ] Criar `src/hooks/useGovBrSigning.ts` com `initiate` + `pollStatus`
- [ ] Commit: `feat(councils-fe): api services and query hooks`

### Passo 10 — Frontend: Páginas Principais

- [ ] Criar `CouncilsPage.tsx` com listagem e `CreateCouncilModal`
- [ ] Criar `CouncilDetailPage.tsx` com abas Membros e Reuniões
- [ ] Criar `MeetingDetailPage.tsx` com pauta, documentos e assinaturas
- [ ] Adicionar rotas no React Router
- [ ] Commit: `feat(councils-fe): councils, meeting, and detail pages`

### Passo 11 — Frontend: Modais e Componentes de Assinatura

- [ ] Criar `UploadDocumentModal.tsx` com preview de hash SHA-256 no browser
- [ ] Criar `ManageMembersModal.tsx`
- [ ] Criar `AgendaItemsEditor.tsx`
- [ ] Criar `SignatureStatusBadge.tsx`
- [ ] Criar página `CouncilSignReturnPage.tsx` para receber redirect pós-gov.br
- [ ] Testar fluxo completo end-to-end
- [ ] Commit: `feat(councils-fe): upload modal, member management, signature UI`

### Passo 12 — Testes e Hardening

- [ ] Verificar que todas as queries têm `organizationId` no `where`
- [ ] Verificar que o callback OAuth2 deleta o state antes de prosseguir
- [ ] Verificar que `pkcs7Data` e `accessToken` nunca são retornados nos endpoints de listagem
- [ ] Verificar que a rota `/sign/callback` não tem `authMiddleware` nem `requireModule`
- [ ] Rodar `npx tsc -b` sem erros
- [ ] Commit final: `feat(councils): complete councils module with govbr e-signature integration`

---

## 6. Variáveis de Ambiente

```env
# Gov.br OAuth2 — Staging
GOVBR_AUTH_URL=https://sso.staging.acesso.gov.br
GOVBR_SIGN_API_URL=https://assinatura-api.staging.iti.br
GOVBR_CLIENT_ID=<obtido no portal staging.acesso.gov.br>
GOVBR_CLIENT_SECRET=<obtido no portal staging.acesso.gov.br>
GOVBR_REDIRECT_URI=https://<ngrok-id>.ngrok-free.app/councils/sign/callback
# URL do frontend para redirect pós-callback
FRONTEND_URL=http://localhost:5173
```

**Escopos OAuth2 necessários** (configurar no portal gov.br):
- `openid`
- `profile`
- `email`
- `govbr_assinatura` (escopo específico para assinatura)

**Parâmetros da URL de autorização:**
```
GET https://sso.staging.acesso.gov.br/authorize
  ?response_type=code
  &client_id=${GOVBR_CLIENT_ID}
  &redirect_uri=${GOVBR_REDIRECT_URI}
  &scope=openid+profile+email+govbr_assinatura
  &state=${state}
  &nonce=${nonce}
```

---

## 7. Segurança

### 7.1 Multi-tenancy
- Toda query ao banco inclui `organizationId` no `where`. Sem exceções.
- O `organizationId` vem **sempre** do JWT verificado (`request.user.organizationId`), nunca do body/params.

### 7.2 CSRF no Callback OAuth2
- O `state` é gerado com `randomBytes(32).toString('hex')` — 256 bits de entropia.
- Salvo em `GovBrOAuthState` com expiração de 10 minutos.
- Deletado **imediatamente** ao receber o callback (one-time use).
- Se o `state` não existir ou estiver expirado: `400 CSRF_INVALID` — sem processar o código.

### 7.3 Tokens Gov.br
- O `access_token` retornado pelo gov.br é usado imediatamente para chamar a API de assinatura e depois **apagado** (ou nunca persistido se o fluxo for inline).
- Se precisar persistir por algum motivo (retry logic): salvar com prazo de expiração e apagar após uso.
- **Nunca** retornar `accessToken` nem `pkcs7Data` completo nos endpoints de listagem.

### 7.4 Hash do Documento
- SHA-256 calculado **server-side** com `node:crypto` — não confiar no hash enviado pelo cliente.
- O hash enviado ao gov.br é a conversão `hexToBase64(sha256Hash)`.
- O PKCS#7 recebido é o comprovante legal da assinatura — armazenar como `TEXT` no banco.

### 7.5 Validação Zod
- Todo body e query param passa por schema Zod antes de qualquer lógica.
- Parâmetros de path (`:id`, `:councilId`) são validados como UUID/nanoid antes da query ao banco.

### 7.6 Rota de Callback
- Registrada **fora** do grupo com `authMiddleware` e `requireModule`.
- A própria lógica de validação `state` é o único mecanismo de autenticação nessa rota.
- Rate limiting via middleware global existente (protege contra brute-force de states).

---

*Plano criado em 2026-05-19. Revisar com a equipe antes de iniciar o Passo 1.*
