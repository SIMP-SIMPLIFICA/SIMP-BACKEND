import { PrismaClient } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';

/**
 * Popula o módulo de Conselhos Municipais — 5 conselhos clássicos por
 * organização, mesa diretora completa, 10 reuniões por conselho com pautas,
 * votações e listas de presença.
 *
 * ESTRATÉGIA DE IDEMPOTÊNCIA (mista, por tabela):
 *   - `Council`           → upsert por `[organizationId, acronym]` (unicidade
 *                           real do schema): rodar de novo atualiza nome/
 *                           descrição em vez de duplicar.
 *   - `CouncilDepartment` → upsert por `[councilId, departmentId]`.
 *   - `CouncilMembership`, `CouncilMeeting` (e, em cascata, `MeetingAgendaItem`
 *     e `MeetingAttendance`) → SEM chave natural (a composição da mesa é uma
 *     amostra aleatória de usuários, e o calendário de reuniões não tem nome
 *     único) — mesmo caso já documentado em `seed-finance.ts`. Por isso o
 *     script APAGA e RECRIA essas quatro tabelas para cada conselho a cada
 *     execução, em vez de tentar um upsert que não tem em cima do que operar.
 *     Isso também evita o bug óbvio de rodar upsert por `[councilId, userId,
 *     role]` aqui: como a amostra de usuários muda a cada execução, um
 *     upsert por essa chave iria ACUMULAR presidentes/secretários antigos em
 *     vez de substituí-los. Apagar a mesa inteira e remontar é o que garante
 *     "um Presidente só" a cada rodada.
 *   Ordem de apagar importa: `CouncilMeeting` primeiro (cascata derruba
 *   `MeetingAgendaItem` e `MeetingAttendance`, que dependem de `membershipId`)
 *   e só DEPOIS `CouncilMembership` — apagar na ordem inversa violaria a FK
 *   de `MeetingAttendance.membershipId` enquanto reuniões antigas ainda
 *   existissem.
 *
 * VÍNCULO CONSELHO ↔ DEPARTAMENTO: os 5 conselhos têm uma secretaria
 * "natural" (Saúde→SMS, Educação→SME, etc.), mas nem toda organização
 * semeada tem essas secretarias — uma Câmara Municipal (`seed-departments.ts`)
 * só tem PRES/DLEG/SAF/UCI, nenhuma bate com os códigos preferidos. Nesse
 * caso o script cai num fallback (primeiro departamento cadastrado da
 * organização) só para o conselho não ficar órfão de setor — não é uma
 * correspondência real, é dado de teste para a tela não quebrar.
 *
 * USUÁRIOS (CONSELHEIROS): o requisito pede mesas de 12 a 24 membros: se a
 * organização tiver menos de 24 usuários no total (comum logo após
 * `seed-org-roles-users.ts`, que deixa ~16: 1 admin + 15 setoriais), o script
 * completa com usuários fictícios adicionais (role `standard_user`, senha
 * igual à dos outros seeds) até chegar a 24 — nomes de um pool que não repete
 * nenhum nome já usado em `seed-org-roles-users.ts`, para não colidir e-mail.
 * Esse preenchimento também é idempotente (upsert por e-mail): na segunda
 * execução a organização já tem ≥24 usuários e o passo é pulado.
 */

const prisma = new PrismaClient();
const PASSWORD = 'Senha123!';
const MIN_COUNCILORS = 24;

