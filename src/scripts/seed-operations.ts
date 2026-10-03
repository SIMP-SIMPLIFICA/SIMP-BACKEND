import {
  CovenantStatus,
  ExpensePhase,
  OfficialDocumentCategory,
  OfficialDocumentNumberingType,
  OfficialDocumentStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { randomInt } from 'node:crypto';

/**
 * Popula os módulos centrais de operação — Processos Virtuais, Convênios e
 * Protocolos (Atos Normativos e Comunicação) — para uma apresentação oficial:
 * TODO campo com valor realista, mesmo os opcionais no schema, EXCETO os três
 * casos abaixo, que ficam vazios de propósito porque um valor ali seria
 * INCONSISTENTE com a regra de negócio real do sistema (o contrário do que a
 * apresentação precisa):
 *
 *   1. `OfficialDocument.sector`/`departmentId` em NORMATIVOS: a regra real
 *      (`protocol.controller.ts#generate`) força `sector: 'CENTRAL'` e
 *      `departmentId: null` para todo Ato Normativo — a numeração de
 *      Lei/Decreto/Portaria é única por tipo, não por setor. Preencher um
 *      departamento aqui produziria um registro que o próprio sistema nunca
 *      gera pela API, e que ficaria estranho para quem conhece o produto.
 *   2. `OfficialDocument.cancelReason`: só existe em documento CANCELADO
 *      (`cancelReason: status === 'CANCELADO' ? ... : null` no controller).
 *      Como todos os documentos aqui nascem EMITIDO, preenchê-lo produziria
 *      um motivo de cancelamento em um documento que não foi cancelado.
 *   3. `OfficialDocument.libraryDocumentId`: aponta para um PDF de verdade
 *      (`LibraryDocument`, com `fileKey` no storage). É opcional mesmo em
 *      documentos EMITIDO na produção real (anexar o PDF é uma ação
 *      separada) — fabricar aqui um `LibraryDocument` inteiro só para
 *      preencher esse campo estaria fora do escopo pedido (biblioteca
 *      digital não faz parte desta tarefa) e o campo nulo já é um estado
 *      válido e comum em produção.
 *
 * IDEMPOTÊNCIA:
 *   - Tabelas de configuração (`VirtualProcessCategory/Source/Company`,
 *     `CovenantType`, `Convenente`, `Concedente`) → upsert por
 *     `[organizationId, name]`, unicidade real do schema.
 *   - `SequenceControl`, `Covenant`, `VirtualProcess` → upsert pelas
 *     respectivas chaves compostas reais do schema.
 *   - `OfficialDocument` → **NÃO TEM `@@unique` no schema** (só índices), então
 *     `.upsert()` do Prisma não é aplicável — não existe `where` de
 *     unicidade para passar. A idempotência é feita manualmente
 *     (`findFirst` + `create`/`update`), usando a mesma combinação que o
 *     controller real confere antes de criar um Normativo:
 *     `[organizationId, documentCategory, documentType, sequenceNumber, year]`.
 *
 * CNPJ (empresas, convenente, concedente) gerado com dígito verificador
 * válido, mas a partir de RAIZ FIXA (não sorteada) — mesma lição de
 * `seed-daily-allowances.ts`: como o upsert é por `name` (chave estável), um
 * cnpj aleatório a cada execução não quebraria o upsert em si, mas deixaria
 * o cnpj "trocando" a cada rodada sem necessidade; fixo é mais previsível
 * para dado de apresentação.
 */

const prisma = new PrismaClient();
const YEAR = 2026;

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

function dateWithinYear(year: number): Date {
  return new Date(year, rand(0, 11), rand(1, 28));
}

// ─── CNPJ fictício com dígito verificador válido (mesmo gerador usado em
// seed-organizations.ts/seed-finance.ts, reimplementado aqui — script
// autônomo), a partir de uma raiz fixa de 8 dígitos. ────────────────────────

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, ...CNPJ_FIRST_WEIGHTS];

function cnpjCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function cnpjFromRoot(root8: string): string {
  const base = `${root8}0001`;
  const d1 = cnpjCheckDigit(base, CNPJ_FIRST_WEIGHTS);
  const d2 = cnpjCheckDigit(base + d1, CNPJ_SECOND_WEIGHTS);
  const digits = `${base}${d1}${d2}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

const BANK_POOL = ['Banco do Brasil', 'Caixa Econômica Federal', 'Bradesco', 'Itaú Unibanco', 'Santander'];

// ─── A) Tabelas de configuração ──────────────────────────────────────────────

const CATEGORY_NAMES = ['Contratos', 'Obras', 'Licitações', 'RH'];
const SOURCE_NAMES = ['Recurso Próprio', 'Emenda Parlamentar', 'FPM'];

const COMPANY_SEEDS = [
  { name: 'CONSTRUTORA HORIZONTE LTDA',              cnpjRoot: '10020030' },
  { name: 'TECNO INFORMÁTICA E SERVIÇOS LTDA',        cnpjRoot: '40050060' },
  { name: 'COMERCIAL SUPRIMENTOS MUNICIPAIS LTDA',    cnpjRoot: '70080090' },
];

const COVENANT_TYPE_NAMES = ['Repasse Federal', 'Termo de Fomento'];

const CONVENENTE_SEED = { name: 'Governo Estadual',   cnpjRoot: '05060708' };
const CONCEDENTE_SEED = { name: 'Ministério da Saúde', cnpjRoot: '01020304' };

// ─── B) Atos Normativos (MANUAL) ─────────────────────────────────────────────

const NORMATIVO_SEEDS = [
  { documentType: 'LEI',               sequenceNumber: 1234, subject: 'Dispõe sobre a reestruturação do quadro de cargos e salários da Prefeitura Municipal e dá outras providências.',      recipient: 'População em Geral' },
  { documentType: 'DECRETO',           sequenceNumber: 567,  subject: 'Regulamenta o processo de licitação para aquisição de bens de consumo no âmbito da Administração Municipal.',          recipient: 'Secretarias Municipais' },
  { documentType: 'PORTARIA',          sequenceNumber: 89,   subject: 'Designa servidor para responder pela fiscalização de contratos administrativos em execução.',                          recipient: 'Servidores Públicos Municipais' },
  { documentType: 'LEI COMPLEMENTAR',  sequenceNumber: 12,   subject: 'Institui o Plano Municipal de Saúde para o quadriênio 2026-2029.',                                                      recipient: 'Órgãos de Controle Externo' },
  { documentType: 'RESOLUÇÃO',         sequenceNumber: 34,   subject: 'Estabelece normas para a concessão de diárias a servidores públicos municipais em viagem a serviço.',                  recipient: 'Servidores Públicos Municipais' },
];

// ─── B) Comunicações (SEQUENTIAL) ────────────────────────────────────────────

const COMUNICACAO_SEEDS = [
  { subject: 'Solicitação de informações sobre a execução orçamentária do exercício corrente.',  recipient: 'Câmara Municipal' },
  { subject: 'Convite para reunião de alinhamento entre secretarias municipais.',                 recipient: 'Secretaria Municipal de Fazenda' },
  { subject: 'Encaminhamento do relatório mensal de atividades do setor.',                        recipient: 'Tribunal de Contas do Estado' },
  { subject: 'Resposta a requerimento apresentado por vereador.',                                 recipient: 'Câmara Municipal' },
  { subject: 'Notificação sobre prazo de entrega de documentação complementar.',                  recipient: 'Ministério Público Estadual' },
];

// ─── C) Convênios ─────────────────────────────────────────────────────────────

interface CovenantSeed {
  number: string;
  status: CovenantStatus;
  typeName: string;
  processObject: string;
  budgetaryAction: string;
  preferredDeptCode: string;
  transferValue: number;
  counterpartPct: number;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  phase: 'FUTURE' | 'ONGOING' | 'PAST';
}

const COVENANT_SEEDS: CovenantSeed[] = [
  {
    number: '001/2026', status: CovenantStatus.EM_ANALISE, typeName: 'Termo de Fomento',
    processObject: 'Repasse de recursos para implementação de serviços de proteção social básica no âmbito do Sistema Único de Assistência Social (SUAS).',
    budgetaryAction: '08.244.0003.2041', preferredDeptCode: 'SMAF',
    transferValue: 350_000, counterpartPct: 0.10,
    bankName: 'Banco do Brasil', bankAgency: '1234-5', bankAccount: '98765-4',
    phase: 'FUTURE',
  },
  {
    number: '002/2026', status: CovenantStatus.EM_EXECUCAO, typeName: 'Repasse Federal',
    processObject: 'Repasse de recursos do Ministério da Saúde para custeio de ações e serviços públicos de saúde no âmbito do Sistema Único de Saúde (SUS).',
    budgetaryAction: '10.301.0001.2055', preferredDeptCode: 'SMS',
    transferValue: 800_000, counterpartPct: 0.10,
    bankName: 'Caixa Econômica Federal', bankAgency: '0089-1', bankAccount: '00123456-7',
    phase: 'ONGOING',
  },
  {
    number: '003/2026', status: CovenantStatus.CONCLUIDO, typeName: 'Termo de Fomento',
    processObject: 'Construção e equipagem de unidade de educação infantil, com recursos de emenda parlamentar.',
    budgetaryAction: '12.365.0002.1032', preferredDeptCode: 'SME',
    transferValue: 500_000, counterpartPct: 0.10,
    bankName: 'Bradesco', bankAgency: '3321-0', bankAccount: '77812-3',
    phase: 'PAST',
  },
];

// ─── D) Processos Virtuais ────────────────────────────────────────────────────

const PROCESS_SUBJECTS = [
  'Aquisição de material de expediente para as secretarias municipais.',
  'Contratação de empresa especializada em serviços de limpeza urbana e coleta de resíduos.',
  'Processo licitatório para aquisição de veículos oficiais.',
  'Locação de imóvel para funcionamento de unidade de saúde.',
  'Contratação de serviços de engenharia para reforma de próprio público municipal.',
  'Aquisição de gêneros alimentícios para a merenda escolar.',
  'Contratação de serviços de tecnologia da informação e manutenção de sistemas.',
  'Aquisição de equipamentos e mobiliário para unidades administrativas.',
  'Contratação de serviços de consultoria técnica para elaboração de projetos.',
  'Prestação de serviços de manutenção predial e instalações elétricas.',
];

const PROCESS_STATUSES = ['Tramitando', 'Em Análise', 'Concluído', 'Arquivado'];

const SOURCE_DETAILS = [
  'Portaria nº 045/2026', 'Convênio nº 002/2026', 'Lei Orçamentária Anual 2026',
  'Emenda Parlamentar nº 3312/2026', 'Ofício nº 018/2026', 'Processo Administrativo nº 112/2026',
];

const EXPENSE_PHASES = [ExpensePhase.EMPENHO, ExpensePhase.LIQUIDACAO, ExpensePhase.PAGAMENTO];

const PROCESS_COUNT = 10;

// ─── Helper: upsert manual de OfficialDocument (sem @@unique no schema) ────

async function upsertOfficialDocument(params: {
  organizationId: string;
  documentCategory: OfficialDocumentCategory;
  documentType: string;
  sequenceNumber: number;
  year: number;
  data: Prisma.OfficialDocumentUncheckedCreateInput;
}) {
  const existing = await prisma.officialDocument.findFirst({
    where: {
      organizationId: params.organizationId,
      documentCategory: params.documentCategory,
      documentType: params.documentType,
      sequenceNumber: params.sequenceNumber,
      year: params.year,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.officialDocument.update({
      where: { id: existing.id },
      data: params.data,
    });
  }
  return prisma.officialDocument.create({ data: params.data });
}

async function main() {
  const organizations = await prisma.organization.findMany({
    where: {
      departments: { some: {} },
      users: { some: { role: 'admin', isActive: true } },
      qddItems: { some: {} },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      departments: {
        select: {
          id: true,
          name: true,
          code: true,
          qddItems: { where: { year: YEAR }, select: { id: true, ficha: true, fonte: true, naturezaDespesa: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização com departamento + admin local + QDD encontrada. Rode seed-departments.ts, seed-org-admins.ts e seed-qdd.ts primeiro.');
    return;
  }

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    const adminUser = await prisma.user.findFirst({
      where: { organizationId: org.id, role: 'admin', isActive: true },
      select: { id: true },
    });
    const departmentsWithBudget = org.departments.filter(d => d.qddItems.length > 0);

    if (!adminUser || departmentsWithBudget.length === 0) {
      console.log('   ⏭️  Sem admin local ou sem departamento com QDD — pulando (não deveria acontecer, dado o filtro da consulta).');
      continue;
    }

    // ── A) Tabelas de configuração ──
    for (const name of CATEGORY_NAMES) {
      await prisma.virtualProcessCategory.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      });
    }
    for (const name of SOURCE_NAMES) {
      await prisma.virtualProcessSource.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      });
    }
    const companies = [];
    for (const seed of COMPANY_SEEDS) {
      const cnpj = cnpjFromRoot(seed.cnpjRoot);
      const company = await prisma.virtualProcessCompany.upsert({
        where: { organizationId_name: { organizationId: org.id, name: seed.name } },
        update: { cnpj },
        create: { organizationId: org.id, name: seed.name, cnpj },
      });
      companies.push(company);
    }
    const covenantTypeMap = new Map<string, { id: string }>();
    for (const name of COVENANT_TYPE_NAMES) {
      const type = await prisma.covenantType.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      });
      covenantTypeMap.set(name, type);
    }
    const convenente = await prisma.convenente.upsert({
      where: { organizationId_name: { organizationId: org.id, name: CONVENENTE_SEED.name } },
      update: { cnpj: cnpjFromRoot(CONVENENTE_SEED.cnpjRoot) },
      create: { organizationId: org.id, name: CONVENENTE_SEED.name, cnpj: cnpjFromRoot(CONVENENTE_SEED.cnpjRoot) },
    });
    const concedente = await prisma.concedente.upsert({
      where: { organizationId_name: { organizationId: org.id, name: CONCEDENTE_SEED.name } },
      update: { cnpj: cnpjFromRoot(CONCEDENTE_SEED.cnpjRoot) },
      create: { organizationId: org.id, name: CONCEDENTE_SEED.name, cnpj: cnpjFromRoot(CONCEDENTE_SEED.cnpjRoot) },
    });
    console.log(`   ⚙️  Configuração: ${CATEGORY_NAMES.length} categorias, ${SOURCE_NAMES.length} origens, ${companies.length} empresas, ${COVENANT_TYPE_NAMES.length} tipos de convênio, 1 convenente, 1 concedente`);

    // ── B) Atos Normativos (MANUAL) ──
    for (const seed of NORMATIVO_SEEDS) {
      const formattedNumber = `${seed.documentType.toUpperCase()} Nº ${String(seed.sequenceNumber).padStart(3, '0')}/${YEAR}`;
      await upsertOfficialDocument({
        organizationId: org.id,
        documentCategory: OfficialDocumentCategory.NORMATIVO,
        documentType: seed.documentType,
        sequenceNumber: seed.sequenceNumber,
        year: YEAR,
        data: {
          organizationId: org.id,
          creatorId: adminUser.id,
          documentCategory: OfficialDocumentCategory.NORMATIVO,
          documentType: seed.documentType,
          numberingType: OfficialDocumentNumberingType.MANUAL,
          sequenceNumber: seed.sequenceNumber,
          year: YEAR,
          formattedNumber,
          subject: seed.subject,
          recipient: seed.recipient,
          // Regra real (protocol.controller.ts): Normativo é sempre CENTRAL/sem
          // departamento — ver nota no cabeçalho do arquivo.
          sector: 'CENTRAL',
          departmentId: null,
          status: OfficialDocumentStatus.EMITIDO,
          cancelReason: null,
          libraryDocumentId: null,
        },
      });
    }
    console.log(`   📜 ${NORMATIVO_SEEDS.length} atos normativos (MANUAL)`);

    // ── B) Comunicações (SEQUENTIAL) ──
    const issuingDept = departmentsWithBudget.find(d => d.code === 'GAB' || d.code === 'PRES') ?? departmentsWithBudget[0];
    const sector = issuingDept.code.toUpperCase();

    await prisma.sequenceControl.upsert({
      where: { organizationId_sector_documentType_year: { organizationId: org.id, sector, documentType: 'Ofício', year: YEAR } },
      update: { currentNumber: COMUNICACAO_SEEDS.length, departmentId: issuingDept.id, documentCategory: OfficialDocumentCategory.COMUNICACAO },
      create: {
        organizationId: org.id,
        documentCategory: OfficialDocumentCategory.COMUNICACAO,
        documentType: 'Ofício',
        sector,
        departmentId: issuingDept.id,
        year: YEAR,
        currentNumber: COMUNICACAO_SEEDS.length,
      },
    });

    for (let seq = 1; seq <= COMUNICACAO_SEEDS.length; seq++) {
      const seed = COMUNICACAO_SEEDS[seq - 1];
      const formattedNumber = `OFÍCIO Nº ${String(seq).padStart(3, '0')}/${YEAR} - ${sector}`;
      await upsertOfficialDocument({
        organizationId: org.id,
        documentCategory: OfficialDocumentCategory.COMUNICACAO,
        documentType: 'Ofício',
        sequenceNumber: seq,
        year: YEAR,
        data: {
          organizationId: org.id,
          creatorId: adminUser.id,
          documentCategory: OfficialDocumentCategory.COMUNICACAO,
          documentType: 'Ofício',
          numberingType: OfficialDocumentNumberingType.SEQUENTIAL,
          sequenceNumber: seq,
          year: YEAR,
          formattedNumber,
          subject: seed.subject,
          recipient: seed.recipient,
          sector,
          departmentId: issuingDept.id,
          status: OfficialDocumentStatus.EMITIDO,
          cancelReason: null,
          libraryDocumentId: null,
        },
      });
    }
    console.log(`   ✉️  ${COMUNICACAO_SEEDS.length} comunicações (SEQUENTIAL, setor ${sector})`);

    // ── C) Convênios ──
    const now = new Date();
    for (let i = 0; i < COVENANT_SEEDS.length; i++) {
      const seed = COVENANT_SEEDS[i];
      const department = org.departments.find(d => d.code === seed.preferredDeptCode) ?? departmentsWithBudget[0];
      const company = companies[i % companies.length];
      const covenantType = covenantTypeMap.get(seed.typeName);

      let validityStartDate: Date;
      let validityEndDate: Date;
      if (seed.phase === 'FUTURE') {
        validityStartDate = addDays(now, rand(15, 45));
        validityEndDate = addDays(validityStartDate, 365);
      } else if (seed.phase === 'ONGOING') {
        validityStartDate = addDays(now, -rand(60, 180));
        validityEndDate = addDays(now, rand(90, 200));
      } else {
        validityEndDate = addDays(now, -rand(30, 120));
        validityStartDate = addDays(validityEndDate, -365);
      }
      const executionStartDate = addDays(validityStartDate, 5);
      const termDays = Math.round((validityEndDate.getTime() - validityStartDate.getTime()) / 86_400_000);
      const transferValue = seed.transferValue;
      const counterpartValue = round2(transferValue * seed.counterpartPct);

      const data: Prisma.CovenantUncheckedCreateInput = {
        organizationId: org.id,
        departmentId: department.id,
        number: seed.number,
        typeId: covenantType.id,
        proponentId: company.id,
        convenenteId: convenente.id,
        concedenteId: concedente.id,
        processObject: seed.processObject,
        budgetaryAction: seed.budgetaryAction,
        executionStartDate,
        validityStartDate,
        validityEndDate,
        termDays,
        transferValue,
        counterpartValue,
        status: seed.status,
        bankName: seed.bankName,
        bankAgency: seed.bankAgency,
        bankAccount: seed.bankAccount,
      };

      await prisma.covenant.upsert({
        where: { organizationId_number: { organizationId: org.id, number: seed.number } },
        update: data,
        create: data,
      });
    }
    console.log(`   🤝 ${COVENANT_SEEDS.length} convênios (EM_ANALISE, EM_EXECUCAO, CONCLUIDO)`);

    // ── D) Processos Virtuais ──
    for (let seq = 1; seq <= PROCESS_COUNT; seq++) {
      const processNumber = `PROC-${String(seq).padStart(3, '0')}/${YEAR}`;
      const department = departmentsWithBudget[(seq - 1) % departmentsWithBudget.length];
      const qddItem = pick(department.qddItems);
      const company = companies[(seq - 1) % companies.length];
      const source = SOURCE_NAMES[(seq - 1) % SOURCE_NAMES.length];
      const category = CATEGORY_NAMES[(seq - 1) % CATEGORY_NAMES.length];

      const startDate = dateWithinYear(YEAR);
      const endDate = addDays(startDate, rand(60, 240));
      const validityDate = addDays(endDate, rand(30, 180));
      const totalValue = round2(rand(2_000_000, 50_000_000) / 100); // R$20.000,00 a R$500.000,00

      const data: Prisma.VirtualProcessUncheckedCreateInput = {
        organizationId: org.id,
        departmentId: department.id,
        processNumber,
        secretaria: department.name,
        source,
        sourceDetail: pick(SOURCE_DETAILS),
        bankAccount: `${rand(10000, 99999)}-${rand(0, 9)}`,
        agency: `${rand(1000, 9999)}-${rand(0, 9)}`,
        bankName: pick(BANK_POOL),
        companyCnpj: company.cnpj,
        companyName: company.name,
        startDate,
        endDate,
        validityDate,
        totalValue,
        subject: PROCESS_SUBJECTS[(seq - 1) % PROCESS_SUBJECTS.length],
        status: pick(PROCESS_STATUSES),
        category,
        qddItemId: qddItem.id,
        qddFichaSnapshot: qddItem.ficha,
        qddFonteSnapshot: qddItem.fonte,
        qddNaturezaSnapshot: qddItem.naturezaDespesa,
        budgetOverrun: false,
        expensePhase: EXPENSE_PHASES[(seq - 1) % EXPENSE_PHASES.length],
        createdById: adminUser.id,
      };

      await prisma.virtualProcess.upsert({
        where: { organizationId_processNumber: { organizationId: org.id, processNumber } },
        update: data,
        create: data,
      });
    }
    console.log(`   🗂️  ${PROCESS_COUNT} processos virtuais, todos com ficha do QDD vinculada`);
  }

  console.log(`\n🏁 Módulos de Processos Virtuais, Convênios e Protocolos populados em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de operações:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
