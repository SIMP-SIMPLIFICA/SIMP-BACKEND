import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma.js'
import { z } from 'zod'
import { hexToBase64 } from '@/controllers/council-document.controller.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestUser {
  user: {
    id: string
    organizationId: string
    isSuperAdmin: boolean
    permissions?: string[]
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const GOVBR_AUTH_URL     = () => process.env.GOVBR_AUTH_URL     ?? 'https://sso.staging.acesso.gov.br'
const GOVBR_SIGN_API_URL = () => process.env.GOVBR_SIGN_API_URL ?? 'https://assinatura-api.staging.iti.br'
const FRONTEND_URL       = () => process.env.FRONTEND_URL        ?? 'http://localhost:5173'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// ─── Validation ───────────────────────────────────────────────────────────────

const initiateBodySchema = z.object({
  documentId: z.string().min(1),
})

const callbackQuerySchema = z.object({
  code:  z.string().min(1),
  state: z.string().min(1),
})

const statusParamSchema = z.object({
  requestId: z.string().min(1),
})

// ─── Controller ───────────────────────────────────────────────────────────────

export const signingController = {

  // POST /councils/sign/initiate — requires councils:sign permission
  async initiate(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId, id: userId } = (request as unknown as RequestUser).user
      const { documentId } = initiateBodySchema.parse(request.body)

      // Verify document exists and belongs to this org
      const document = await prisma.councilDocument.findFirst({
        where: { id: documentId, organizationId },
      })
      if (!document) return reply.code(404).send({ error: 'Not Found', message: 'Documento não encontrado.' })
      if (!document.sha256Hash) {
        return reply.code(422).send({ error: 'Missing Hash', message: 'Documento não possui hash SHA-256 calculado.' })
      }

      // Generate CSRF state and ID token nonce — 256 bits each
      const state = randomBytes(32).toString('hex')
      const nonce = randomBytes(32).toString('hex')

      // Persist OAuth state (one-time use, 10-min TTL)
      await prisma.govBrOAuthState.create({
        data: {
          state,
          nonce,
          documentId,
          userId,
          organizationId,
          expiresAt: new Date(Date.now() + STATE_TTL_MS),
        },
      })

      // Create pending signature record
      const signatureRequest = await prisma.signatureRequest.create({
        data: {
          organizationId,
          documentId,
          requestedById: userId,
        },
      })

      // Build gov.br authorization URL
      const params = new URLSearchParams({
        response_type: 'code',
        client_id:     process.env.GOVBR_CLIENT_ID     ?? '',
        redirect_uri:  process.env.GOVBR_REDIRECT_URI  ?? '',
        scope:         'openid profile email govbr_assinatura',
        state,
        nonce,
      })

      const authorizationUrl = `${GOVBR_AUTH_URL()}/authorize?${params.toString()}`

      return reply.code(201).send({ authorizationUrl, signatureRequestId: signatureRequest.id })
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Initiate Failed', message: (err as Error).message })
    }
  },

  // GET /councils/sign/callback — PUBLIC (no authMiddleware, CSRF validated via state)
  async callback(request: FastifyRequest, reply: FastifyReply) {
    const frontendBase = FRONTEND_URL()

    const queryResult = callbackQuerySchema.safeParse(request.query)
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'CSRF_INVALID', message: 'Parâmetros obrigatórios ausentes.' })
    }

    const { code, state } = queryResult.data

    // Look up the one-time state record
    const oauthState = await prisma.govBrOAuthState.findUnique({ where: { state } })
    if (!oauthState || oauthState.expiresAt < new Date()) {
      if (oauthState) {
        await prisma.govBrOAuthState.delete({ where: { state } }).catch(() => {})
      }
      return reply.code(400).send({ error: 'CSRF_INVALID', message: 'State inválido ou expirado.' })
    }

    // ONE-TIME USE: delete immediately before any network call
    await prisma.govBrOAuthState.delete({ where: { state } })

    // Find the matching pending request (most recent, for this doc + user)
    const signatureRequest = await prisma.signatureRequest.findFirst({
      where: {
        documentId:    oauthState.documentId,
        requestedById: oauthState.userId,
        organizationId: oauthState.organizationId,
        status:        'PENDENTE',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!signatureRequest) {
      return reply.redirect(`${frontendBase}/councils/sign/return?error=NO_REQUEST`)
    }

    try {
      // Exchange authorization code for access_token
      const tokenRes = await fetch(`${GOVBR_AUTH_URL()}/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  process.env.GOVBR_REDIRECT_URI  ?? '',
          client_id:     process.env.GOVBR_CLIENT_ID     ?? '',
          client_secret: process.env.GOVBR_CLIENT_SECRET ?? '',
        }).toString(),
      })

      if (!tokenRes.ok) {
        throw new Error(`Token exchange failed: HTTP ${tokenRes.status}`)
      }

      const tokenPayload = await tokenRes.json() as { access_token?: string }
      const access_token = tokenPayload.access_token
      if (!access_token) throw new Error('No access_token in gov.br response')

      // Fetch document and its SHA-256 hash
      const document = await prisma.councilDocument.findFirst({
        where: { id: oauthState.documentId, organizationId: oauthState.organizationId },
        select: { sha256Hash: true },
      })
      if (!document?.sha256Hash) throw new Error('Document hash unavailable')

      // Call gov.br signing API — hash must be Base64, not hex
      const signRes = await fetch(`${GOVBR_SIGN_API_URL()}/api/v1/assinar`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          hashDocumento:   hexToBase64(document.sha256Hash),
          algoritmoHash:   'SHA256withRSA',
          tipoAssinatura:  'ATTACHED',
          nivelAssinatura: 'AD_RB',
        }),
      })

      if (!signRes.ok) {
        throw new Error(`Signing API failed: HTTP ${signRes.status}`)
      }

      const signPayload = await signRes.json() as { assinatura?: string }
      const assinatura = signPayload.assinatura
      if (!assinatura) throw new Error('No assinatura in signing API response')

      // Persist PKCS#7 result — access_token is never stored permanently
      await prisma.signatureRequest.update({
        where: { id: signatureRequest.id },
        data: {
          status:    'ASSINADO',
          pkcs7Data: assinatura,
          signedAt:  new Date(),
          errorMsg:  null,
        },
      })

      return reply.redirect(`${frontendBase}/councils/sign/return?requestId=${signatureRequest.id}`)
    } catch (err) {
      const errorMessage = (err as Error).message

      await prisma.signatureRequest.update({
        where: { id: signatureRequest.id },
        data: { status: 'FALHOU', errorMsg: errorMessage },
      }).catch(() => {})

      request.log.error({ err, requestId: signatureRequest.id }, 'Gov.br signing failed')

      return reply.redirect(
        `${frontendBase}/councils/sign/return?requestId=${signatureRequest.id}&error=SIGNING_FAILED`,
      )
    }
  },

  // GET /councils/sign/:requestId/status — requires councils:read permission
  async status(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { organizationId } = (request as unknown as RequestUser).user
      const { requestId } = statusParamSchema.parse(request.params)

      // Select only safe fields — pkcs7Data and accessToken are never exposed
      const record = await prisma.signatureRequest.findFirst({
        where: { id: requestId, organizationId },
        select: {
          id:         true,
          status:     true,
          signedAt:   true,
          errorMsg:   true,
          documentId: true,
          createdAt:  true,
        },
      })

      if (!record) return reply.code(404).send({ error: 'Not Found' })

      return reply.send(record)
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation Error', issues: err.issues })
      return reply.code(500).send({ error: 'Status Fetch Failed', message: (err as Error).message })
    }
  },
}
