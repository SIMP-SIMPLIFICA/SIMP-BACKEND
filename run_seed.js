import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper para gerar datas aleatórias nos últimos X dias
function getRandomDate(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
    return d.toISOString();
}

const CATEGORIAS_SEED = [
    { name: 'Receitas Federais', description: 'Repasses do Governo Federal (Ex: FPM)' },
    { name: 'Tributos Municipais', description: 'Arrecadação Local (IPTU, ISS)' },
    { name: 'Saúde', description: 'Insumos, Equipamentos e Folha da Saúde' },
    { name: 'Educação', description: 'Manutenção de Escolas e Folha FUNDEB' },
    { name: 'Infraestrutura e Obras', description: 'Pavimentação e Zeladoria' },
    { name: 'Despesas Administrativas', description: 'Gabinete, Água, Luz, Internet' }
];

const DESPESAS_SAUDE = [
    { desc: 'Compra de Medicamentos - Farmácia Básica', min: 4500000, max: 12000000 },
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

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomCents(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

async function main() {
    console.log('🌱 Iniciando Seed de Módulo Financeiro via node...');

    // As we saw earlier, the workspace was lost. Let's create a default admin workspace if it doesn't exist
    let workspace = await prisma.workspace.findFirst();
    const user = await prisma.user.findFirst();

    if (!user) {
        console.error('❌ Erro: Admin user nulo. Isto é impossível neste ponto.');
        process.exit(1);
    }

    const UID = user.id;

    if (!workspace) {
        console.log('⚠️ Nenhum Workspace encontrado. Criando Workspace Padrão da Prefeitura...');
        workspace = await prisma.workspace.create({
            data: {
                name: 'Prefeitura Municipal (SIMP)',
                slug: 'prefeitura-municipal-simp',
            }
        });

        // Link o usuário ao workspace como OWNER
        await prisma.workspaceMember.create({
            data: {
                workspaceId: workspace.id,
                userId: UID,
                role: 'OWNER'
            }
        });
    }

    const WID = workspace.id;
    console.log(`✅ Base pronta. Workspace: ${workspace.name} | User: ${UID}`);

    console.log(`🧹 Limpando lançamentos antigos (com campos vazios)...`);
    await prisma.financeEntry.deleteMany({
        where: { workspaceId: WID }
    });

    const catMap = new Map();

    for (const cat of CATEGORIAS_SEED) {
        const createdCat = await prisma.financeCategory.upsert({
            where: {
                workspaceId_name: {
                    workspaceId: WID,
                    name: cat.name
                }
            },
            update: {},
            create: {
                workspaceId: WID,
                name: cat.name,
                description: cat.description
            }
        });
        catMap.set(cat.name, createdCat.id);
        console.log(`  - Categoria criada: ${cat.name}`);
    }

    const generatePayloads = (sourceArray, catName, type, count) => {
        const payloads = [];
        for (let i = 0; i < count; i++) {
            const item = getRandomItem(sourceArray);
            payloads.push({
                workspaceId: WID,
                categoryId: catMap.get(catName),
                subcategoryName: catName,
                createdById: UID,
                type: type,
                amountCents: getRandomCents(item.min, item.max),
                description: item.desc,
                occurredAt: getRandomDate(90),
                empenhoNumber: `2024NE000${Math.floor(Math.random() * 999)}`,
                nfeNumber: `${Math.floor(Math.random() * 999999)}`,
                liquidacaoNumber: `2024NL000${Math.floor(Math.random() * 999)}`,
                providerDocument: '00.000.000/0001-00',
                issueDate: getRandomDate(90),
                deliveryDate: getRandomDate(90),
            });
        }
        return payloads;
    };

    let allEntries = [];
    allEntries = allEntries.concat(generatePayloads(DESPESAS_SAUDE, 'Saúde', 'EXPENSE', 10));
    allEntries = allEntries.concat(generatePayloads(DESPESAS_EDUCACAO, 'Educação', 'EXPENSE', 12));
    allEntries = allEntries.concat(generatePayloads(DESPESAS_INFRA, 'Infraestrutura e Obras', 'EXPENSE', 8));
    allEntries = allEntries.concat(generatePayloads(DESPESAS_ADMIN, 'Despesas Administrativas', 'EXPENSE', 15));
    allEntries = allEntries.concat(generatePayloads(RECEITAS_FEDERAIS, 'Receitas Federais', 'INCOME', 6));
    allEntries = allEntries.concat(generatePayloads(RECEITAS_TRIBUTOS, 'Tributos Municipais', 'INCOME', 18));

    // Sort array by date asc to pretend chronological insertion
    allEntries.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    console.log(`🚀 Inserindo ${allEntries.length} Lançamentos Realistas...`);

    const result = await prisma.financeEntry.createMany({
        data: allEntries,
        skipDuplicates: true
    });

    console.log(`✅ Seed concluído! ${result.count} lançamentos inseridos com sucesso.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
