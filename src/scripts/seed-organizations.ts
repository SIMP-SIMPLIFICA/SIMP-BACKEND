import { PrismaClient } from '@prisma/client';
import { randomInt } from 'node:crypto';

/**
 * Popula organizações fictícias para testar isolamento multi-tenant e o
 * Painel do Super Admin.
 *
 * `upsert` por `slug`, não `create`: rodar de novo (outro reset do banco,
 * por exemplo) atualiza os dados em vez de falhar por violação de
 * unicidade — mesmo padrão já usado em `seed-admin.ts`.
 *
 * CNPJ gerado com dígito verificador VÁLIDO (mesmo algoritmo de
 * `src/utils/cnpj.util.ts#isValidCnpj`, reimplementado aqui em vez de
 * importado: é um script de seed autônomo, no mesmo espírito de
 * `seed-finance.ts`, que já reimplementa seus próprios helpers pequenos em
 * vez de importar do app). Só o dígito verificador é real — a raiz de 8
 * dígitos é aleatória, então não corresponde a nenhuma empresa existente.
 */

const prisma = new PrismaClient();

// ─── CNPJ fictício, mas com dígito verificador válido ──────────────────────

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, ...CNPJ_FIRST_WEIGHTS];

function cnpjCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Raiz de 8 dígitos aleatória (CSPRNG) + filial fixa "0001" + 2 dígitos verificadores reais. */
function generateFakeCnpj(): string {
  const root = Array.from({ length: 8 }, () => randomInt(0, 10)).join('');
  const base = `${root}0001`; // raiz + ordem/filial
  const d1 = cnpjCheckDigit(base, CNPJ_FIRST_WEIGHTS);
  const d2 = cnpjCheckDigit(base + d1, CNPJ_SECOND_WEIGHTS);
  return `${base}${d1}${d2}`;
}

// ─── Slug a partir do nome ──────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .normalize('NFD')
    // ̀-ͯ: marcas diacríticas combinantes que sobram após NFD (é
    // isso que separa "ç" em "c" + cedilha combinante, por exemplo) — escape
    // explícito, não caractere literal, para não depender de como o editor
    // renderiza uma marca combinante sozinha.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Organizações fictícias ─────────────────────────────────────────────────
// Nomes e municípios INVENTADOS de propósito — nenhum corresponde a uma
// prefeitura ou câmara real, para não confundir dado de teste com órgão
// público de verdade.

interface FakeOrg {
  name: string;
  city: string;
  state: string;
  plan: 'basic' | 'premium';
}

const ORGANIZATIONS: FakeOrg[] = [
  { name: 'Prefeitura Municipal de Nova Aurora',           city: 'Nova Aurora',            state: 'GO', plan: 'premium' },
  { name: 'Câmara Municipal de Vila Clara',                city: 'Vila Clara',             state: 'MG', plan: 'basic'   },
  { name: 'Prefeitura Municipal de Porto Serrano',         city: 'Porto Serrano',          state: 'SC', plan: 'basic'   },
  { name: 'Prefeitura Municipal de Serra Dourada do Oeste', city: 'Serra Dourada do Oeste', state: 'TO', plan: 'premium' },
  { name: 'Câmara Municipal de Boa Esperança do Norte',    city: 'Boa Esperança do Norte', state: 'PA', plan: 'basic'   },
];

async function main() {
  for (const org of ORGANIZATIONS) {
    const slug = slugify(org.name);
    const cnpj = generateFakeCnpj();

    const created = await prisma.organization.upsert({
      where: { slug },
      update: {
        name: org.name,
        city: org.city,
        state: org.state,
        plan: org.plan,
        isActive: true,
      },
      create: {
        name: org.name,
        slug,
        cnpj,
        city: org.city,
        state: org.state,
        plan: org.plan,
        isActive: true,
      },
    });

    console.log(`✅ ${created.name}`);
    console.log(`   slug: ${created.slug} · cnpj: ${created.cnpj} · plano: ${created.plan} · ${created.city}/${created.state}`);
  }

  console.log(`\n🏁 ${ORGANIZATIONS.length} organizações prontas.`);
}

main()
  .catch((e) => { console.error('❌ Falha no seed de organizações:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
