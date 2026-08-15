import { PrismaClient } from '@prisma/client';
import { randomInt } from 'node:crypto';

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

// Data dentro de um mês específico (monthsAgo=0 = mês atual)
function dateInMonth(monthsAgo: number): Date {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() - monthsAgo;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, rand(1, daysInMonth));
}

const CATEGORIAS = [
    { name: 'Receitas Federais',        description: 'Repasses do Governo Federal (FPM, SUS, FUNDEB)' },
    { name: 'Tributos Municipais',       description: 'Arrecadação Local (IPTU, ISS, ITBI)' },
    { name: 'Saúde',                     description: 'Insumos, Equipamentos e Folha da Saúde' },
    { name: 'Educação',                  description: 'Manutenção de Escolas e Folha FUNDEB' },
    { name: 'Infraestrutura e Obras',    description: 'Pavimentação, Zeladoria e Iluminação' },
    { name: 'Despesas Administrativas',  description: 'Gabinete, Água, Luz, Internet, Expediente' },
    { name: 'Assistência Social',        description: 'Programas sociais, CRAS, CREAS' },
];

// Templates por categoria (amountCents em centavos = R$ x 100)
const TEMPLATES = {
    'Receitas Federais': [
        { desc: 'Repasse FPM (Fundo de Participação dos Municípios)',    min: 185000000, max: 310000000 },
        { desc: 'Repasse SUS - Bloco de Custeio em Saúde',               min: 80000000,  max: 135000000 },
        { desc: 'Repasse FUNDEB - Cotas Municipais',                      min: 115000000, max: 185000000 },
        { desc: 'Repasse PNAE - Alimentação Escolar',                     min: 18000000,  max: 32000000  },
    ],
    'Tributos Municipais': [
        { desc: 'Arrecadação IPTU - Lote Mensal',                        min: 42000000,  max: 92000000  },
        { desc: 'Arrecadação ISS - Serviços Locais',                     min: 22000000,  max: 52000000  },
        { desc: 'Taxa de Alvará e Licenciamento Comercial',              min: 7500000,   max: 17000000  },
        { desc: 'ITBI - Transferência de Imóveis',                       min: 11000000,  max: 23000000  },
        { desc: 'Multas e Juros sobre Tributos',                         min: 2500000,   max: 6500000   },
    ],
    'Saúde': [
        { desc: 'Compra de Medicamentos - Farmácia Básica',              min: 4500000,   max: 12000000  },
        { desc: 'Manutenção Equipamentos UBS Centro',                    min: 800000,    max: 2500000   },
        { desc: 'Folha de Pagamento - Servidores da Saúde',              min: 85000000,  max: 145000000 },
        { desc: 'Repasse Hospital Maternidade Santa Casa',               min: 38000000,  max: 58000000  },
        { desc: 'Aquisição Insumos Laboratoriais - HEMOLAB',             min: 3200000,   max: 8500000   },
        { desc: 'Contrato Serviço SAMU - Manutenção de Frotas',          min: 5500000,   max: 11000000  },
        { desc: 'Vacinas e Imunobiológicos - Lote Trimestral',           min: 6800000,   max: 14000000  },
    ],
    'Educação': [
        { desc: 'Folha de Pagamento - Professores (FUNDEB)',             min: 110000000, max: 175000000 },
        { desc: 'Compra de Merenda Escolar - Lote Mensal',               min: 14000000,  max: 32000000  },
        { desc: 'Reforma EMEF Machado de Assis',                         min: 22000000,  max: 42000000  },
        { desc: 'Manutenção Transporte Escolar (Combustível)',           min: 7500000,   max: 17000000  },
        { desc: 'Aquisição Material Didático - Livros e Kits',           min: 9000000,   max: 19000000  },
        { desc: 'Pagamento Contrato Serviço de Limpeza - Escolas',       min: 4200000,   max: 8500000   },
    ],
    'Infraestrutura e Obras': [
        { desc: 'Recapeamento Asfáltico - Zona Sul',                     min: 32000000,  max: 82000000  },
        { desc: 'Locação Máquinas Pesadas (Patrol e Retroescavadeira)',  min: 11000000,  max: 26000000  },
        { desc: 'Iluminação Pública - Substituição Lâmpadas LED',        min: 4800000,   max: 13500000  },
        { desc: 'Desobstrução Córrego Ribeirão Boturoca',                min: 15000000,  max: 28000000  },
        { desc: 'Construção Calçadas - Programa Caminho Seguro',         min: 8500000,   max: 18000000  },
    ],
    'Despesas Administrativas': [
        { desc: 'Conta de Energia (Enel) - Paço Municipal',             min: 1500000,   max: 3500000   },
        { desc: 'Serviço de Link de Internet Dedicado',                  min: 380000,    max: 850000    },
        { desc: 'Material de Expediente e Papelaria',                    min: 750000,    max: 1450000   },
        { desc: 'Folha de Pagamento - Administração Geral',              min: 43000000,  max: 77000000  },
        { desc: 'Locação de Veículos Oficiais - Contrato Anual',         min: 6500000,   max: 12000000  },
        { desc: 'Serviços de Tecnologia da Informação (TI)',             min: 2800000,   max: 6500000   },
        { desc: 'Seguros Patrimoniais - Frota Municipal',                min: 1100000,   max: 2800000   },
    ],
    'Assistência Social': [
        { desc: 'Benefícios Eventuais - CRAS',                           min: 3500000,   max: 8000000   },
        { desc: 'Folha de Pagamento - CRAS e CREAS',                     min: 18000000,  max: 32000000  },
        { desc: 'Aquisição Cestas Básicas - Emergência Social',          min: 4200000,   max: 9500000   },
        { desc: 'Repasse Conselho Tutelar',                              min: 2100000,   max: 4500000   },
    ],
};

