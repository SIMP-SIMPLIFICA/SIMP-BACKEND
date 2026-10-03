import { PrismaClient, SupportStatus, SupportType } from '@prisma/client';
import { randomInt } from 'node:crypto';

/**
 * Popula a Central de Chamados (Suporte In-App) — 31 chamados por
 * organização, com histórico de mensagens coerente com o status de cada um,
 * para a caixa de entrada do atendimento parecer movimentada de verdade.
 *
 * IDEMPOTÊNCIA: `SupportRequest` não tem nenhuma `@@unique` no schema (só
 * índices) — mesmo caso já visto em `OfficialDocument` (`seed-operations.ts`)
 * e `Task` (`seed-workspaces.ts`). Sem chave natural para upsert, e como o
 * conteúdo é sorteado a cada rodada, a limpeza prévia por
 * `deleteMany({ where: { organizationId } })` é o próprio pedido do usuário
 * aqui — `SupportMessage` cai junto por cascata (`onDelete: Cascade` na FK
 * para `requestId`), então não precisa apagar as mensagens à parte.
 */

const prisma = new PrismaClient();
const REQUEST_COUNT = 31;

function rand(min: number, max: number) {
  return randomInt(min, max + 1);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addHours(date: Date, hours: number): Date {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

// ─── Assuntos realistas + mensagem inicial coerente com o assunto ──────────

const SUBJECT_SEEDS = [
  { subject: 'Erro ao emitir diária',                                    initial: 'Estou tentando emitir a diária nº 003/2026 mas o sistema retorna um erro genérico. Já tentei em dois navegadores diferentes.' },
  { subject: 'Dúvida sobre saldo do QDD',                                initial: 'Não estou conseguindo entender como é calculado o saldo restante da ficha 000352 no painel do departamento. Podem me explicar?' },
  { subject: 'Como cadastrar novo membro no conselho?',                  initial: 'Preciso adicionar um novo conselheiro ao CMAS, mas não encontro a opção na tela de Conselhos. Como procedo?' },
  { subject: 'Sistema lento na tela de processos',                       initial: 'A listagem de Processos Virtuais está demorando muito para carregar, principalmente ao aplicar filtros.' },
  { subject: 'Solicitação de novo relatório',                            initial: 'Gostaria de solicitar um relatório consolidado de diárias por departamento, exportável em PDF.' },
  { subject: 'Esqueci a senha do e-mail corporativo',                    initial: 'Não estou conseguindo acessar meu e-mail institucional, esqueci a senha e o link de recuperação não chegou.' },
  { subject: 'Erro ao anexar nota fiscal na prestação de contas',        initial: 'Ao tentar anexar a nota fiscal na prestação de contas da diária, o sistema não salva o anexo.' },
  { subject: 'Dúvida sobre permissões de acesso',                        initial: 'Meu usuário não está conseguindo visualizar a aba financeira, mesmo tendo o cargo de Gestor Financeiro.' },
  { subject: 'Divergência no valor de um lançamento financeiro',         initial: 'Encontrei uma divergência entre o valor lançado e o valor da nota fiscal correspondente. Como corrijo?' },
  { subject: 'Solicitação de treinamento sobre o módulo de Convênios',   initial: 'Nossa equipe tem dúvidas sobre como cadastrar um novo convênio. Podem agendar um treinamento?' },
  { subject: 'Erro ao gerar número de protocolo',                       initial: 'Ao tentar gerar um novo Ofício, o sistema não avança e fica carregando indefinidamente.' },
  { subject: 'Dúvida sobre o fluxo de aprovação de tarefas',             initial: 'Não sei como mover uma tarefa do workspace para o status "Em Revisão". Existe um passo a passo?' },
  { subject: 'Problema ao exportar documento da Biblioteca Digital',     initial: 'Não consigo baixar um documento da Biblioteca Digital, o botão de download não responde.' },
  { subject: 'Solicitação de novo usuário no sistema',                  initial: 'Preciso cadastrar um novo servidor no sistema com acesso ao módulo de Diárias. Como faço?' },
  { subject: 'Dúvida sobre o cálculo de dias na diária',                initial: 'O sistema calculou 1,5 diária para uma viagem de 2 dias sem pernoite completo. Está correto?' },
  { subject: 'Erro 500 ao acessar o painel do departamento',            initial: 'Ao clicar no painel da minha secretaria, a página retorna um erro interno do servidor.' },
  { subject: 'Sugestão de melhoria na tela de Conselhos',               initial: 'Seria possível adicionar um filtro por status de reunião na tela de Conselhos Municipais?' },
  { subject: 'Dúvida sobre integração com o Portal da Transparência',   initial: 'Os dados publicados no Portal da Transparência não batem com os do sistema. Podem verificar?' },
];

// ─── Turnos de conversa, por papel e posição na thread ─────────────────────

const ADMIN_REPLY_TEMPLATES = [
  'Obrigado por reportar. Pode me enviar mais detalhes, como o horário em que ocorreu e um print da tela, se possível?',
  'Estamos verificando o ocorrido. Você pode confirmar em qual navegador e usuário isso aconteceu?',
  'Recebemos sua solicitação. Poderia informar o número do registro/processo relacionado, se houver?',
  'Vamos analisar o caso. Enquanto isso, poderia tentar novamente e me avisar se o problema persiste?',
  'Já estamos com o time técnico olhando isso. Pode me passar mais informações sobre o passo a passo que levou ao erro?',
];

const ADMIN_NEAR_RESOLUTION_TEMPLATES = [
  'Conseguimos identificar a causa e já aplicamos uma correção. Pode verificar se ficou certo do seu lado?',
  'Fizemos um ajuste que deve resolver o problema. Poderia confirmar, por gentileza?',
];

const ADMIN_RESOLUTION_TEMPLATES = [
  'Ótimo! Chamado marcado como resolvido. Qualquer coisa, é só abrir um novo chamado.',
  'Perfeito, vou encerrar este chamado por aqui. Disponível se precisar de algo mais.',
  'Ficamos felizes em ajudar! Encerrando o atendimento por aqui.',
  'Resolvido por aqui então. Obrigado pela paciência durante a análise.',
];

const AUTHOR_FOLLOWUP_TEMPLATES = [
  'Claro, aconteceu por volta das 14h, usando o Chrome. Segue mais detalhes.',
  'Sim, o problema persiste mesmo depois de tentar novamente.',
  'É o mesmo que mencionei na mensagem anterior. Fico no aguardo de um retorno.',
  'Testei em outro computador e o erro se repete.',
];

const AUTHOR_CONFIRM_TEMPLATES = [
  'Perfeito, testei aqui e já está funcionando normalmente. Obrigado!',
  'Consegui resolver seguindo as instruções, muito obrigado pela ajuda!',
  'Sim, chegou certinho. Agradeço o retorno rápido.',
  'Confirmado, já está tudo certo do meu lado.',
];

interface ThreadTurn {
  sender: 'author' | 'admin';
  content: string;
}

/** Thread estritamente alternada (autor sempre abre) — nunca dois turnos seguidos do mesmo remetente. */
function buildThread(length: number, initialMessage: string): ThreadTurn[] {
  const turns: ThreadTurn[] = [{ sender: 'author', content: initialMessage }];
  for (let i = 1; i < length; i++) {
    const isLast = i === length - 1;
    if (i % 2 === 1) {
      // Turno do admin.
      const content = isLast
        ? pick(ADMIN_RESOLUTION_TEMPLATES)
        : (length === 5 && i === 3 ? pick(ADMIN_NEAR_RESOLUTION_TEMPLATES) : pick(ADMIN_REPLY_TEMPLATES));
      turns.push({ sender: 'admin', content });
    } else {
      // Turno do autor.
      const content = isLast ? pick(AUTHOR_CONFIRM_TEMPLATES) : pick(AUTHOR_FOLLOWUP_TEMPLATES);
      turns.push({ sender: 'author', content });
    }
  }
  return turns;
}

// ─── B) Distribuição de status — soma exata 31 ──────────────────────────────

const STATUS_PLAN: { status: SupportStatus; count: number }[] = [
  { status: SupportStatus.OPEN,        count: 5  },
  { status: SupportStatus.IN_PROGRESS, count: 8  },
  { status: SupportStatus.RESOLVED,    count: 12 },
  { status: SupportStatus.CLOSED,      count: 6  },
];

/** Janela de "há quantos dias foi aberto", enviesada pelo status — chamado resolvido/fechado tende a ser mais antigo. */
function createdAtOffsetRange(status: SupportStatus): [number, number] {
  switch (status) {
    case SupportStatus.OPEN:        return [0, 5];
    case SupportStatus.IN_PROGRESS: return [3, 12];
    case SupportStatus.RESOLVED:    return [5, 25];
    case SupportStatus.CLOSED:      return [10, 30];
  }
}

async function main() {
  const organizations = await prisma.organization.findMany({
    where: { users: { some: { role: 'admin', isActive: true } } },
    select: {
      id: true,
      name: true,
      users: { where: { isActive: true }, select: { id: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização com admin local encontrada. Rode seed-org-admins.ts primeiro.');
    return;
  }

  let totalRequests = 0;
  let totalMessages = 0;

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    const adminIds = org.users.filter(u => u.role === 'admin').map(u => u.id);
    const authorIds = org.users.filter(u => u.role === 'standard_user').map(u => u.id);

    if (adminIds.length === 0 || authorIds.length === 0) {
      console.log('   ⏭️  Sem admin ou sem usuários comuns — pulando (rode seed-org-admins.ts e seed-org-roles-users.ts primeiro).');
      continue;
    }

    // ── A) Limpeza prévia ──
    await prisma.supportRequest.deleteMany({ where: { organizationId: org.id } });

    // Monta a lista de 31 status na ordem exata do plano (5 OPEN, 8 IN_PROGRESS, ...).
    const statusSequence: SupportStatus[] = STATUS_PLAN.flatMap(p => Array(p.count).fill(p.status));

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const status = statusSequence[i];
      const seed = pick(SUBJECT_SEEDS);
      const authorId = pick(authorIds);
      const adminId = pick(adminIds); // mesmo atendente do início ao fim da thread
      const type = rand(1, 100) <= 75 ? SupportType.TICKET : SupportType.CHAT;

      const [minDaysAgo, maxDaysAgo] = createdAtOffsetRange(status);
      const createdAt = addDays(new Date(), -rand(minDaysAgo, maxDaysAgo));

      const request = await prisma.supportRequest.create({
        data: {
          organizationId: org.id,
          authorId,
          type,
          status,
          subject: seed.subject,
          createdAt,
        },
      });

      // ── C) Histórico de mensagens, conforme o status ──
      let threadLength: number;
      if (status === SupportStatus.OPEN) {
        threadLength = 1;
      } else if (status === SupportStatus.IN_PROGRESS) {
        threadLength = rand(1, 100) <= 60 ? 3 : 2; // "1 inicial, 1 resposta, e talvez 1 tréplica"
      } else {
        threadLength = rand(3, 5); // RESOLVED ou CLOSED
      }

      const turns = buildThread(threadLength, seed.initial);
      // Thread ainda "ativa" (OPEN/IN_PROGRESS): a última mensagem está sem
      // leitura — é o que está pendente de resposta. RESOLVED/CLOSED: encerrada,
      // tudo lido.
      const stillActive = status === SupportStatus.OPEN || status === SupportStatus.IN_PROGRESS;

      let messageTime = createdAt;
      for (let t = 0; t < turns.length; t++) {
        const isLastTurn = t === turns.length - 1;
        await prisma.supportMessage.create({
          data: {
            requestId: request.id,
            senderId: turns[t].sender === 'author' ? authorId : adminId,
            content: turns[t].content,
            isRead: !(stillActive && isLastTurn),
            createdAt: messageTime,
          },
        });
        messageTime = addHours(messageTime, rand(1, 6));
        totalMessages += 1;
      }

      totalRequests += 1;
    }

    console.log(`   🎫 ${REQUEST_COUNT} chamados (5 OPEN, 8 IN_PROGRESS, 12 RESOLVED, 6 CLOSED)`);
  }

  console.log(`\n🏁 ${totalRequests} chamado(s) e ${totalMessages} mensagem(ns) prontos em ${organizations.length} organização(ões).`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de suporte:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
