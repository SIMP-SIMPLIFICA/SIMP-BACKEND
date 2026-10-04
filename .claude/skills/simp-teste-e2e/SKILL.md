---
name: simp-teste-e2e
description: Use ao escrever ou revisar testes de integração (e2e) do backend do SIMP — rotas reais com getApp().inject() contra o banco isolado _e2e. Obrigatório para toda rota nova do Frotas, sempre com o teste de isolamento entre duas organizações e o de módulo desligado.
---

# Teste e2e no SIMP

Os e2e sobem o Fastify real (`buildApp()` em `src/app.ts`) e usam `app.inject()` (nenhuma porta aberta) contra um Postgres real. Nada de mock de auth, Prisma ou PDF.

## Antes de rodar

- O banco de teste é `<nome do DATABASE_URL>_e2e` (ou `E2E_DATABASE_URL`) e **precisa existir**. O `globalSetup` aplica as migrations reais com `prisma migrate deploy` (inclusive o índice parcial e o trigger de auditoria imutável da `0_baseline`); um `_e2e` antigo sem histórico é recriado.
- A trava de 3 camadas (`src/tests/e2e-database.ts`: nome termina em `_e2e`, URL diferente da de dev, `SELECT current_database()` antes de truncar) **nunca** é contornada nem afrouxada.
- Arquivos rodam em série (`maxWorkers: 1`) e cada arquivo trunca o banco; não dependa de dado criado em outro arquivo.

```bash
npm run test:e2e                                                         # todos
npx vitest run -c vitest.config.e2e.ts src/tests/fleet.e2e.spec.ts       # um arquivo
npx vitest run -c vitest.config.e2e.ts -t "outra organização"            # por nome
```

## Passos

1. **Arquivo** `src/tests/<dominio>.e2e.spec.ts` (o sufixo `.e2e.spec.ts` é o que separa da suíte unitária).
2. **Imports e cenário**, como em `src/tests/daily-allowance.e2e.spec.ts`:
   ```ts
   import { describe, expect, test } from 'vitest'
   import { buildAnonymousHeaders, createTestOrganization, createTestUserWithToken } from './e2e-auth-helper.js'
   import { getApp, prisma } from './setup-e2e.js'

   const BASE_URL = '/api/v1/daily-allowances'
   const MODULE = 'dailyAllowances'

   async function setupScenario(permissions: string[]) {
     const organization = await createTestOrganization({ modules: [MODULE] })
     const session = await createTestUserWithToken({ organizationId: organization.id, permissions })
     const department = await prisma.department.create({
       data: { organizationId: organization.id, name: 'Secretaria de Teste', code: `ST${Math.floor(Math.random() * 9000) + 1000}` },
     })
     return { organization, session, department }
   }
   ```
   - `createTestUserWithToken` cria uma **Role real** com as permissões (o `requirePermission` lê do banco) e devolve `headers` com `User-Agent` e `X-Forwarded-For` fixos — sem eles o fingerprint não bate e a resposta é 401.
   - Rota pública: `buildAnonymousHeaders()`.
3. **Chamada**:
   ```ts
   const response = await getApp().inject({ method: 'POST', url: BASE_URL, headers: session.headers, payload })
   expect(response.statusCode).toBe(201)
   ```
4. **Teste obrigatório — isolamento entre duas organizações.** Para **cada** rota com `:id` e para a listagem: recurso criado na organização A, acessado por usuário da organização B com **todas** as permissões e o módulo ligado. Esperado: **404** (não 403 — não confirmar a existência) e listagem vazia. Para escrita (PATCH/DELETE/POST de transição), conferir no banco que nada mudou.
   ```ts
   const foreign = await getApp().inject({ method: 'GET', url: `${BASE_URL}/${recordOfA.id}`, headers: sessionOfB.headers })
   expect(foreign.statusCode).toBe(404)
   ```
5. **Teste obrigatório — módulo desligado.** Organização **sem** o módulo em `modules`, usuário com todas as permissões → `403` e `response.json().error === 'MODULE_DISABLED'` em todas as rotas.
6. **Demais casos mínimos por rota:** sem permissão → 403; payload com campo extra (`organizationId`, `status`, `lifecycle`) → 400 pelo `.strict()`; `departmentId` nanoid aceito.
7. **Frotas — cenários da TASK 10** (spec técnica): placa errada 3× → BLOCKED e 4ª chamada → 410; dois envios simultâneos do mesmo token → exatamente um sucesso (`Promise.all` com dois `inject`), outro 409; mesma NFC-e duas vezes → `409 RECEIPT_ALREADY_USED`; editar emitido → 409 com hash inalterado; estouro de ficha → emite com `budgetOverrun: true`; auditoria gravada (`prisma.auditLog.findMany({ where: { action: 'FLEET_…' } })`).
8. Arquivos gravados (PDF) devem ser limpos no fim, como as Diárias fazem com `deleteFile` (`src/services/storage.service.ts`).

## Checklist

- [ ] Arquivo `*.e2e.spec.ts`, usando `getApp()` e os helpers existentes
- [ ] Isolamento A × B em toda rota (404, listagem vazia, banco intacto)
- [ ] Módulo desligado → `403 MODULE_DISABLED`
- [ ] Sem permissão → 403; campo extra → 400
- [ ] Nenhum `test.only`/`skip` esquecido; arquivos temporários removidos
- [ ] `npm run test:e2e` verde
