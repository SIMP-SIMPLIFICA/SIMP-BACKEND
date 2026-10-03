import { PrismaClient } from '@prisma/client';

/**
 * Popula o Motor Orçamentário (`QddItem`) de TODO departamento já cadastrado
 * — uma mesma "folha" de 8 fichas do QDD oficial replicada por setor, só
 * para existir dotação o bastante para exercitar os gatilhos de consumo e
 * saldo restante (baixa de empenho/liquidação reduzindo `valorOrcado`
 * disponível, histórico em `BudgetHistory`, etc.) em qualquer organização
 * de teste, não numa prefeitura fixa.
 *
 * `year: 2026` — exercício orçamentário corrente do sistema (hoje é
 * 2026-09-16); rodar este seed em outro exercício exige ajustar essa
 * constante.
 *
 * IDEMPOTENTE: `upsert` pela chave composta `[departmentId, year, ficha]` —
 * a mesma unicidade que o schema já impõe (`@@unique([departmentId, year,
 * ficha])`, ver prisma/schema.prisma). Ficha já existente fica intocada
 * (`update: {}`, sem sobrescrever valor consumido/histórico de quem já
 * rodou baixa em cima dela); só ficha nova é criada.
 */

const prisma = new PrismaClient();

interface QddSeed {
  ficha: string;
  fonte: string;
  projetoAtividade: string;
  naturezaDespesa: string;
  valorOrcado: number;
}

const QDD_ITEMS: QddSeed[] = [
  { ficha: '000345', fonte: '1.500.0000.00000', projetoAtividade: '2.108 - MANUTENÇÃO DA SECRETARIA', naturezaDespesa: '3.1.90.04 - CONTRATACAO POR TEMPO DETERMINADO', valorOrcado: 102762.75 },
  { ficha: '000346', fonte: '1.500.0000.00000', projetoAtividade: '2.108 - MANUTENÇÃO DA SECRETARIA', naturezaDespesa: '3.1.90.11 - VENCIMENTOS E VANTAGENS FIXAS',      valorOrcado: 201651.45 },
  { ficha: '000351', fonte: '1.500.0000.00000', projetoAtividade: '2.108 - MANUTENÇÃO DA SECRETARIA', naturezaDespesa: '3.3.90.14 - DIARIAS-PESSOAL CIVIL',              valorOrcado: 25525.50  },
  { ficha: '000352', fonte: '1.500.0000.00000', projetoAtividade: '2.108 - MANUTENÇÃO DA SECRETARIA', naturezaDespesa: '3.3.90.30 - MATERIAL DE CONSUMO',                valorOrcado: 102102.00 },
  { ficha: '000356', fonte: '1.500.0000.00000', projetoAtividade: '2.108 - MANUTENÇÃO DA SECRETARIA', naturezaDespesa: '3.3.90.39 - OUTROS SERVICOS DE TERCEIROS',        valorOrcado: 198288.25 },
  { ficha: '000368', fonte: '1.700.0000.00000', projetoAtividade: '2.093 - CONSTRUCAO E MANUTENÇÃO',  naturezaDespesa: '4.4.90.51 - OBRAS E INSTALAÇÕES',                 valorOrcado: 89339.25  },
  { ficha: '000385', fonte: '1.500.0000.00000', projetoAtividade: '2.100 - DOAÇÕES EMERGENCIAIS',     naturezaDespesa: '3.3.90.32 - MATERIAL DE DISTRIBUICAO GRATUITA',   valorOrcado: 76576.50  },
  { ficha: '000418', fonte: '1.500.0000.00000', projetoAtividade: '2.097 - BLOCO DE FINANCIAMENTO',   naturezaDespesa: '4.4.90.52 - EQUIPAMENTOS E MATERIAL PERMANENTE',   valorOrcado: 39339.25  },
];

const YEAR = 2026;

async function main() {
  const departments = await prisma.department.findMany({
    select: { id: true, name: true, organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (departments.length === 0) {
    console.log('⚠️  Nenhum departamento encontrado. Rode src/scripts/seed-departments.ts primeiro.');
    return;
  }

  let createdCount = 0;
  let untouchedCount = 0;

  for (const department of departments) {
    console.log(`\n📁 ${department.name}`);

    for (const item of QDD_ITEMS) {
      const existing = await prisma.qddItem.findUnique({
        where: { departmentId_year_ficha: { departmentId: department.id, year: YEAR, ficha: item.ficha } },
        select: { id: true },
      });

      await prisma.qddItem.upsert({
        where: { departmentId_year_ficha: { departmentId: department.id, year: YEAR, ficha: item.ficha } },
        update: {},
        create: {
          organizationId: department.organizationId,
          departmentId: department.id,
          year: YEAR,
          ficha: item.ficha,
          fonte: item.fonte,
          projetoAtividade: item.projetoAtividade,
          naturezaDespesa: item.naturezaDespesa,
          valorOrcado: item.valorOrcado,
        },
      });

      if (existing) untouchedCount += 1;
      else createdCount += 1;
    }

    console.log(`   💰 ${QDD_ITEMS.length} fichas do QDD (ano ${YEAR})`);
  }

  console.log(`\n🏁 ${createdCount} ficha(s) criada(s), ${untouchedCount} já existiam (mantidas) — ${departments.length} departamento(s).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed do QDD:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
