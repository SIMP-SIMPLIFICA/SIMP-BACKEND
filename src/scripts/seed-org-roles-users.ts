import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';

/**
 * Cria 4 roles setoriais (não-admin) e 15 usuários por organização, para
 * testar RBAC granular além do par "admin da organização" já coberto por
 * `seed-org-admins.ts` — aqui o que importa é gente com permissão para UMA
 * fatia do sistema, não para tudo.
 *
 * Roles são POR ORGANIZAÇÃO (`Role.organizationId` preenchido), ao contrário
 * da role global 'admin' usada em `seed-org-admins.ts` — cada prefeitura/
 * câmara tem seu próprio "Gestor Financeiro" com o próprio Role.id, então
 * editar as permissões de uma organização nunca vaza para outra.
 *
 * `Role.name` é ÚNICO NO BANCO INTEIRO (não só por organização — conferido em
 * prisma/schema.prisma), por isso os 4 nomes técnicos abaixo levam o slug da
 * organização como prefixo (`${slug}-finance-manager`, etc.); `displayName` é
 * livre e é o que a tela de Roles mostra, aí sim igual em todas as prefeituras.
 *
 * Permissões por role — chaves reais de `src/constants/permissions.ts`,
 * cada uma batendo com o módulo do nome do cargo (não um recorte arbitrário):
 *   Gestor Financeiro     → finance:read, finance:write, finance:approve, finance:export
 *   Operador de Protocolo → protocols:read, protocols:write, protocols:normativo, protocols:comunicacao
 *   Auditor Interno       → audit:read, audit:export
 *   Coordenador de Frotas → fleetFuelings:read, fleetFuelings:write, fleetFuelings:issue, fleetFuelings:delete
 * Nenhuma das quatro inclui a variante `:admin` do módulo (ex.: `protocols:admin`)
 * nem `system:admin` — são cargos setoriais, não administradores.
 *
 * 15 usuários por organização, distribuídos em rodízio (round-robin) pelas 4
 * roles acima — 4/4/4/3. Nomes fixos (mesma lista em toda organização — o
 * e-mail já isola por `@${slug}.com`, então não há colisão) para o seed ser
 * previsível de rodar/consultar de novo.
 *
 * IDEMPOTENTE: `upsert` de Role (por `name`) e de User (por `email`), e
 * `upsert` de UserRole (por `[userId, roleId]`) — mesmo padrão de
 * `seed-org-admins.ts`. Rodar de novo atualiza em vez de duplicar ou quebrar.
 */

const prisma = new PrismaClient();
const PASSWORD = 'Senha123!';

interface RoleSeed {
  slugPart: string;       // vira "${orgSlug}-${slugPart}" no Role.name
  displayName: string;
  permissions: string[];
}

const SECTOR_ROLES: RoleSeed[] = [
  {
    slugPart: 'finance-manager',
    displayName: 'Gestor Financeiro',
    permissions: ['finance:read', 'finance:write', 'finance:approve', 'finance:export'],
  },
  {
    slugPart: 'protocol-operator',
    displayName: 'Operador de Protocolo',
    permissions: ['protocols:read', 'protocols:write', 'protocols:normativo', 'protocols:comunicacao'],
  },
  {
    slugPart: 'internal-auditor',
    displayName: 'Auditor Interno',
    permissions: ['audit:read', 'audit:export'],
  },
  {
    slugPart: 'fleet-coordinator',
    displayName: 'Coordenador de Frotas',
    permissions: ['fleetFuelings:read', 'fleetFuelings:write', 'fleetFuelings:issue', 'fleetFuelings:delete'],
  },
];

// ─── 15 nomes fictícios fixos (mesma lista em toda organização) ────────────

const USER_NAMES: { firstName: string; lastName: string }[] = [
  { firstName: 'Ana',       lastName: 'Almeida'   },
  { firstName: 'Bruno',     lastName: 'Barros'    },
  { firstName: 'Carla',     lastName: 'Cardoso'   },
  { firstName: 'Diego',     lastName: 'Duarte'    },
  { firstName: 'Elaine',    lastName: 'Esteves'   },
  { firstName: 'Fábio',     lastName: 'Freitas'   },
  { firstName: 'Gabriela',  lastName: 'Gouveia'   },
  { firstName: 'Heitor',    lastName: 'Henriques' },
  { firstName: 'Isabela',   lastName: 'Iamashita' },
  { firstName: 'João',      lastName: 'Junqueira' },
  { firstName: 'Karina',    lastName: 'Kramer'    },
  { firstName: 'Lucas',     lastName: 'Lacerda'   },
  { firstName: 'Mariana',   lastName: 'Machado'   },
  { firstName: 'Nelson',    lastName: 'Nogueira'  },
  { firstName: 'Patrícia',  lastName: 'Pereira'   },
];

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

  let totalRoles = 0;
  let totalUsers = 0;

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    // ── A) Roles setoriais ──
    const roleIds: string[] = [];
    for (const roleSeed of SECTOR_ROLES) {
      const name = `${org.slug}-${roleSeed.slugPart}`;
      const role = await prisma.role.upsert({
        where: { name },
        update: {
          displayName: roleSeed.displayName,
          permissions: roleSeed.permissions,
          organizationId: org.id,
          isActive: true,
        },
        create: {
          name,
          displayName: roleSeed.displayName,
          description: `${roleSeed.displayName} — ${org.name}`,
          permissions: roleSeed.permissions,
          organizationId: org.id,
          isSystem: false,
        },
      });
      roleIds.push(role.id);
    }
    console.log(`   🏷️  ${roleIds.length} roles setoriais (${SECTOR_ROLES.map(r => r.displayName).join(', ')})`);

    // ── B) 15 usuários, em rodízio pelas 4 roles ──
    for (let i = 0; i < USER_NAMES.length; i++) {
      const { firstName, lastName } = USER_NAMES[i];
      const roleSeed = SECTOR_ROLES[i % SECTOR_ROLES.length];
      const roleId = roleIds[i % SECTOR_ROLES.length];
      const email = `${slugify(firstName)}.${slugify(lastName)}@${org.slug}.com`;

      const user = await prisma.user.upsert({
        where: { email },
        update: {
          password: passwordHash,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`,
          jobTitle: roleSeed.displayName,
          role: 'standard_user',
          organizationId: org.id,
          isActive: true,
          isVerified: true,
        },
        create: {
          id: randomUUID(),
          email,
          password: passwordHash,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`,
          jobTitle: roleSeed.displayName,
          role: 'standard_user',
          organizationId: org.id,
          isActive: true,
          isVerified: true,
        },
      });

      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });

      totalUsers += 1;
    }

    totalRoles += roleIds.length;
    console.log(`   👥 ${USER_NAMES.length} usuários vinculados`);
  }

  console.log(`\n🏁 ${totalRoles} role(s) setoriais e ${totalUsers} usuário(s) prontos em ${organizations.length} organização(ões).`);
  console.log(`   Senha (todos): ${PASSWORD}`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de roles/usuários setoriais:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
