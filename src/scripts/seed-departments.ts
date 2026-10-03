import { PrismaClient } from '@prisma/client';

/**
 * Estrutura departamentos típicos para cada organização já semeada —
 * executivo (Prefeitura) ou legislativo (Câmara), pelo NOME da organização.
 *
 * `upsert` por `[organizationId, code]` (a mesma unicidade que o schema já
 * impõe): roda de novo sem duplicar nem quebrar.
 */

const prisma = new PrismaClient();

interface DepartmentSeed {
  name: string;
  code: string;
}

const EXECUTIVE_DEPARTMENTS: DepartmentSeed[] = [
  { name: 'Secretaria Municipal de Saúde',                        code: 'SMS'  },
  { name: 'Secretaria Municipal de Educação',                     code: 'SME'  },
  { name: 'Secretaria Municipal de Administração e Finanças',     code: 'SMAF' },
  { name: 'Secretaria Municipal de Obras e Infraestrutura',       code: 'SMOI' },
  { name: 'Gabinete do Prefeito',                                 code: 'GAB'  },
];

const LEGISLATIVE_DEPARTMENTS: DepartmentSeed[] = [
  { name: 'Presidência',                              code: 'PRES' },
  { name: 'Diretoria Legislativa',                    code: 'DLEG' },
  { name: 'Secretaria de Administração e Finanças',   code: 'SAF'  },
  { name: 'Controle Interno',                         code: 'UCI'  },
];

/** Departamentos típicos pelo NOME da organização — "Prefeitura" ou "Câmara". */
function departmentsFor(orgName: string): DepartmentSeed[] | null {
  if (orgName.includes('Prefeitura')) return EXECUTIVE_DEPARTMENTS;
  if (orgName.includes('Câmara'))     return LEGISLATIVE_DEPARTMENTS;
  return null;
}

async function main() {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização encontrada. Rode src/scripts/seed-organizations.ts primeiro.');
    return;
  }

  let totalCreated = 0;

  for (const org of organizations) {
    const departments = departmentsFor(org.name);

    if (!departments) {
      console.log(`⏭️  ${org.name} — nome não reconhece "Prefeitura" nem "Câmara", pulando.`);
      continue;
    }

    console.log(`\n📁 ${org.name}`);

    for (const dept of departments) {
      await prisma.department.upsert({
        where: { organizationId_code: { organizationId: org.id, code: dept.code } },
        update: { name: dept.name, isActive: true },
        create: {
          name: dept.name,
          code: dept.code,
          organizationId: org.id,
          isActive: true,
        },
      });
      console.log(`   ✅ ${dept.code} — ${dept.name}`);
      totalCreated += 1;
    }
  }

  console.log(`\n🏁 ${totalCreated} departamento(s) prontos em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de departamentos:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