function rand(min: number, max: number) {
  return randomInt(min, max + 1);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** Amostra de `n` elementos distintos, sem reposição (Fisher-Yates parcial). */
function sample<T>(arr: T[], n: number): T[] {
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

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Conselhos clássicos ─────────────────────────────────────────────────────

interface CouncilSeed {
  acronym: string;
  name: string;
  policyArea: string;
  preferredDeptCodes: string[];
}

const COUNCILS: CouncilSeed[] = [
  { acronym: 'CMS',   name: 'Conselho Municipal de Saúde',                                  policyArea: 'Saúde',                                    preferredDeptCodes: ['SMS'] },
  { acronym: 'CME',   name: 'Conselho Municipal de Educação',                                policyArea: 'Educação',                                 preferredDeptCodes: ['SME'] },
  { acronym: 'CMAS',  name: 'Conselho Municipal de Assistência Social',                       policyArea: 'Assistência Social',                       preferredDeptCodes: ['SMAF'] },
  { acronym: 'CMMA',  name: 'Conselho Municipal de Meio Ambiente',                            policyArea: 'Meio Ambiente',                            preferredDeptCodes: ['SMOI'] },
  { acronym: 'CMDCA', name: 'Conselho Municipal dos Direitos da Criança e do Adolescente',    policyArea: 'Direitos da Criança e do Adolescente',     preferredDeptCodes: ['SME', 'SMAF'] },
];

function pickDepartmentsForCouncil(
  departments: { id: string; code: string }[],
  council: CouncilSeed
): string[] {
  const matched = departments.filter(d => council.preferredDeptCodes.includes(d.code)).map(d => d.id);
  if (matched.length > 0) return matched.slice(0, 2);
  // Fallback: organização sem nenhuma secretaria correspondente (ex.: Câmara) — usa o primeiro
  // departamento cadastrado, só para o conselho não ficar sem nenhum vínculo.
  return departments.length > 0 ? [departments[0].id] : [];
}

// ─── Pool de conselheiros fictícios extra (nomes que NÃO se repetem com os
// de seed-org-roles-users.ts, para não colidir e-mail) ──────────────────────

const COUNCIL_FILLER_NAMES: { firstName: string; lastName: string }[] = [
  { firstName: 'Otávio',   lastName: 'Ramalho'  },
  { firstName: 'Rafael',   lastName: 'Teixeira' },
  { firstName: 'Simone',   lastName: 'Uchoa'    },
  { firstName: 'Tiago',    lastName: 'Vieira'   },
  { firstName: 'Vanessa',  lastName: 'Xavier'   },
  { firstName: 'William',  lastName: 'Yamamoto' },
  { firstName: 'Yasmin',   lastName: 'Zanetti'  },
  { firstName: 'André',    lastName: 'Correia'  },
  { firstName: 'Beatriz',  lastName: 'Dornelles'},
  { firstName: 'Caio',     lastName: 'Espínola' },
  { firstName: 'Daniela',  lastName: 'Farias'   },
  { firstName: 'Eduardo',  lastName: 'Guerra'   },
];

// ─── Pautas — temas reais de gestão pública, alguns templados pela área do
// conselho (`policyArea`) ────────────────────────────────────────────────────

const AGENDA_TEMPLATES: ((policyArea: string) => string)[] = [
  (area) => `Aprovação do Plano Municipal de ${area}`,
  () => 'Prestação de Contas Quadrimestral',
  () => `Apreciação de Denúncia nº ${rand(1, 999)}/${new Date().getFullYear()}`,
  () => 'Votação do Regimento Interno',
  () => 'Eleição da Nova Mesa Diretora',
  () => 'Deliberação sobre Convênio com Entidade Parceira',
  () => 'Apresentação do Relatório Anual de Atividades',
  () => 'Análise de Prestação de Contas de Entidade Conveniada',
  (area) => `Discussão sobre Repasse de Recursos do Fundo Municipal de ${area}`,
  () => `Aprovação do Calendário de Reuniões ${new Date().getFullYear() + 1}`,
];

const CONCLUDED_AGENDA_STATUSES = [
  'APROVADO_UNANIMIDADE',
  'APROVADO_MAIORIA',
  'APROVADO_RESSALVAS',
  'REPROVADO',
  'VISTAS_ADIADO',
] as const;

const RESSALVA_REMARKS = [
  'Aprovado com ressalva quanto ao prazo de execução apresentado.',
  'Aprovado condicionado à apresentação de documentação complementar em 30 dias.',
  'Aprovado com ressalva sobre a necessidade de revisão orçamentária do item.',
];

const REPROVADO_REMARKS = [
  'Reprovado por ausência de documentação comprobatória.',
  'Reprovado após parecer técnico contrário da comissão responsável.',
  'Reprovado por maioria dos conselheiros presentes, sem quórum qualificado favorável.',
];

/** 8 reuniões passadas (mensais, concluídas) + 2 futuras (mensais, agendadas), em ordem cronológica. */
function buildMeetingDates(): { scheduledAt: Date; endedAt: Date | null; status: 'CONCLUIDA' | 'AGENDADA' }[] {
  const now = new Date();
  const result: { scheduledAt: Date; endedAt: Date | null; status: 'CONCLUIDA' | 'AGENDADA' }[] = [];

  for (const monthsAgo of [8, 7, 6, 5, 4, 3, 2, 1]) {
    const scheduledAt = new Date(now);
    scheduledAt.setMonth(scheduledAt.getMonth() - monthsAgo);
    scheduledAt.setHours(14, 0, 0, 0);
    const endedAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);
    result.push({ scheduledAt, endedAt, status: 'CONCLUIDA' });
  }

  for (const monthsAhead of [1, 2]) {
    const scheduledAt = new Date(now);
    scheduledAt.setMonth(scheduledAt.getMonth() + monthsAhead);
    scheduledAt.setHours(14, 0, 0, 0);
    result.push({ scheduledAt, endedAt: null, status: 'AGENDADA' });
  }

  return result;
}

async function main() {
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      departments: { select: { id: true, code: true } },
      users: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (organizations.length === 0) {
    console.log('⚠️  Nenhuma organização encontrada. Rode src/scripts/seed-organizations.ts primeiro.');
    return;
  }

  const passwordHash = await hash(PASSWORD, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  let totalCouncils = 0;
  let totalMemberships = 0;
  let totalMeetings = 0;

  for (const org of organizations) {
    console.log(`\n🏛️  ${org.name}`);

    // ── A) Garantir pelo menos 24 usuários (conselheiros) ──
    const councilorIds: string[] = org.users.map(u => u.id);
    if (councilorIds.length < MIN_COUNCILORS) {
      const needed = MIN_COUNCILORS - councilorIds.length;
      const fillerNames = COUNCIL_FILLER_NAMES.slice(0, needed);
      if (fillerNames.length < needed) {
        console.log(`   ⚠️  Pool de nomes fictícios (${COUNCIL_FILLER_NAMES.length}) menor que o necessário (${needed}) — completando com o que houver.`);
      }

      for (const { firstName, lastName } of fillerNames) {
        const email = `${slugify(firstName)}.${slugify(lastName)}@${org.slug}.com`;
        const user = await prisma.user.upsert({
          where: { email },
          update: {
            password: passwordHash,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
            jobTitle: 'Conselheiro(a) Municipal',
            role: 'standard_user',
            organizationId: org.id,
            isActive: true,
            isVerified: true,
          },
          create: {
            id: randomUUID(),
            email,
            password: passwordHash,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
            jobTitle: 'Conselheiro(a) Municipal',
            role: 'standard_user',
            organizationId: org.id,
            isActive: true,
            isVerified: true,
          },
        });
        councilorIds.push(user.id);
      }
      console.log(`   👥 +${fillerNames.length} conselheiro(a)s fictícios (total agora: ${councilorIds.length})`);
    }

    // ── B) a E) Um conselho por vez ──
    for (const councilSeed of COUNCILS) {
      const council = await prisma.council.upsert({
        where: { organizationId_acronym: { organizationId: org.id, acronym: councilSeed.acronym } },
        update: {
          name: councilSeed.name,
          description: `${councilSeed.name} — órgão colegiado de caráter deliberativo e fiscalizador de políticas públicas de ${councilSeed.policyArea.toLowerCase()}.`,
          legalBasis: 'Criado por lei municipal específica (dado fictício de teste, sem número real).',
          isActive: true,
        },
        create: {
          organizationId: org.id,
          name: councilSeed.name,
          acronym: councilSeed.acronym,
          description: `${councilSeed.name} — órgão colegiado de caráter deliberativo e fiscalizador de políticas públicas de ${councilSeed.policyArea.toLowerCase()}.`,
          legalBasis: 'Criado por lei municipal específica (dado fictício de teste, sem número real).',
          isActive: true,
        },
      });

      // B) Vínculo com 1-2 departamentos
      const deptIds = pickDepartmentsForCouncil(org.departments, councilSeed);
      for (const departmentId of deptIds) {
        await prisma.councilDepartment.upsert({
          where: { councilId_departmentId: { councilId: council.id, departmentId } },
          update: {},
          create: { organizationId: org.id, councilId: council.id, departmentId },
        });
      }

      // Apaga meetings (cascata: agenda + presença) e DEPOIS memberships — ordem importa (ver cabeçalho).
      await prisma.councilMeeting.deleteMany({ where: { councilId: council.id } });
      await prisma.councilMembership.deleteMany({ where: { councilId: council.id } });

      // C) Mesa diretora e membros
      const memberCount = rand(12, 24);
      const selectedUserIds = sample(councilorIds, memberCount);
      const termStart = new Date(new Date().getFullYear(), 0, 1);

      const roleAssignments: { userId: string; role: 'PRESIDENTE' | 'VICE_PRESIDENTE' | 'SECRETARIO' | 'MEMBRO_TITULAR' | 'MEMBRO_SUPLENTE' }[] = [
        { userId: selectedUserIds[0], role: 'PRESIDENTE' },
        { userId: selectedUserIds[1], role: 'VICE_PRESIDENTE' },
        { userId: selectedUserIds[2], role: 'SECRETARIO' },
      ];
      for (let i = 3; i < selectedUserIds.length; i++) {
        roleAssignments.push({
          userId: selectedUserIds[i],
          role: rand(1, 100) <= 60 ? 'MEMBRO_TITULAR' : 'MEMBRO_SUPLENTE',
        });
      }

      const memberships = [];
      for (const assignment of roleAssignments) {
        const membership = await prisma.councilMembership.create({
          data: {
            organizationId: org.id,
            councilId: council.id,
            userId: assignment.userId,
            role: assignment.role,
            startDate: termStart,
            isActive: true,
          },
        });
        memberships.push(membership);
      }

      // D) 10 reuniões (8 concluídas + 2 agendadas)
      const chairIds = memberships
        .filter(m => m.role === 'PRESIDENTE' || m.role === 'SECRETARIO')
        .map(m => m.userId);
      const quorum = Math.floor(memberships.length / 2) + 1;
      const meetingDates = buildMeetingDates();

      for (let i = 0; i < meetingDates.length; i++) {
        const { scheduledAt, endedAt, status } = meetingDates[i];

        const meeting = await prisma.councilMeeting.create({
          data: {
            organizationId: org.id,
            councilId: council.id,
            title: `${i + 1}ª Reunião Ordinária do ${councilSeed.acronym}`,
            location: 'Auditório da Prefeitura Municipal',
            scheduledAt,
            endedAt,
            status,
            quorum,
            createdById: pick(chairIds),
          },
        });

        // E) Presenças — uma linha por membro do conselho, nessa reunião
        await prisma.meetingAttendance.createMany({
          data: memberships.map(m => {
            const isPresent = rand(1, 100) <= 80;
            return {
              meetingId: meeting.id,
              membershipId: m.id,
              isPresent,
              justifiedAbsence: isPresent ? null : rand(1, 100) <= 50,
            };
          }),
        });

        // E) Pautas — 3 a 5, com status variado só nas reuniões já concluídas
        const itemCount = rand(3, 5);
        const chosenTemplates = sample(AGENDA_TEMPLATES, itemCount);
        await prisma.meetingAgendaItem.createMany({
          data: chosenTemplates.map((template, idx) => {
            const title = template(councilSeed.policyArea);

            if (status !== 'CONCLUIDA') {
              return { meetingId: meeting.id, order: idx + 1, title, status: 'PENDENTE' as const, votingRemarks: null };
            }

            const itemStatus = pick(CONCLUDED_AGENDA_STATUSES);
            const votingRemarks =
              itemStatus === 'APROVADO_RESSALVAS' ? pick(RESSALVA_REMARKS)
              : itemStatus === 'REPROVADO' ? pick(REPROVADO_REMARKS)
              : null;

            return { meetingId: meeting.id, order: idx + 1, title, status: itemStatus, votingRemarks };
          }),
        });
      }

      totalCouncils += 1;
      totalMemberships += memberships.length;
      totalMeetings += meetingDates.length;
      console.log(`   🏛️  ${councilSeed.acronym} — ${memberships.length} membros, ${meetingDates.length} reuniões, ${deptIds.length} departamento(s) vinculado(s)`);
    }
  }

  console.log(`\n🏁 ${totalCouncils} conselho(s), ${totalMemberships} vínculo(s) de membro e ${totalMeetings} reunião(ões) prontos em ${organizations.length} organização(ões).`);
  console.log(`   Senha (conselheiros fictícios novos): ${PASSWORD}`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de conselhos:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
