# Redis no deploy: persistência e indisponibilidade

2026-10-05 · registrado com a decisão D15 (`docs/frotas/decisoes.md`)

> **Status (2026-10-10): pendência registrada, fora do escopo atual.** Por ora o Frotas roda só no ambiente local (Docker com Redis persistente); deploy no Render não está em cogitação. Os itens abaixo valem quando houver um ambiente publicado.

## Situação

| Ambiente | Redis | Persistência |
| --- | --- | --- |
| Local (`docker-compose.yml`) | `redis:7-alpine` com `--appendonly yes --requirepass redis123` e volume `redis_data` | **Sim**: AOF ligado, sobrevive a `docker compose restart` |
| Render (`render.yaml`, `simp-redis-dev`) | plano `free`, `maxmemoryPolicy: noeviction` | **Não**: a instância gratuita do Render Key Value não grava em disco; um reinício ou manutenção apaga tudo |

O boot (`src/index.ts`) trata o Redis como **não fatal**: sem ele, a API sobe e o banimento de IP do honeypot fica restrito à instância.

## O que a D15 põe no Redis

- Sessão de 30 min do frentista (trava por aparelho), com TTL.
- Rate limit da rota pública do frentista.
- Travas curtas contra envio simultâneo.

Perder esses dados num reinício não causa prejuízo: o frentista digita a placa de novo, e o contador de rate limit recomeça. O que é prova continua no Postgres: token (hash), contador de placas, bloqueio, chave NFC-e e auditoria.

## O que precisa no deploy

1. **Redis acessível pela API em produção.** Sem Redis, a rota do frentista recusa abrir sessão ("Sistema temporariamente indisponível, tente em instantes"). Com a regra de nunca liberar uso sem trava, o Redis vira dependência da operação no posto, não só do cache.
2. **Persistência é desejável, mas não obrigatória.** Num plano pago do Render Key Value (que persiste em disco), um reinício não derruba as sessões em curso no posto. No plano free, cada reinício encerra as sessões abertas; o frentista só precisa digitar a placa de novo, sem perda de dado.
3. **Manter `maxmemoryPolicy: noeviction`.** BullMQ exige essa política, e com despejo a sessão do frentista poderia sumir antes do TTL.
4. **Senha e TLS.** Em produção, `REDIS_URL` com senha (`rediss://` se o provedor oferecer TLS). O `ipAllowList: []` do `render.yaml` só permite conexões da rede privada do Render; manter assim.
5. **Monitorar a indisponibilidade.** A mensagem ao frentista só ajuda se alguém souber que o Redis caiu: o erro de conexão já vai para o log (`redis.ts`), e convém um alerta no Sentry.
