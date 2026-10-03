import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { ensureAdminRole } from '@/services/rbac.service.js';

/**
 * Cria um admin ativo por organização, para o botão "Entrar" (impersonate)
 * do Painel do Super Admin ter alguém a quem entregar a sessão.
 *
 * ACHADO IMPORTANTE: `admin.controller.ts#impersonate` NÃO verifica o campo
 * solto `User.role` — verifica se o usuário tem um `UserRole` apontando para
 * o `Role` GLOBAL de nome exato `'admin'`:
 *
 *   where: { organizationId: orgId, isActive: true,
 *            roles: { some: { role: { name: 'admin' } } } }
 *
 * Por isso este script faz as DUAS coisas: grava `User.role = 'admin'`
 * (coerente com o resto do cadastro, usado em telas que exibem o papel) E
 * cria o vínculo `UserRole` de verdade, via `ensureAdminRole` — a MESMA
 * função que o cadastro de organização em produção usa, para não reimplementar
 * a lógica de "role administrador" duas vezes de formas que podem divergir.
 *
 * `hash()` de `@node-rs/argon2`, mesma lib (não a `argon2` genérica) do seed
 * do Super Admin — é a que `auth.service.ts#verifyPassword` sabe conferir.
 */

const prisma = new PrismaClient();
const PASSWORD = 'Senha123!';

async function main() {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização encontrada. Rode src/scripts/seed-organizations.ts primeiro.');
    return;
  }

  const passwordHash = await hash(PASSWORD, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Role 'admin' é GLOBAL (não por organização) — todo admin de setor de
  // qualquer prefeitura aponta para o MESMO registro de Role.
  const adminRole = await prisma.$transaction(tx => ensureAdminRole(tx));

  for (const org of organizations) {
    const email = `admin@${org.slug}.com`;

    // upsert por e-mail: rodar de novo não quebra (requisito #4 do pedido).
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password: passwordHash,
        firstName: 'Admin',
        lastName: 'Local',
        role: 'admin',
        organizationId: org.id,
        isActive: true,
        isVerified: true,
      },
      create: {
        id: randomUUID(),
        email,
        password: passwordHash,
        firstName: 'Admin',
        lastName: 'Local',
        role: 'admin',
        organizationId: org.id,
        isActive: true,
        isVerified: true,
      },
    });

    // Vínculo REAL que o botão "Entrar" verifica — upsert pelo par único
    // (userId, roleId), então rodar o script de novo não duplica o vínculo.
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      update: {},
      create: { userId: user.id, roleId: adminRole.id },
    });

    console.log(`✅ ${org.name} → ${email}`);
  }

  console.log(`\n🏁 ${organizations.length} administrador(es) de organização prontos.`);
  console.log(`   Senha (todos): ${PASSWORD}`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de admins de organização:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