// Quantos lançamentos por categoria por mês
const DISTRIBUICAO_MENSAL = {
    'Receitas Federais':       { income: 3, expense: 0 },
    'Tributos Municipais':     { income: 4, expense: 0 },
    'Saúde':                   { income: 0, expense: 4 },
    'Educação':                { income: 0, expense: 3 },
    'Infraestrutura e Obras':  { income: 0, expense: 3 },
    'Despesas Administrativas':{ income: 0, expense: 4 },
    'Assistência Social':      { income: 0, expense: 2 },
};

// Fator de variação por mês para simular tendências reais (mês mais antigo = índice maior)
// [5 meses atrás, 4, 3, 2, 1, atual]
const FATORES_MENSAIS = [0.82, 0.89, 0.95, 1.01, 1.05, 1.0];

async function main() {
    console.log('🌱 Seed Financeiro — Prefeitura de Itapevi');

    const org = await prisma.organization.findUnique({ where: { slug: 'itapevi' } });
    if (!org) {
        console.error('❌ Organização "itapevi" não encontrada. Rode o seed principal primeiro.');
        process.exit(1);
    }

    const adminUser = await prisma.user.findUnique({ where: { email: 'admin@itapevi.gov.br' } });
    if (!adminUser) {
        console.error('❌ Usuário admin@itapevi.gov.br não encontrado.');
        process.exit(1);
    }

    const OID = org.id;
    const UID = adminUser.id;

    // Limpar dados financeiros anteriores de Itapevi
    console.log('🧹 Limpando lançamentos e categorias anteriores de Itapevi...');
    await prisma.financeEntry.deleteMany({ where: { organizationId: OID } });
    await prisma.financeCategory.deleteMany({ where: { organizationId: OID } });

    // Criar categorias
    console.log('📁 Criando categorias...');
    const catMap = new Map<string, string>();
    for (const cat of CATEGORIAS) {
        const created = await prisma.financeCategory.create({
            data: { organizationId: OID, name: cat.name, description: cat.description }
        });
        catMap.set(cat.name, created.id);
        console.log(`  ✅ Categoria: ${cat.name}`);
    }

    // Gerar lançamentos por mês
    console.log('💸 Gerando lançamentos dos últimos 6 meses...');
    const entries: any[] = [];

    for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
        const fator = FATORES_MENSAIS[5 - monthsAgo];

        for (const [catName, dist] of Object.entries(DISTRIBUICAO_MENSAL)) {
            const templates = TEMPLATES[catName as keyof typeof TEMPLATES];
            const categoryId = catMap.get(catName);

            // Receitas
            for (let i = 0; i < dist.income; i++) {
                const tmpl = pick(templates);
                entries.push({
                    organizationId: OID,
                    occurredAt: dateInMonth(monthsAgo),
                    description: tmpl.desc,
                    amountCents: Math.round(rand(tmpl.min, tmpl.max) * fator),
                    type: 'INCOME',
                    categoryId,
                    createdById: UID,
                    attachmentsStatus: 'none',
                });
            }

            // Despesas
            for (let i = 0; i < dist.expense; i++) {
                const tmpl = pick(templates);
                // Saúde e Educação crescem ~8% no mês atual (simulando pressão de fim de mês)
                const extraPressao = (catName === 'Saúde' || catName === 'Educação') && monthsAgo === 0 ? 1.08 : 1.0;
                entries.push({
                    organizationId: OID,
                    occurredAt: dateInMonth(monthsAgo),
                    description: tmpl.desc,
                    amountCents: Math.round(rand(tmpl.min, tmpl.max) * fator * extraPressao),
                    type: 'EXPENSE',
                    categoryId,
                    createdById: UID,
                    attachmentsStatus: pick(['none', 'none', 'none', 'pending']), // 25% pendentes
                });
            }
        }
    }

    await prisma.financeEntry.createMany({ data: entries });

    console.log(`\n✅ Seed concluído! ${entries.length} lançamentos criados para Itapevi.`);
    console.log(`   Receitas: ${entries.filter(e => e.type === 'INCOME').length}`);
    console.log(`   Despesas: ${entries.filter(e => e.type === 'EXPENSE').length}`);
    console.log(`   Pendentes: ${entries.filter(e => e.attachmentsStatus === 'pending').length}`);
}

main()
    .catch((e) => { console.error('❌ Falha no seed:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
