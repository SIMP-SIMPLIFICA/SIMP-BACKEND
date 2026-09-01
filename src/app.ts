import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { config } from '@/config/config.js'
import { logger } from '@/utils/logger.js'
import type { AppServer } from '@/types/server'
import { registerRoutes } from './config/routes.js'
import { registerPlugins } from './config/plugins.js'
import { uploadRoutes } from './routes/upload.routes.js'
import { libraryRoutes } from './routes/library.routes.js'

/**
 * Fábrica da instância Fastify.
 *
 * Monta o servidor COMPLETO — plugins e rotas — sem nenhum efeito de processo:
 * não chama `listen()`, não abre conexão de banco, não inicia jobs nem workers,
 * não registra handlers de sinal.
 *
 * POR QUE ISSO EXISTE: os testes de integração precisam da mesma árvore de
 * rotas que roda em produção, mas exercitada por `app.inject()` — sem porta,
 * sem socket e sem fila de e-mail disparando. Antes desta separação, importar o
 * servidor num teste significaria subir o sistema inteiro como efeito colateral.
 *
 * Quem chama decide o que mais precisa: `index.ts` conecta banco, sobe jobs e
 * escuta a porta; o teste apenas injeta requisições.
 */
export async function buildApp(): Promise<AppServer> {
  const app: AppServer = Fastify({
    loggerInstance: logger,
    pluginTimeout: 40000,
    // NÃO usar `true` aqui: isso confia na cadeia X-Forwarded-For inteira e deixa
    // `request.ip` — a chave do rate limit — sob controle do cliente. Ver
    // TRUST_PROXY em config.ts.
    trustProxy: config.trustProxy,
    bodyLimit: config.server.maxBodySize,
    keepAliveTimeout: 30000,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    genReqId: () => randomUUID(),
  })

  await registerPlugins(app)
  await registerRoutes(app)

  // Rotas registradas fora de registerRoutes por já estarem assim no boot
  // original — mantidas aqui para que teste e produção sirvam exatamente o
  // mesmo conjunto de rotas.
  await app.register(uploadRoutes, { prefix: '/api/v1' })
  await app.register(libraryRoutes, { prefix: '/api/v1/library' })

  return app
}
