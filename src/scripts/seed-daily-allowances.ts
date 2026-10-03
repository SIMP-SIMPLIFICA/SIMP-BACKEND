import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes, randomInt } from 'node:crypto';

/**
 * Popula o módulo de Diárias (Épico 3/8) — beneficiários para o autocomplete
 * e 20 diárias por organização.
 *
 * REVISÃO: a versão anterior deste script injetava diárias já `ISSUED`
 * direto no banco — hash, `issuedAt`, `pdfFileKey` e snapshot do QDD todos
 * fictícios, sem nenhum PDF de verdade no Storage. Isso quebrava a UI (tela
 * tentando abrir um PDF que não existe) e não deixava demonstrar o fluxo real
 * de emissão. Agora o script só gera dois status:
 *   - **PENDING (15)**: rascunhos PERFEITOS, prontos para emissão manual pela
 *     interface — todo dado de negócio preenchido (beneficiário, valores,
 *     datas, `departmentId`, `qddItemId`), mas `sha256Hash`/`issuedAt`/
 *     `pdfFileKey`/snapshot do QDD ficam NULOS de propósito: é a emissão pela
 *     UI que deve preenchê-los, gerando o PDF/hash de verdade.
 *   - **ACCOUNTED (5)**: só para popular gráficos e a aba de histórico — aqui
 *     sim entram hash/snapshot/prestação de contas fictícios (ver aviso mais
 *     abaixo, na montagem desse grupo).
 *
 * IDEMPOTÊNCIA (mista, por tabela — mesmo raciocínio de `seed-councils.ts`):
 *   - `Beneficiary`      → upsert por `[cpf, organizationId]` (unicidade real
 *                          do schema), com TODOS os campos no `update` — rodar
 *                          de novo atualiza o cadastro em vez de duplicar.
 *   - `DailyAllowance` (e em cascata `DailyAllowanceReceipt`, que tem
 *     `onDelete: Cascade` na FK para `dailyAllowanceId`) → SEM chave estável
 *     que valha a pena preservar entre execuções (o objetivo agora é sempre
 *     15 rascunhos "limpos" para demonstrar emissão, não um histórico que
 *     precise sobreviver a reruns) — o script apaga TODAS as diárias da
 *     organização no início do loop (`deleteMany` por `organizationId`) e
 *     recria as 20 do zero. Mais simples e mais seguro que upsert aqui: uma
 *     diária que o usuário já tiver emitido manualmente pela UI durante a
 *     apresentação também seria apagada e recriada como rascunho — rode este
 *     script de novo só antes da demonstração, não no meio dela.
 */

const prisma = new PrismaClient();
const YEAR = 2026;
const ALLOWANCE_COUNT = 20;

