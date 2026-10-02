import { Prisma, PrismaClient, TaskPriority, TaskStatus, WorkspaceRole } from '@prisma/client';
import { randomInt } from 'node:crypto';

/**
 * Popula o módulo de Workspaces e Tarefas — 1 workspace pessoal do Admin +
 * 2-3 workspaces setoriais por organização, com tarefas ricas (checklist,
 * comentários, histórico) para a UI parecer uma equipe de verdade
 * trabalhando, não uma tabela vazia.
 *
 * IDEMPOTÊNCIA (mista, por tabela):
 *   - `Workspace`       → upsert por `slug`. ATENÇÃO: `slug` é ÚNICO NO BANCO
 *     INTEIRO (não por organização — conferido no schema, ao contrário de
 *     `Council.acronym` por exemplo), por isso o slug leva o slug da
 *     organização como sufixo.
 *   - `WorkspaceMember`, `Task` (e em cascata `TaskAssignee`,
 *     `ChecklistItem`, `TaskNote`, `TaskHistory`) → SEM chave natural
 *     (a composição do time e o conteúdo de cada tarefa são sorteados) —
 *     mesmo caso já documentado em `seed-councils.ts`: apaga e recria por
 *     workspace a cada execução, em vez de acumular membros/tarefas a cada
 *     rodada. `Task` tem cascade em todos os filhos (`onDelete: Cascade`),
 *     então apagar a tarefa já limpa checklist/nota/histórico/atribuição
 *     junto — não precisa apagar cada tabela filha à parte.
 *
 * "NENHUM CAMPO EM BRANCO": `description` de workspace e tarefa, `dueDate`
 * de toda tarefa e o texto de cada checklist/nota/histórico são sempre
 * preenchidos — só o `TaskAttachment` fica de fora (não pedido nesta tarefa,
 * e um anexo fictício exigiria inventar um arquivo que não existe de
 * verdade, mesma cautela já registrada em seed-operations.ts).
 */

const prisma = new PrismaClient();

function rand(min: number, max: number) {
  return randomInt(min, max + 1);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** Amostra de `n` elementos distintos, sem reposição (Fisher-Yates parcial). */
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const count = Math.min(n, copy.length);
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    const idx = randomInt(copy.length - i);
    result.push(copy[idx]);
    copy[idx] = copy[copy.length - i - 1];
  }
  return result;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── A) Workspace pessoal do Admin ───────────────────────────────────────────

const PERSONAL_TASK_SEEDS = [
  {
    title: 'Revisar despachos do dia',
    description: 'Analisar e despachar os processos e ofícios pendentes na mesa do gabinete.',
    status: TaskStatus.IN_PROGRESS, priority: TaskPriority.HIGH, dueOffsetDays: 2,
  },
  {
    title: 'Aprovar pagamentos da semana',
    description: 'Conferir e autorizar, junto à tesouraria, os pagamentos programados para a semana corrente.',
    status: TaskStatus.TODO, priority: TaskPriority.URGENT, dueOffsetDays: -1,
  },
  {
    title: 'Preparar pauta da reunião de secretariado',
    description: 'Consolidar os temas trazidos pelas secretarias para a próxima reunião de alinhamento.',
    status: TaskStatus.DONE, priority: TaskPriority.MEDIUM, dueOffsetDays: -6,
  },
];

// ─── B) Workspaces setoriais ──────────────────────────────────────────────────

const WORKSPACE_NAME_BY_DEPT_CODE: Record<string, string> = {
  SMAF: 'Gestão Financeira e Contábil',
  SMS:  'Planejamento SMS',
  SME:  'Coordenação Pedagógica SME',
  SMOI: 'Obras e Infraestrutura',
  GAB:  'Assessoria do Gabinete',
  PRES: 'Secretaria da Presidência',
  DLEG: 'Diretoria Legislativa - Equipe Técnica',
  SAF:  'Administração e Finanças da Câmara',
  UCI:  'Controle Interno - Equipe',
};

const SECTOR_WORKSPACE_COUNT = 3;

// ─── C) Tarefas setoriais ─────────────────────────────────────────────────────

