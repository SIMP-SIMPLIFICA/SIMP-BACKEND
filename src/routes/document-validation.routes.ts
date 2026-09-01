import type { FastifyInstance } from 'fastify'
import { documentValidationController } from '@/controllers/document-validation.controller.js'

/**
 * Portal de Validação Pública (Épico 3, Task 3.3).
 *
 * SEM autenticação de propósito: quem consulta é o cidadão ou o fiscal
 * apontando a câmera do celular para o QR Code impresso no documento. Note que
 * este arquivo NÃO registra `authMiddleware` — qualquer hook adicionado aqui
 * fecharia o portal para o público.
 *
 * Arquivo próprio, e não dentro de `public.routes.ts`, porque aquele está
 * montado na raiz (`/public`) enquanto esta rota precisa viver sob `/api/v1`.
 *
 * Rate limit próprio, mais apertado que o global: é a única rota do sistema que
 * aceita um identificador arbitrário de quem não se identificou. O teto não
 * atrapalha uso legítimo — um fiscal confere um documento por vez — e corta a
 * raspagem automatizada.
 *
 * NÃO passa pelo kill switch de organização suspensa, e isso é deliberado: um
 * recibo emitido enquanto a prefeitura estava ativa continua autêntico. Fazer a
 * validação falhar por inadimplência do município faria o portal acusar
 * "adulterado" num documento legítimo nas mãos do cidadão.
 */
export async function documentValidationRoutes(app: FastifyInstance) {
  app.get(
    '/documents/validate/:uuid',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    documentValidationController.validate
  )
}