function rand(min: number, max: number) {
  return randomInt(min, max + 1);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Data aleatória dentro do ano (dia limitado a 28 para não depender do mês). */
function dateWithinYear(year: number): Date {
  return new Date(year, rand(0, 11), rand(1, 28));
}

/** Um sábado aleatório dentro do ano (mês limitado a 0-10 para não virar o ano). */
function randomSaturday(year: number): Date {
  const base = new Date(year, rand(0, 10), rand(1, 21));
  const diffToSaturday = (6 - base.getDay() + 7) % 7;
  return addDays(base, diffToSaturday);
}

function isWeekendDay(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6; // domingo ou sábado
}

function fakeHash(): string {
  return randomBytes(32).toString('hex');
}

// ─── CPF fictício com dígito verificador válido (mesmo espírito do gerador
// de CNPJ em seed-organizations.ts, reimplementado aqui — script autônomo). ──

const CPF_FIRST_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_SECOND_WEIGHTS = [11, ...CPF_FIRST_WEIGHTS];

function cpfCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * A raiz é FIXA (não sorteada) — o `cpf` precisa ser o mesmo a cada execução
 * para o `upsert` por `[cpf, organizationId]` encontrar o beneficiário já
 * existente. Um `cpf` novo a cada rodada faria o upsert tentar `create` de
 * novo e esbarrar na OUTRA unicidade do modelo, `[name, organizationId]`
 * (mesmo nome, cpf "novo" mas sem bater com o `where`) — foi exatamente esse
 * bug que apareceu na segunda execução antes desse ajuste.
 */
function cpfFromRoot(root: string): string {
  const d1 = cpfCheckDigit(root, CPF_FIRST_WEIGHTS);
  const d2 = cpfCheckDigit(root + d1, CPF_SECOND_WEIGHTS);
  return `${root}${d1}${d2}`;
}

// ─── Beneficiários fictícios (10 por organização) ───────────────────────────
// `cpfRoot` fixo por beneficiário — mesmo cpf em toda organização (a chave
// única é [cpf, organizationId], então repetir a raiz entre organizações
// diferentes não colide, igual ao e-mail com mesmo prefixo em domínios
// diferentes em seed-org-roles-users.ts).

const BENEFICIARY_SEEDS = [
  { name: 'JOSÉ CARLOS FERREIRA',    jobTitle: 'ASSISTENTE ADMINISTRATIVO', cpfRoot: '111222333' },
  { name: 'MARIA APARECIDA SOUZA',   jobTitle: 'ENFERMEIRA',                cpfRoot: '222333444' },
  { name: 'ANTÔNIO PEREIRA LIMA',    jobTitle: 'MOTORISTA',                 cpfRoot: '333444555' },
  { name: 'FRANCISCA OLIVEIRA COSTA',jobTitle: 'ASSISTENTE SOCIAL',         cpfRoot: '444555666' },
  { name: 'PAULO ROBERTO SANTOS',    jobTitle: 'FISCAL DE TRIBUTOS',        cpfRoot: '555666777' },
  { name: 'ADRIANA REGINA ALVES',    jobTitle: 'PROFESSORA',                cpfRoot: '666777888' },
  { name: 'CARLOS EDUARDO MARTINS',  jobTitle: 'ENGENHEIRO CIVIL',          cpfRoot: '777888999' },
  { name: 'SANDRA REGINA GOMES',     jobTitle: 'CONTADORA',                 cpfRoot: '888999000' },
  { name: 'MARCOS VINÍCIUS ROCHA',   jobTitle: 'AGENTE DE SAÚDE',           cpfRoot: '999000111' },
  { name: 'JULIANA CRISTINA BARBOSA',jobTitle: 'TÉCNICA EM INFORMÁTICA',    cpfRoot: '123456789' },
];

const LOTACAO_POOL = [
  'FUNDO MUNICIPAL DE SAÚDE',
  'FUNDO MUNICIPAL DE EDUCAÇÃO',
  'FUNDO MUNICIPAL DE ASSISTÊNCIA SOCIAL',
  'SECRETARIA DE ADMINISTRAÇÃO',
  'GABINETE DO PREFEITO',
  'SECRETARIA DE OBRAS',
];

const BANK_POOL = ['Banco do Brasil', 'Caixa Econômica Federal', 'Bradesco', 'Itaú Unibanco', 'Santander'];

// ─── Dados de viagem ─────────────────────────────────────────────────────────

const DESTINATIONS = [
  'Palmas/TO', 'Brasília/DF', 'Goiânia/GO', 'Belém/PA', 'Florianópolis/SC',
  'São Paulo/SP', 'Rio de Janeiro/RJ', 'Cuiabá/MT', 'Belo Horizonte/MG', 'Curitiba/PR',
];

const PURPOSES = [
  'Participação em capacitação sobre gestão pública municipal',
  'Reunião técnica com órgão estadual/federal repassador de recursos',
  'Participação em audiência pública regional',
  'Curso de atualização em licitações e contratos',
  'Representação institucional em evento estadual',
  'Busca de peças e insumos para manutenção de veículos oficiais',
  'Acompanhamento de paciente em tratamento fora de domicílio (TFD)',
  'Participação em fórum de secretários municipais',
  'Entrega de documentação em órgão estadual',
  'Vistoria técnica em obra pública',
];

const TRANSPORT_MEANS = ['RODOVIARIO', 'AEREO', 'VEICULO_OFICIAL', 'OUTRO'] as const;
const FUNDING_SOURCES = ['PROPRIO', 'CONVENIO'] as const;

const ACTIVITY_REPORTS = [
  'Atividade realizada conforme programado, com apresentação de certificado de participação.',
  'Reunião concluída conforme pauta prevista, com produção de ata assinada pelas partes.',
  'Objetivo da viagem cumprido integralmente, sem intercorrências a relatar.',
  'Participação confirmada por lista de presença anexa; conteúdo replicado à equipe do setor.',
];

const WEEKEND_JUSTIFICATIONS = [
  'Viagem realizada em fim de semana em razão da agenda do evento, definida pelo órgão promotor; sem prejuízo ao expediente normal do setor de origem.',
  'Deslocamento coincidiu com fim de semana por exigência de horário da reunião externa, fora do controle desta administração.',
];

const RECEIPT_PAYEES = [
  'Posto Ipiranga Rodovia BR-153',
  'Hotel Executivo Central',
  'Restaurante Sabor Caseiro',
  'Auto Posto Boa Viagem',
  'Pousada Recanto Verde',
  'Companhia Aérea Regional',
];

interface BeneficiaryData {
  id: string;
  name: string;
  cpf: string;
  registrationNumber: string;
  rgNumber: string;
  rgIssuer: string;
  jobTitle: string;
  lotacao: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  departmentId: string;
}

async function main() {
  const organizations = await prisma.organization.findMany({
    where: {
      departments: { some: {} },
      users: { some: { role: { in: ['admin', 'standard_user'] }, isActive: true } },
      qddItems: { some: {} },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
      departments: {
        select: {
          id: true,
          name: true,
          qddItems: { where: { year: YEAR }, select: { id: true, ficha: true, fonte: true, naturezaDespesa: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização com departamento + usuário local + QDD encontrada. Rode seed-departments.ts, seed-org-admins.ts e seed-qdd.ts primeiro.');
    return;
  }

  let totalBeneficiaries = 0;
  let totalAllowances = 0;
  let totalReceipts = 0;

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    // Limpeza prévia: qualquer diária desta organização gerada por uma
    // execução anterior (inclusive as antigas `ISSUED` fictícias que
    // quebravam a UI) some antes de recriar do zero. Cascata cuida de
    // `DailyAllowanceReceipt`.
    await prisma.dailyAllowance.deleteMany({ where: { organizationId: org.id } });

    const departmentsWithBudget = org.departments.filter(d => d.qddItems.length > 0);
    if (departmentsWithBudget.length === 0) {
      console.log('   ⏭️  Nenhum departamento com fichas do QDD (ano 2026) — pulando (não deveria acontecer, dado o filtro da consulta).');
      continue;
    }

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: org.id, role: 'admin', isActive: true },
      select: { id: true },
    });
    if (!adminUser) {
      console.log('   ⏭️  Sem admin local — pulando.');
      continue;
    }

    // ── A) Beneficiários ──
    const beneficiaries: BeneficiaryData[] = [];
    for (const seed of BENEFICIARY_SEEDS) {
      const cpf = cpfFromRoot(seed.cpfRoot);
      const rgNumber = String(rand(10_000_000, 99_999_999));
      const rgIssuer = `SSP/${org.state}`;
      const department = pick(departmentsWithBudget);
      const bankName = pick(BANK_POOL);
      const bankAgency = `${rand(1000, 9999)}-${rand(0, 9)}`;
      const bankAccount = `${rand(10000, 99999)}-${rand(0, 9)}`;
      const registrationNumber = String(rand(10_000, 99_999));
      const lotacao = pick(LOTACAO_POOL);

      const created = await prisma.beneficiary.upsert({
        where: { cpf_organizationId: { cpf, organizationId: org.id } },
        update: {
          name: seed.name,
          registrationNumber,
          rg: `${rgNumber} ${rgIssuer}`,
          jobTitle: seed.jobTitle,
          lotacao,
          bankName,
          bankAgency,
          bankAccount,
          departmentId: department.id,
        },
        create: {
          organizationId: org.id,
          name: seed.name,
          cpf,
          registrationNumber,
          rg: `${rgNumber} ${rgIssuer}`,
          jobTitle: seed.jobTitle,
          lotacao,
          bankName,
          bankAgency,
          bankAccount,
          departmentId: department.id,
        },
      });

      beneficiaries.push({
        id: created.id,
        name: seed.name,
        cpf,
        registrationNumber,
        rgNumber,
        rgIssuer,
        jobTitle: seed.jobTitle,
        lotacao,
        bankName,
        bankAgency,
        bankAccount,
        departmentId: department.id,
      });
    }
    totalBeneficiaries += beneficiaries.length;
    console.log(`   🧑‍💼 ${beneficiaries.length} beneficiários`);

    // ── B) a E) 20 diárias: seq 1-15 PENDING (rascunhos prontos para emissão
    // manual), seq 16-20 ACCOUNTED (só para histórico/gráficos). Duas dentro
    // do grupo PENDING são forçadas a cair num fim de semana — para o
    // apresentador ter, de propósito, um rascunho pronto que exercite a
    // justificativa obrigatória ao clicar em "Emitir".
    const PENDING_COUNT = 15;
    const weekendSequences = new Set([5, 12]);

    for (let seq = 1; seq <= ALLOWANCE_COUNT; seq++) {
      const statusGroup = seq <= PENDING_COUNT ? 'PENDING' : 'ACCOUNTED';
      const beneficiary = pick(beneficiaries);
      const department = departmentsWithBudget.find(d => d.id === beneficiary.departmentId) ?? pick(departmentsWithBudget);
      const qddItem = pick(department.qddItems);

      const isWeekendCase = weekendSequences.has(seq);
      let departureDate: Date;
      let returnDate: Date;
      let dayCount: number;

      if (isWeekendCase) {
        departureDate = randomSaturday(YEAR);
        returnDate = addDays(departureDate, 1); // sábado → domingo
        dayCount = 1;
      } else {
        departureDate = dateWithinYear(YEAR);
        const tripDays = rand(1, 4);
        returnDate = addDays(departureDate, tripDays);
        const halfDay = rand(1, 100) <= 30;
        dayCount = halfDay ? tripDays - 0.5 : tripDays;
      }

      const dailyRate = round2(rand(15000, 35000) / 100); // R$150,00 a R$350,00
      const totalAmount = round2(dailyRate * dayCount);
      const formattedNumber = `${String(seq).padStart(3, '0')}/${YEAR}`;

      const isAccounted = statusGroup === 'ACCOUNTED';
      const destination = pick(DESTINATIONS);
      // Regra de fim de semana: não depende só do caso forçado acima — QUALQUER
      // diária (inclusive uma sorteada normalmente) cujo departureDate OU
      // returnDate caia em sábado/domingo precisa da justificativa, senão o
      // botão "Emitir" da UI bloqueia o usuário na apresentação.
      const touchesWeekend = isWeekendDay(departureDate) || isWeekendDay(returnDate);

      // Um único objeto plano (sem espalhar pedaços condicionais) — Prisma
      // infere um tipo XOR para o `create`, e um `data` remontado de vários
      // spreads condicionais vira uma união que o TS não consegue casar
      // contra esse tipo.
      const data = {
        organizationId: org.id,
        beneficiaryName: beneficiary.name,
        beneficiaryCpf: beneficiary.cpf,
        beneficiaryRegistrationNumber: beneficiary.registrationNumber,
        beneficiaryRg: beneficiary.rgNumber,
        beneficiaryRgIssuer: beneficiary.rgIssuer,
        beneficiaryJobTitle: beneficiary.jobTitle,
        beneficiaryLotacao: beneficiary.lotacao,
        beneficiaryBankName: beneficiary.bankName,
        beneficiaryBankAgency: beneficiary.bankAgency,
        beneficiaryBankAccount: beneficiary.bankAccount,
        createdById: adminUser.id,
        departmentId: department.id,
        qddItemId: qddItem.id,
        sequenceNumber: seq,
        year: YEAR,
        formattedNumber,
        status: statusGroup,
        destination,
        purpose: pick(PURPOSES),
        departureDate,
        returnDate,
        weekendHolidayJustification: touchesWeekend ? pick(WEEKEND_JUSTIFICATIONS) : null,
        transportMeans: pick(TRANSPORT_MEANS),
        fundingSource: pick(FUNDING_SOURCES),
        dailyRate,
        dayCount,
        totalAmount,
        // PENDING fica com isto tudo NULO de propósito — é a emissão pela UI
        // (gerando o PDF de verdade e calculando o hash real) que preenche.
        // Só ACCOUNTED (grupo fictício, só para histórico/gráfico — ver aviso
        // abaixo) entra com valor:
        sha256Hash: isAccounted ? fakeHash() : null,
        issuedAt: isAccounted ? addDays(departureDate, -rand(1, 5)) : null,
        pdfFileKey: isAccounted ? `diarias/${org.id}/${YEAR}-${String(seq).padStart(3, '0')}.pdf` : null,
        qddFichaSnapshot: isAccounted ? qddItem.ficha : null,
        qddFonteSnapshot: isAccounted ? qddItem.fonte : null,
        qddNaturezaSnapshot: isAccounted ? qddItem.naturezaDespesa : null,
        // Só ACCOUNTED (prestação de contas já entregue):
        accountabilityDate: isAccounted ? addDays(returnDate, rand(1, 10)) : null,
        activityReport: isAccounted ? pick(ACTIVITY_REPORTS) : null,
        accountabilityTicketNumber: isAccounted ? String(rand(100_000, 999_999)) : null,
        accountabilityEventAddress: isAccounted ? `Local do evento em ${destination}` : null,
        accountabilityContactsInfo: isAccounted ? `Responsável local: (${rand(11, 99)}) 9${rand(1000, 9999)}-${rand(1000, 9999)}` : null,
      };

      // A organização inteira já foi limpa no início do loop (`deleteMany`
      // acima), então é sempre `create` — nada para dar upsert aqui. O cast
      // só afirma que `data` é a variante "unchecked" (FK direto:
      // organizationId, departmentId, ...), porque o Prisma tem dificuldade
      // de inferir isso sozinho quando o objeto vem de uma variável em vez de
      // um literal inline.
      const allowance = await prisma.dailyAllowance.create({
        data: data as Prisma.DailyAllowanceUncheckedCreateInput,
      });

      // Notas fiscais comprobatórias — só para o grupo ACCOUNTED, e só para
      // preencher a listagem/gráficos: são ficção pura, o `receiptNumber` não
      // corresponde a nenhum documento real, e — assim como o `pdfFileKey` da
      // diária em si — não existe nenhum arquivo de verdade no Storage por
      // trás desses dados. Não abra/baixe pela UI, ela vai falhar.
      if (statusGroup === 'ACCOUNTED') {
        const receiptCount = rand(1, 3);
        await prisma.dailyAllowanceReceipt.createMany({
          data: Array.from({ length: receiptCount }, () => ({
            dailyAllowanceId: allowance.id,
            receiptNumber: `NF-${rand(1000, 9999)}`,
            payeeName: pick(RECEIPT_PAYEES),
            issuedAt: departureDate,
            amount: round2(rand(3000, 30000) / 100), // R$30,00 a R$300,00
          })),
        });
        totalReceipts += receiptCount;
      }

      totalAllowances += 1;
    }

    console.log(`   🧳 ${ALLOWANCE_COUNT} diárias (${PENDING_COUNT} PENDING — prontas para emitir na UI, ${ALLOWANCE_COUNT - PENDING_COUNT} ACCOUNTED — só histórico)`);
  }

  console.log(`\n🏁 ${totalBeneficiaries} beneficiário(s), ${totalAllowances} diária(s) e ${totalReceipts} nota(s) fiscal(is) prontos em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de diárias:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