const TASK_SEEDS = [
  { title: 'Prestação de Contas do 2º Trimestre',                description: 'Consolidar receitas e despesas do trimestre e enviar ao Tribunal de Contas dentro do prazo legal.' },
  { title: 'Elaboração da Folha de Pagamento',                   description: 'Fechar a folha do mês corrente, conferindo descontos, adicionais e rubricas de cada servidor.' },
  { title: 'Revisão do Edital de Merenda Escolar',                description: 'Atualizar as especificações técnicas e quantitativos do edital de aquisição de gêneros alimentícios.' },
  { title: 'Atualização do Cadastro de Fornecedores',            description: 'Verificar certidões vencidas e regularizar a documentação dos fornecedores ativos.' },
  { title: 'Levantamento de Demandas de Manutenção Predial',     description: 'Vistoriar os prédios públicos e consolidar a lista de reparos prioritários.' },
  { title: 'Organização da Campanha de Vacinação',               description: 'Definir cronograma, locais e equipe responsável pela campanha do próximo mês.' },
  { title: 'Revisão do Plano de Cargos e Salários',               description: 'Atualizar a tabela de cargos conforme a última revisão aprovada em lei.' },
  { title: 'Conferência de Notas Fiscais do Mês',                 description: 'Validar as notas fiscais recebidas contra os empenhos e liquidações registrados.' },
  { title: 'Elaboração do Relatório de Gestão Fiscal (RGF)',      description: 'Consolidar os dados de despesa com pessoal para publicação do RGF do quadrimestre.' },
  { title: 'Atualização do Portal da Transparência',              description: 'Publicar os dados orçamentários e contratos do mês no portal da transparência.' },
  { title: 'Planejamento da Capacitação de Servidores',           description: 'Levantar temas prioritários e agendar turmas de capacitação para o próximo semestre.' },
  { title: 'Levantamento de Veículos para Manutenção',            description: 'Identificar a frota com manutenção preventiva pendente e programar os atendimentos.' },
  { title: 'Revisão do Regimento Interno do Setor',               description: 'Atualizar o regimento interno conforme as mudanças recentes na estrutura administrativa.' },
  { title: 'Acompanhamento de Processos Licitatórios em Aberto',  description: 'Verificar o andamento dos processos licitatórios e cobrar pendências dos responsáveis.' },
  { title: 'Organização do Arquivo Físico do Setor',              description: 'Higienizar, catalogar e organizar os processos físicos armazenados no arquivo do setor.' },
  { title: 'Elaboração do Cronograma de Obras',                   description: 'Definir prazos e etapas das obras públicas previstas para o próximo trimestre.' },
  { title: 'Análise de Prestação de Contas de Convênio',          description: 'Conferir a documentação comprobatória enviada pelo convenente antes do parecer técnico.' },
  { title: 'Atualização do Inventário de Bens Patrimoniais',      description: 'Conferir fisicamente os bens patrimoniais do setor e atualizar o sistema de patrimônio.' },
];

const TASK_STATUSES = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.DONE];
const TASK_PRIORITIES = [TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT];

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'A Fazer', IN_PROGRESS: 'Em Andamento', IN_REVIEW: 'Em Revisão', DONE: 'Concluído', EXPIRED: 'Expirado',
};

// ─── D) Riqueza por tarefa ────────────────────────────────────────────────────

const CHECKLIST_POOL = [
  'Coletar documentação necessária',
  'Conferir dados com o setor responsável',
  'Elaborar minuta/relatório preliminar',
  'Solicitar validação da chefia',
  'Colher assinatura do responsável',
  'Protocolar/enviar documento final',
  'Arquivar comprovantes',
  'Atualizar o sistema com o status atual',
  'Notificar interessados sobre a conclusão',
  'Revisar conformidade com a legislação vigente',
];

const NOTE_POOL = [
  'As notas da empresa vieram com erro, solicitei correção.',
  'Relatório enviado para análise prévia.',
  'Aguardando retorno do fornecedor sobre o prazo.',
  'Já finalizei minha parte, só falta a revisão final.',
  'Conversei com o setor responsável, vamos alinhar amanhã.',
  'Documentação anexada ao processo físico.',
  'Precisamos revisar o valor antes de prosseguir.',
  'Tudo certo, pode seguir para a próxima etapa.',
];

function checklistDoneFlags(status: TaskStatus, count: number): boolean[] {
  if (status === TaskStatus.DONE) return Array(count).fill(true) as boolean[];
  if (status === TaskStatus.TODO) return Array(count).fill(false) as boolean[];
  if (status === TaskStatus.IN_REVIEW) return Array.from({ length: count }, (_, i) => i < count - 1);
  return Array.from({ length: count }, (_, i) => i < Math.ceil(count / 2)); // IN_PROGRESS: ~metade feita
}

