-- Imutabilidade da trilha de auditoria (Épico 2, Task 2.1)
--
-- Bloqueia UPDATE e DELETE na tabela audit_logs. O registro de auditoria é
-- append-only: uma vez gravado, não pode ser alterado nem removido por ninguém.
--
-- POR QUE UM TRIGGER, E NÃO APENAS REVOKE:
--   A aplicação conecta como `postgres`, que é SUPERUSUÁRIO e DONO da tabela.
--   REVOKE UPDATE/DELETE não tem efeito sobre o dono nem sobre um superusuário —
--   sozinho, seria teatro de segurança. O trigger dispara independentemente do
--   papel, e é ele que efetivamente impede a alteração.
--   O REVOKE no fim é defesa em profundidade: passa a valer no dia em que a
--   aplicação deixar de conectar como superusuário (recomendado para produção).
--
-- COMO REVERTER (exige acesso administrativo deliberado ao banco, que é o ponto):
--   DROP TRIGGER trg_auditoria_imutavel ON audit_logs;
--
-- Aplicação:
--   docker exec -i fastify-postgres psql -U postgres -d fastify_auth < prisma/sql/002-auditoria-imutavel.sql

CREATE OR REPLACE FUNCTION fn_auditoria_imutavel()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Registro de auditoria e imutavel: % nao e permitido na tabela audit_logs (id=%)',
    TG_OP,
    COALESCE(OLD.id, '(desconhecido)')
  USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_imutavel ON audit_logs;

CREATE TRIGGER trg_auditoria_imutavel
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_auditoria_imutavel();

-- Defesa em profundidade: sem efeito enquanto a app conectar como superusuário,
-- mas já deixa a permissão correta para um papel de aplicação restrito.
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
