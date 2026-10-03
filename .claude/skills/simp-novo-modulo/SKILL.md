---
name: simp-novo-modulo
description: Use ao criar ou registrar um módulo novo do SIMP no backend (ex.: o módulo `fleet` da TASK 1 do Frotas) ou ao adicionar permissões `dominio:acao` ao catálogo. Cobre chave em OrganizationModule, guarda requireModule, catálogo de permissões + ensureAdminRole, registro em src/config/routes.ts e o espelho no frontend.
---

# Registrar um módulo novo no SIMP (backend)

Um módulo é: uma chave em `src/constants/modules.ts` (ligada por organização em `OrganizationModule`) + permissões `dominio:acao` no catálogo + um plugin de rotas protegido por `authMiddleware → requireModule → requireAnyPermission`.

## Passos

1. **Chave do módulo** em `src/constants/modules.ts`. Escolher o estilo e copiar a string exata em todo lugar (o catálogo mistura `virtual_processes` e `dailyAllowances`).
   ```ts
   export const MODULES = {
     // ...
     FLEET_FUELINGS: 'fleetFuelings',
   } as const
   ```
   - Decidir se entra em `DEFAULT_MODULES` (ligado ao criar organização) ou se é manual (super admin, por contrato). O Frotas `fleet` é **manual e desligado por padrão** (checklist de go-live).
   - Nada mais a fazer para o painel admin: `admin.controller.ts` mescla `ALL_MODULES` com as linhas do banco, então o módulo novo aparece desligado nas organizações existentes, e `toggleModule` faz `upsert` + `invalidateModuleCache(orgId)`.
   - Dependência entre módulos (ex.: `fleet` exige `fleetFuelings`) **não existe no código**: precisa ser implementada (no `toggleModule` ou no guard) e testada.

2. **Permissões** em `src/constants/permissions.ts`, um grupo novo em `AVAILABLE_PERMISSIONS`:
   ```ts
   fleetFuelings: {
     displayName: 'Abastecimento de Frota',
     permissions: [
       { key: 'fleetFuelings:read',  description: 'Visualizar abastecimentos e baixar relatórios', level: 'read' },
       { key: 'fleetFuelings:issue', description: 'Emitir o relatório oficial do abastecimento',   level: 'admin' },
     ]
   },
   ```
   - Formato `dominio:acao` (nunca `fleet.vehicle.read`). Para o Frotas, a lista `fleet:*` está na TASK 1 da spec técnica.
   - `DEFAULT_ADMIN_PERMISSIONS` deriva do catálogo automaticamente (todas menos `system:admin`).

3. **Ressincronizar a role `admin`.** `ensureAdminRole(tx)` (`src/services/rbac.service.ts`) faz `upsert` com `update: { permissions: DEFAULT_ADMIN_PERMISSIONS }`, mas **só é chamada ao criar organização** (`admin.controller.ts`, `organization.controller.ts`). O `prisma/scripts/backfill-admin-roles.ts` sai antes de chamá-la se não houver usuários sem role. Portanto, permissões novas **não chegam sozinhas** aos admins existentes: a TASK precisa incluir uma etapa idempotente de deploy que rode `prisma.$transaction(tx => ensureAdminRole(tx))`, e documentá-la no resumo.

4. **Plugin de rotas** em `src/routes/<dominio>.routes.ts`, com os guards como hooks do plugin (padrão de `src/routes/fleet-fueling.routes.ts`):
   ```ts
   export async function fleetFuelingRoutes(app: FastifyInstance) {
     app.addHook('preHandler', authMiddleware)
     app.addHook('preHandler', requireModule('fleetFuelings'))

     app.post('/:id/issue',
       { preHandler: [requireAnyPermission(['fleetFuelings:issue'])] },
       fleetFuelingController.issue)
   }
   ```
   - `requireAnyPermission` recebe **array**. Hooks sempre `async` (Fastify 5).
   - Zod `.strict()` em body/query/params de toda rota nova; `departmentId` com `z.string().min(1)`, nunca `.uuid()`.

5. **Registrar em `src/config/routes.ts`.** Conferir o prefixo antes: há rotas dentro do bloco `{ prefix: '/api/v1' }` e outras na raiz. O Frotas vai dentro do bloco `/api/v1`:
   ```ts
   // Abastecimento de Frota (Épico 3)
   await server.register(fleetFuelingRoutes, { prefix: '/fleet-fuelings', logLevel: 'info' })
   ```
   Rota pública (sem login) fica num plugin separado, sem `authMiddleware`, com `config.rateLimit` — ver `src/routes/document-validation.routes.ts`.

6. **Frontend (outro repositório)** — avisar no resumo da TASK: rótulo em `SIMP-FRONTEND/src/lib/moduleLabels.ts`, item em `NAV_SECTIONS` e guards em `router.tsx` (skill `simp-tela-modulo` do frontend).

7. **Seeds:** se o módulo tem dados de demonstração, criar `src/scripts/seed-<dominio>.ts` (encadeado depois de `seed-qdd.ts`), usando `randomInt` (CSPRNG) e upsert por chave natural.

## Checklist

- [ ] Chave em `MODULES`; decisão padrão × manual registrada
- [ ] Permissões no catálogo, formato `dominio:acao`
- [ ] Etapa de ressincronização de `ensureAdminRole` para bancos existentes
- [ ] Plugin com `authMiddleware` → `requireModule` → `requireAnyPermission([...])`, hooks async
- [ ] Registro em `src/config/routes.ts` com prefixo conferido
- [ ] e2e: módulo desligado → `403 MODULE_DISABLED`; sem permissão → 403; outra organização → 404 (skill `simp-teste-e2e`)
- [ ] Pendências do frontend listadas no resumo
- [ ] `npm run lint`, `npm run type-check`, `npm test`, `npm run test:e2e` passando