/** dueDate sempre preenchido — concluída cai no passado; as demais misturam atrasada/futura. */
function taskDueDate(status: TaskStatus): Date {
  const now = new Date();
  if (status === TaskStatus.DONE) return addDays(now, -rand(5, 45));
  return rand(0, 1) === 0 ? addDays(now, -rand(3, 30)) : addDays(now, rand(3, 45));
}

async function createTaskWithDetails(params: {
  workspaceId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creatorId: string;
  memberIds: string[]; // pool de onde sortear assignees/autores de nota/histórico
}) {
  const { workspaceId, title, description, status, priority, creatorId, memberIds } = params;

  const task = await prisma.task.create({
    data: {
      workspaceId,
      title,
      description,
      status,
      priority,
      dueDate: taskDueDate(status),
      creatorId,
    },
  });

  // Atribuição — 1 a 2 responsáveis.
  const assigneeIds = sample(memberIds, rand(1, Math.min(2, memberIds.length)));
  await prisma.taskAssignee.createMany({
    data: assigneeIds.map(userId => ({ taskId: task.id, userId })),
  });

  // Checklist — 3 a 5 itens, marcados de acordo com o status da tarefa.
  const checklistCount = rand(3, 5);
  const checklistTitles = sample(CHECKLIST_POOL, checklistCount);
  const doneFlags = checklistDoneFlags(status, checklistTitles.length);
  await prisma.checklistItem.createMany({
    data: checklistTitles.map((itemTitle, i) => ({ taskId: task.id, title: itemTitle, isDone: doneFlags[i] })),
  });

  // Comentários — 1 a 3, de usuários DIFERENTES do workspace.
  const noteAuthorIds = sample(memberIds, rand(1, Math.min(3, memberIds.length)));
  for (const authorId of noteAuthorIds) {
    await prisma.taskNote.create({
      data: { taskId: task.id, authorId, content: pick(NOTE_POOL) },
    });
  }

  // Histórico — sempre 2 registros: criação + uma segunda ação coerente com o status.
  const secondEntry = status === TaskStatus.TODO
    ? { action: `Definiu a prioridade como ${priority}`, metadata: { field: 'priority', value: priority } as Prisma.InputJsonValue }
    : { action: `Moveu para "${STATUS_LABELS[status]}"`, metadata: { field: 'status', from: 'TODO', to: status } as Prisma.InputJsonValue };

  await prisma.taskHistory.createMany({
    data: [
      { taskId: task.id, userId: creatorId, action: 'Criou a tarefa', metadata: { status: TaskStatus.TODO, priority } },
      { taskId: task.id, userId: pick(memberIds), action: secondEntry.action, metadata: secondEntry.metadata },
    ],
  });

  return task;
}

