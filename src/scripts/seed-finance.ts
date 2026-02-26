import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper para gerar datas aleatórias nos últimos X dias
function getRandomDate(daysBack: number) {
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
    return d;
}

// Valores Reais Simulados para uma Prefeitura/Empresa
const CATEGORIAS_SEED = [
    { name: 'Receitas Federais', description: 'Repasses do Governo Federal (Ex: FPM)' },
    { name: 'Tributos Municipais', description: 'Arrecadação Local (IPTU, ISS)' },
    { name: 'Saúde', description: 'Insumos, Equipamentos e Folha da Saúde' },
    { name: 'Educação', description: 'Manutenção de Escolas e Folha FUNDEB' },
    { name: 'Infraestrutura e Obras', description: 'Pavimentação e Zeladoria' },
    { name: 'Despesas Administrativas', description: 'Gabinete, Água, Luz, Internet' }
];

const DESPESAS_SAUDE = [
    { desc: 'Compra de Medicamentos - Farmácia Básica', min: 4500000, max: 12000000 }, // R$ 45k a R$ 120k
    { desc: 'Manutenção Equipamentos UBS Centro', min: 800000, max: 2500000 },
    { desc: 'Folha de Pagamento - Servidores da Saúde', min: 85000000, max: 150000000 },
    { desc: 'Repasse Hospital Maternidade', min: 40000000, max: 60000000 }
];

const DESPESAS_EDUCACAO = [
    { desc: 'Folha de Pagamento - Professores (FUNDEB)', min: 110000000, max: 180000000 },
    { desc: 'Compra de Merenda Escolar - Lote 1', min: 15000000, max: 35000000 },
    { desc: 'Reforma EMEF Machado de Assis', min: 25000000, max: 45000000 },
    { desc: 'Manutenção Transporte Escolar (Combustível)', min: 8000000, max: 18000000 }
];

const DESPESAS_INFRA = [
    { desc: 'Recapeamento Asfáltico - Zona Sul', min: 35000000, max: 85000000 },
    { desc: 'Locação Máquinas Pesadas (Patrol)', min: 12000000, max: 28000000 },
    { desc: 'Iluminação Pública - Troca Lâmpadas LED', min: 5000000, max: 15000000 }
];

const DESPESAS_ADMIN = [
    { desc: 'Conta de Energia (Enel) - Paço Municipal', min: 1500000, max: 3500000 },
    { desc: 'Serviço de Link de Internet Dedicado', min: 400000, max: 900000 },
    { desc: 'Material de Expediente e Papelaria', min: 800000, max: 1500000 },
    { desc: 'Folha de Pagamento - Administração Geral', min: 45000000, max: 80000000 }
];

const RECEITAS_FEDERAIS = [
    { desc: 'Repasse FPM (Fundo Participação dos Municípios)', min: 180000000, max: 320000000 },
    { desc: 'Repasse SUS (Bloco Custeio)', min: 85000000, max: 140000000 },
    { desc: 'Repasse FUNDEB', min: 120000000, max: 190000000 }
];

const RECEITAS_TRIBUTOS = [
    { desc: 'Arrecadação IPTU - Lote Mensal', min: 45000000, max: 95000000 },
    { desc: 'Arrecadação ISS - Serviços Locais', min: 25000000, max: 55000000 },
    { desc: 'Taxa de Alvará e Licenciamento', min: 8000000, max: 18000000 },
    { desc: 'ITBI - Transferência de Imóveis', min: 12000000, max: 22000000 }
];

function getRandomItem(arr: any[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomCents(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

async function main() {
    console.log('🌱 Iniciando Seed de Módulo Financeiro...');

    // 1. Pegar o primeiro usuário e workspace (simulando o "Admin User" logado)
    const workspace = await prisma.workspace.findFirst();
    const user = await prisma.user.findFirst();

    if (!workspace || !user) {
        console.error('❌ Erro: Nenhum Workspace ou User encontrado no banco. Rode o seed principal antes de popular o financeiro.');
        process.exit(1);
    }

    const WID = workspace.id;
    const UID = user.id;

    console.log(`✅ Base encontrada. Workspace: ${workspace.name} | User: ${UID}`);

    // 2. Limpar Lançamentos e Categorias Antigas (Reset Parcial)
    console.log('🧹 Limpando dados financeiros anteriores do Workspace...');
    await prisma.financeAttachment.deleteMany({
        where: { entry: { workspaceId: WID } }
    });
    await prisma.financeEntry.deleteMany({
        where: { workspaceId: WID }
    });
    await prisma.financeCategory.deleteMany({
        where: { workspaceId: WID }
    });

    // 3. Cadastrar as Categorias
    console.log('📁 Criando Categorias Essenciais...');
    const catMap = new Map<string, string>(); // Guarda os IDs criados: Nome -> ID

    for (const cat of CATEGORIAS_SEED) {
        const created = await prisma.financeCategory.create({
            data: {
                workspaceId: WID,
                name: cat.name,
                description: cat.description
            }
        });
        catMap.set(cat.name, created.id);
    }

    // 4. Montar Payload Massivo (50 transações ao longo de 90 dias)
    console.log('💸 Gerando 50+ transações contábeis hiper-realistas...');
    const entriesToInsert: any[] = [];

    // Gerador Genérico para preencher a Array
    const pushEntries = (
        categoryName: string,
        templates: any[],
        type: 'INCOME' | 'EXPENSE',
        count: number
    ) => {
        const categoryId = catMap.get(categoryName)!;
        for (let i = 0; i < count; i++) {
            const tmpl = getRandomItem(templates);
            entriesToInsert.push({
                workspaceId: WID,
                occurredAt: getRandomDate(90), // Últimos 3 meses
                description: tmpl.desc,
                amountCents: getRandomCents(tmpl.min, tmpl.max),
                type,
                categoryId,
                createdById: UID,
                updatedById: UID
            });
        }
    };

    // Distribuindo a matemática de forma coerente (Prefeituras tem poucos repasses gigantes, mas muitas despesas variadas)
    pushEntries('Receitas Federais', RECEITAS_FEDERAIS, 'INCOME', 12);     // 4 repasses por mês
    pushEntries('Tributos Municipais', RECEITAS_TRIBUTOS, 'INCOME', 18);   // 6 arrecadações por mês

    pushEntries('Saúde', DESPESAS_SAUDE, 'EXPENSE', 10);
    pushEntries('Educação', DESPESAS_EDUCACAO, 'EXPENSE', 10);
    pushEntries('Infraestrutura e Obras', DESPESAS_INFRA, 'EXPENSE', 8);
    pushEntries('Despesas Administrativas', DESPESAS_ADMIN, 'EXPENSE', 15);

    // 5. Inserir no Banco de Dados
    await prisma.financeEntry.createMany({
        data: entriesToInsert
    });

    console.log(`✅ Sucesso! O Módulo Financeiro foi Povoado com ${entriesToInsert.length} lançamentos. Vá checar seu Dashboard!`);
}

main()
    .catch((e) => {
        console.error('❌ Falha Crítica no Seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
