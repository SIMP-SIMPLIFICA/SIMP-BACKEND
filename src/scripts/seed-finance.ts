import { PrismaClient } from '@prisma/client';
import { randomInt } from 'node:crypto';

/**
 * Popula o módulo Financeiro (categorias, contas bancárias e lançamentos)
 * para TODA organização que já tenha pelo menos um Departamento e um admin
 * local — generaliza o script anterior, que era específico de uma única
 * organização fixa ("Itapevi") e não sobrevive mais neste banco.
 *
 * IDEMPOTENTE POR ORGANIZAÇÃO: apaga e recria os dados financeiros de cada
 * organização a cada execução (mesmo padrão já usado na versão anterior
 * deste arquivo) — para "lançamento aleatório dos últimos 60 dias" não existe
 * chave natural para `upsert`, então rodar de novo sem limpar antes
 * acumularia lançamentos para sempre.
 */

const prisma = new PrismaClient();

// randomInt (CSPRNG) mesmo sendo dado de teste: mantém o código livre de
// Math.random(), para que o alerta de randomness insegura fique reservado a
// ocorrências que realmente importem.
function rand(min: number, max: number) {
  return randomInt(min, max + 1);
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(arr.length)];
}

/** Data aleatória nos últimos `days` dias (inclusive hoje). */
function dateWithinLastDays(days: number): Date {
  const now = new Date();
  const offset = rand(0, days);
  const d = new Date(now);
  d.setDate(d.getDate() - offset);
  return d;
}

// ─── CNPJ fictício com dígito verificador válido (mesmo gerador de
// seed-organizations.ts, reimplementado aqui — script autônomo). ──────────

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, ...CNPJ_FIRST_WEIGHTS];

function cnpjCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function generateFakeCnpj(): string {
  const root = Array.from({ length: 8 }, () => randomInt(0, 10)).join('');
  const base = `${root}0001`;
  const d1 = cnpjCheckDigit(base, CNPJ_FIRST_WEIGHTS);
  const d2 = cnpjCheckDigit(base + d1, CNPJ_SECOND_WEIGHTS);
  const digits = `${base}${d1}${d2}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

// ─── Categorias ──────────────────────────────────────────────────────────────

const INCOME_CATEGORIES = [
  { name: 'Arrecadação de Impostos (IPTU/ISS)', description: 'Tributos municipais de competência própria' },
  { name: 'Transferências Federais (FPM)',       description: 'Repasses constitucionais da União' },
  { name: 'Convênios e Repasses',                description: 'Convênios estaduais e federais' },
];

const EXPENSE_CATEGORIES = [
  { name: 'Folha de Pagamento',       description: 'Vencimentos de servidores efetivos e comissionados' },
  { name: 'Material de Consumo',      description: 'Material de expediente, limpeza e gêneros alimentícios' },
  { name: 'Serviços de Terceiros',    description: 'Contratos de prestação de serviço (PJ)' },
  { name: 'Obras e Infraestrutura',   description: 'Obras públicas e manutenção viária' },
  { name: 'Manutenção de Frota',      description: 'Combustível, peças e manutenção de veículos oficiais' },
];

// ─── Templates de lançamento por categoria (valores em REAIS — convertidos
// para centavos na hora de gravar) ──────────────────────────────────────────

const INCOME_TEMPLATES: Record<string, { desc: string; min: number; max: number }[]> = {
  'Arrecadação de Impostos (IPTU/ISS)': [
    { desc: 'Arrecadação IPTU - Lote Mensal',            min: 42_000, max: 92_000 },
    { desc: 'Arrecadação ISS - Serviços Locais',         min: 22_000, max: 52_000 },
    { desc: 'Taxas e Alvarás Diversos',                  min: 3_500,  max: 9_000  },
  ],
  'Transferências Federais (FPM)': [
    { desc: 'Repasse FPM - Cota Mensal',                 min: 185_000, max: 310_000 },
    { desc: 'Repasse FUNDEB - Cotas Municipais',         min: 115_000, max: 185_000 },
    { desc: 'Repasse SUS - Bloco de Custeio em Saúde',   min: 80_000,  max: 135_000 },
  ],
  'Convênios e Repasses': [
    { desc: 'Repasse Convênio Estadual - Infraestrutura',      min: 50_000, max: 150_000 },
    { desc: 'Repasse Convênio Federal - Assistência Social',   min: 20_000, max: 60_000  },
  ],
};

const EXPENSE_TEMPLATES: Record<string, { desc: string; min: number; max: number }[]> = {
  'Folha de Pagamento': [
    { desc: 'Folha de Pagamento - Servidores Efetivos',   min: 85_000, max: 175_000 },
    { desc: 'Folha de Pagamento - Cargos Comissionados',  min: 15_000, max: 35_000  },
  ],
  'Material de Consumo': [
    { desc: 'Material de Expediente e Escritório',        min: 700,   max: 3_500 },
    { desc: 'Gêneros Alimentícios - Merenda Escolar',     min: 8_000, max: 22_000 },
  ],
  'Serviços de Terceiros': [
    { desc: 'Contrato de Limpeza e Conservação',          min: 4_000,  max: 9_500  },
    { desc: 'Serviços de Tecnologia da Informação',       min: 2_500,  max: 7_000  },
  ],
  'Obras e Infraestrutura': [
    { desc: 'Recapeamento Asfáltico',                     min: 30_000, max: 85_000 },
    { desc: 'Reforma de Prédio Público',                  min: 15_000, max: 45_000 },
  ],
  'Manutenção de Frota': [
    { desc: 'Manutenção Preventiva - Veículos Oficiais',  min: 1_800, max: 6_500 },
    { desc: 'Combustível - Frota Municipal',              min: 3_500, max: 9_000 },
  ],
};

// ─── Contas bancárias ────────────────────────────────────────────────────────

const BANK_ACCOUNT_TEMPLATES = [
  { name: 'Conta Movimento - BB',      agency: '1234-5', accountNumber: '45678-9'   },
  { name: 'Conta FPM - Caixa',         agency: '0089-1', accountNumber: '00123456-7' },
  { name: 'Conta Saúde - Bradesco',    agency: '3321-0', accountNumber: '77812-3'   },
];

async function main() {
  const organizations = await prisma.organization.findMany({
    where: {
      departments: { some: {} },
      users: { some: { role: 'admin', isActive: true } },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização com departamento + admin local encontrada. Rode seed-organizations.ts, seed-departments.ts e seed-org-admins.ts primeiro.');
    return;
  }

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    const [departments, adminUser] = await Promise.all([
      prisma.department.findMany({ where: { organizationId: org.id }, select: { id: true } }),
      prisma.user.findFirst({ where: { organizationId: org.id, role: 'admin', isActive: true }, select: { id: true } }),
    ]);

    if (departments.length === 0 || !adminUser) {
      console.log('   ⏭️  Sem departamento ou admin local — pulando (não deveria acontecer, dado o filtro da consulta).');
      continue;
    }

    // Limpar dados financeiros anteriores DESTA organização — idempotência.
    // Ordem importa: FinanceEntry.account é onDelete Restrict, então as contas
    // só podem ser apagadas depois que os lançamentos que apontam para elas
    // sumirem (mesma regra já documentada na versão anterior deste script).
    await prisma.financeEntry.deleteMany({ where: { organizationId: org.id } });
    await prisma.financeCategory.deleteMany({ where: { organizationId: org.id } });
    await prisma.bankAccount.deleteMany({ where: { organizationId: org.id } });

    // ── A) Categorias ──
    const categoryMap = new Map<string, string>();
    for (const cat of [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]) {
      const created = await prisma.financeCategory.create({
        data: { organizationId: org.id, name: cat.name, description: cat.description },
      });
      categoryMap.set(cat.name, created.id);
    }
    console.log(`   📁 ${categoryMap.size} categorias`);

    // ── B) Contas bancárias — departamento ALEATÓRIO por conta (Épico 8, FR-015) ──
    const accountIds: string[] = [];
    for (const acc of BANK_ACCOUNT_TEMPLATES) {
      const created = await prisma.bankAccount.create({
        data: {
          organizationId: org.id,
          name: acc.name,
          agency: acc.agency,
          accountNumber: acc.accountNumber,
          departmentId: pick(departments).id,
          // initialBalanceCents NÃO é aceito por escrita direta (Épico 8,
          // FR-016) — fica no padrão 0 do schema.
        },
      });
      accountIds.push(created.id);
    }
    console.log(`   🏦 ${accountIds.length} contas bancárias`);

    // ── C) Lançamentos ──
    const entryCount = rand(20, 30);
    const entries: Parameters<typeof prisma.financeEntry.createMany>[0]['data'] = [];

    for (let i = 0; i < entryCount; i++) {
      // ~40% receita, ~60% despesa — perfil realista de uma prefeitura
      // pequena (mais linhas de despesa do que de receita).
      const isIncome = rand(1, 100) <= 40;
      const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      const templates = isIncome ? INCOME_TEMPLATES : EXPENSE_TEMPLATES;

      const category = pick(categories);
      const template = pick(templates[category.name]);
      const occurredAt = dateWithinLastDays(60);
      const amountCents = rand(template.min, template.max) * 100;

      // Rastreabilidade fiscal (Épico 8-adjacente) — só em ~40% das
      // despesas, como um documento fiscal real: nem toda despesa tem NF e
      // empenho já liquidado no momento do lançamento.
      const hasFiscalDetail = !isIncome && rand(1, 100) <= 40;

      entries.push({
        organizationId: org.id,
        occurredAt,
        description: template.desc,
        amountCents,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        categoryId: categoryMap.get(category.name),
        accountId: pick(accountIds),
        createdById: adminUser.id,
        attachmentsStatus: hasFiscalDetail ? pick(['none', 'pending']) : 'none',
        ...(hasFiscalDetail
          ? {
              providerDocument: generateFakeCnpj(),
              nfeNumber: String(rand(100_000, 999_999)),
              issueDate: occurredAt,
              empenhoNumber: `${String(rand(1, 999)).padStart(4, '0')}/${occurredAt.getFullYear()}`,
              liquidacaoNumber: `${String(rand(1, 999)).padStart(4, '0')}.1/${occurredAt.getFullYear()}`,
              deliveryDate: occurredAt,
            }
          : {}),
      });
    }

    await prisma.financeEntry.createMany({ data: entries });

    const incomeCount = entries.filter(e => e.type === 'INCOME').length;
    console.log(`   💸 ${entries.length} lançamentos (${incomeCount} receitas, ${entries.length - incomeCount} despesas)`);
  }

  console.log(`\n🏁 Módulo Financeiro populado em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed financeiro:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