async function main() {
  const organizations = await prisma.organization.findMany({
    where: {
      departments: { some: {} },
      users: { some: { role: 'admin', isActive: true } },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      departments: { select: { id: true, name: true, code: true }, orderBy: { code: 'asc' } },
      users: { where: { isActive: true }, select: { id: true, role: true, jobTitle: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização com departamento + admin local encontrada. Rode seed-departments.ts e seed-org-admins.ts primeiro.');
    return;
  }

  let totalWorkspaces = 0;
  let totalTasks = 0;

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    const adminUser = org.users.find(u => u.role === 'admin');
    // Os "15" servidores setoriais de seed-org-roles-users.ts: standard_user,
    // excluindo os conselheiros fictícios de seed-councils.ts (jobTitle
    // próprio), para sortear membros de workspace a partir do time "real".
    const sectorUserIds = org.users
      .filter(u => u.role === 'standard_user' && u.jobTitle !== 'Conselheiro(a) Municipal')
      .map(u => u.id);

    if (!adminUser || sectorUserIds.length === 0) {
      console.log('   ⏭️  Sem admin local ou sem servidores setoriais — pulando (rode seed-org-admins.ts e seed-org-roles-users.ts primeiro).');
      continue;
    }

    // ── A) Workspace pessoal do Admin ──
    const personalSlug = `gabinete-virtual-admin-${org.slug}`;
    const personalWorkspace = await prisma.workspace.upsert({
      where: { slug: personalSlug },
      update: {
        name: 'Gabinete Virtual - Admin',
        description: 'Espaço pessoal do administrador local para acompanhar despachos, aprovações e pendências do dia a dia.',
        organizationId: org.id,
        departmentId: null,
      },
      create: {
        name: 'Gabinete Virtual - Admin',
        slug: personalSlug,
        description: 'Espaço pessoal do administrador local para acompanhar despachos, aprovações e pendências do dia a dia.',
        organizationId: org.id,
        departmentId: null,
      },
    });

    await prisma.workspaceMember.deleteMany({ where: { workspaceId: personalWorkspace.id } });
    await prisma.workspaceMember.create({
      data: { workspaceId: personalWorkspace.id, userId: adminUser.id, role: WorkspaceRole.OWNER },
    });

    await prisma.task.deleteMany({ where: { workspaceId: personalWorkspace.id } });
    for (const seed of PERSONAL_TASK_SEEDS) {
      const task = await prisma.task.create({
        data: {
          workspaceId: personalWorkspace.id,
          title: seed.title,
          description: seed.description,
          status: seed.status,
          priority: seed.priority,
          dueDate: addDays(new Date(), seed.dueOffsetDays),
          creatorId: adminUser.id,
        },
      });
      await prisma.taskAssignee.create({ data: { taskId: task.id, userId: adminUser.id } });
      const checklistTitles = sample(CHECKLIST_POOL, 3);
      const doneFlags = checklistDoneFlags(seed.status, 3);
      await prisma.checklistItem.createMany({
        data: checklistTitles.map((t, i) => ({ taskId: task.id, title: t, isDone: doneFlags[i] })),
      });
      await prisma.taskNote.create({
        data: { taskId: task.id, authorId: adminUser.id, content: pick(NOTE_POOL) },
      });
      await prisma.taskHistory.createMany({
        data: [
          { taskId: task.id, userId: adminUser.id, action: 'Criou a tarefa', metadata: { status: 'TODO', priority: seed.priority } },
          { taskId: task.id, userId: adminUser.id, action: `Moveu para "${STATUS_LABELS[seed.status]}"`, metadata: { field: 'status', to: seed.status } },
        ],
      });
      totalTasks += 1;
    }
    totalWorkspaces += 1;
    console.log(`   👤 Workspace pessoal do Admin — ${PERSONAL_TASK_SEEDS.length} tarefas`);

    // ── B) Workspaces setoriais (2-3 departamentos) ──
    const selectedDepartments = org.departments.slice(0, SECTOR_WORKSPACE_COUNT);

    for (const department of selectedDepartments) {
      const workspaceName = WORKSPACE_NAME_BY_DEPT_CODE[department.code] ?? `Equipe ${department.name}`;
      const slug = `${slugify(workspaceName)}-${org.slug}`;
      const description = `Workspace de acompanhamento das atividades e tarefas da ${department.name}.`;

      const workspace = await prisma.workspace.upsert({
        where: { slug },
        update: { name: workspaceName, description, organizationId: org.id, departmentId: department.id },
        create: { name: workspaceName, slug, description, organizationId: org.id, departmentId: department.id },
      });

      await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
      const memberIds = sample(sectorUserIds, rand(3, 5));
      await prisma.workspaceMember.createMany({
        data: memberIds.map((userId, i) => ({
          workspaceId: workspace.id,
          userId,
          role: i === 0 ? WorkspaceRole.ADMIN : WorkspaceRole.MEMBER,
        })),
      });

      // ── C) e D) Tarefas do workspace setorial ──
      await prisma.task.deleteMany({ where: { workspaceId: workspace.id } });
      const taskCount = rand(5, 8);
      const taskSeeds = sample(TASK_SEEDS, Math.min(taskCount, TASK_SEEDS.length));
      // Se precisar de mais tarefas do que títulos únicos disponíveis, completa repetindo o pool.
      while (taskSeeds.length < taskCount) taskSeeds.push(pick(TASK_SEEDS));

      for (const seed of taskSeeds) {
        await createTaskWithDetails({
          workspaceId: workspace.id,
          title: seed.title,
          description: seed.description,
          status: pick(TASK_STATUSES),
          priority: pick(TASK_PRIORITIES),
          creatorId: pick(memberIds),
          memberIds,
        });
        totalTasks += 1;
      }

      totalWorkspaces += 1;
      console.log(`   🗂️  ${workspaceName} — ${memberIds.length} membros, ${taskSeeds.length} tarefas`);
    }
  }

  console.log(`\n🏁 ${totalWorkspaces} workspace(s) e ${totalTasks} tarefa(s) prontos em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de workspaces:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
