import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';

/**
 * Cria (ou atualiza) o Super Admin inicial da plataforma.
 *
 * Sem organização (`organizationId` fica nulo de propósito): Super Admin é
 * papel de PLATAFORMA, não de uma prefeitura específica — mesma convenção já
 * usada nos testes de integração (`createTestUserWithToken`).
 *
 * `hash()` vem de `@node-rs/argon2`, a MESMA biblioteca que
 * `auth.service.ts#hashPassword` usa para gerar hash no cadastro normal —
 * usar uma lib diferente aqui produziria um hash que o login não reconhece
 * (mesmos parâmetros, para consistência; o formato PHC do argon2 já embute os
 * parâmetros no próprio hash, então isso não é estritamente necessário para o
 * `verify()` funcionar, mas mantém o script alinhado ao resto do sistema).
 *
 * `upsert` por e-mail, não `create`: rodar o script de novo (ex.: depois de
 * outro reset do banco) atualiza a senha em vez de falhar com violação de
 * unicidade.
 */

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = 'Senha123!';

async function main() {
  const passwordHash = await hash(ADMIN_PASSWORD, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      password: passwordHash,
      role: 'superadmin',
      isSuperAdmin: true,
      isActive: true,
      isVerified: true,
    },
    create: {
      id: randomUUID(),
      email: ADMIN_EMAIL,
      password: passwordHash,
      firstName: 'Admin',
      fullName: 'Admin',
      role: 'superadmin',
      isSuperAdmin: true,
      isActive: true,
      isVerified: true,
    },
  });

  console.log('✅ Super Admin pronto:');
  console.log(`   Email: ${admin.email}`);
  console.log(`   Senha: ${ADMIN_PASSWORD} (texto plano só aparece aqui, no seed — nunca é armazenada nem logada em produção)`);
  console.log(`   role: ${admin.role} · isSuperAdmin: ${admin.isSuperAdmin}`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed do admin:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
