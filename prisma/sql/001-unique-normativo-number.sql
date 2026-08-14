-- Índice único PARCIAL: garante que não existam dois Atos Normativos do MESMO TIPO
-- com o mesmo número e ano dentro da mesma organização (Hotfix, User Story 3 / FR-011).
--
-- Por que parcial (WHERE document_category = 'NORMATIVO'):
--   Documentos de COMUNICACAO legitimamente repetem `sequence_number` entre setores
--   diferentes (cada setor tem sua própria sequência, controlada por sequence_controls).
--   Um índice único total quebraria todo o fluxo de Comunicação existente.
--
-- Por que document_type faz parte da chave:
--   Cada espécie normativa tem sua própria sequência oficial. "Lei nº 001/2026" e
--   "Decreto nº 001/2026" são documentos distintos e coexistem legitimamente — a
--   duplicidade a impedir é dois documentos do MESMO tipo com o mesmo número no
--   mesmo ano (ex: duas "Lei nº 001/2026"). Confirmado contra dados reais do banco,
--   que já continham exatamente esse par Lei/Decreto.
--
-- Por que SQL bruto e não @@unique no schema.prisma:
--   O Prisma não expressa índices únicos parciais de forma declarativa.
--
-- Este arquivo existe porque a migration history do projeto está com drift
-- (a migration 20260408032158 falha no shadow database), então o fluxo em uso é
-- `prisma db push` + SQL aplicado manualmente. Ver docs/TechStack.md §11.
--
-- Aplicação:
--   docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/001-unique-normativo-number.sql

CREATE UNIQUE INDEX IF NOT EXISTS official_documents_normativo_number_unique
  ON official_documents (organization_id, document_type, sequence_number, year)
  WHERE document_category = 'NORMATIVO';
