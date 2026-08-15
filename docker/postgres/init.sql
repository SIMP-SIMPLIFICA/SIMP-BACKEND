-- Executado automaticamente pelo Postgres na primeira inicialização do container
-- (bind-mount em /docker-entrypoint-initdb.d/init.sql). Garante que a extensão
-- usada pelo Prisma (postgresqlExtensions) para busca sem acento já exista,
-- mesmo em cenários fora do fluxo normal de migration (ex: prisma db push).
CREATE EXTENSION IF NOT EXISTS unaccent;
