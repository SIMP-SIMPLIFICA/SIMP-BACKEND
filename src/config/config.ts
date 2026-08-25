import { z } from 'zod'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const configSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  HOST: z.string().default('localhost'),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),
  // Opcionais: URL direta (sem pooler) para rodar migrations e URL de réplica de leitura.
  // Localmente, ambas ficam sem uso — o Postgres local não tem pooler nem réplica.
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DATABASE_REPLICA_URL: z.string().url().optional(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1m'),

  /**
   * Quantos proxies reversos existem à frente da aplicação.
   *
   * CRÍTICO PARA O RATE LIMIT. Com `trustProxy: true` (o valor anterior), o Fastify
   * aceita a cadeia X-Forwarded-For inteira e `request.ip` passa a ser o valor mais
   * à ESQUERDA — que é escrito pelo cliente. Um atacante mandava um XFF diferente a
   * cada requisição e recebia uma chave de rate limit nova toda vez, anulando por
   * completo o limite de 5 logins/minuto.
   *
   * Com um número N, o Fastify confia apenas nos N saltos mais próximos e resolve
   * `request.ip` para o endereço que o proxy confiável realmente observou.
   *
   * Render/Vercel/Cloudflare com um proxy à frente: 1. Sem proxy: 0.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),

  /** Limite estrito das rotas de autenticação (login, registro, reset de senha). */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().positive().default(5),
  RATE_LIMIT_AUTH_WINDOW: z.string().default('1m'),

  // Honeypot / banimento de IP
  /** Duração do banimento, em segundos. Default 24h. */
  HONEYPOT_BAN_TTL: z.coerce.number().int().positive().default(24 * 60 * 60),
  /**
   * Quantas vezes o campo-isca precisa vir preenchido antes de banir o IP.
   *
   * Acessar uma rota-isca (`/.env`) bane na hora — nenhum cliente legítimo pede
   * aquilo. Já o campo-isca no formulário admite falso positivo: alguns
   * gerenciadores de senha preenchem campos ocultos. Exigir reincidência evita
   * derrubar um usuário real por 24h por causa do autofill do navegador dele.
   */
  HONEYPOT_FIELD_STRIKES: z.coerce.number().int().positive().default(3),
  /**
   * IPs que nunca podem ser banidos, separados por vírgula.
   *
   * Necessário por causa de NAT: uma prefeitura inteira costuma sair por um único
   * IP público. Uma máquina infectada na rede não pode tirar o órgão inteiro do ar.
   */
  HONEYPOT_ALLOWLIST: z.string().default(''),
  HONEYPOT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform(v => v === 'true'),

  // Cloudflare Turnstile — proteção anti-bot invisível
  /** Segredo do servidor. Sem ele a verificação NÃO roda (ver nota abaixo). */
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /**
   * Liga/desliga explicitamente. Deixar indefinido faz o valor ser derivado da
   * presença do segredo.
   *
   * Em produção, `config.ts` recusa subir com o Turnstile ligado e sem segredo —
   * um erro de digitação numa variável de ambiente não pode desligar silenciosamente
   * uma proteção de segurança.
   */
  TURNSTILE_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),

  // Email
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().min(1).max(65535),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email(),
  SMTP_FROM_NAME: z.string(),

  // Application URLs
  APP_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),

  // Security
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(20).default(12),
  SESSION_SECRET: z.string().min(32),

  // Features
  ENABLE_2FA: z.coerce.boolean().default(true),
  ENABLE_EMAIL_VERIFICATION: z.coerce.boolean().default(true),
  ENABLE_PASSWORD_RESET: z.coerce.boolean().default(true),
  ENABLE_AUDIT_LOGS: z.coerce.boolean().default(true),
  SWAGGER_ENABLED: z.coerce.boolean().default(true),

  // File Upload
  MAX_FILE_SIZE: z.coerce.number().positive().default(10485760), // 10MB
  UPLOAD_DIR: z.string().default('uploads'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ENABLE_REQUEST_LOGGING: z.coerce.boolean().default(true),

  // Observability (optional — features activate only when set)
  SENTRY_DSN: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  BETTERSTACK_SOURCE_TOKEN: z.string().optional(),

  // Armazenamento de arquivos: local em disco (pasta `uploads/`), servido em
  // /uploads/ via @fastify/static. Zero credenciais de nuvem — ver
  // src/services/storage.service.ts e a Constituição (Princípio I).

  // Gov.br OAuth2 + assinatura digital — USE_MOCK_GOVBR=true (padrão local)
  // simula o fluxo de assinatura sem exigir credenciais reais do gov.br.
  GOVBR_CLIENT_ID: z.string().optional(),
  GOVBR_CLIENT_SECRET: z.string().optional(),
  GOVBR_REDIRECT_URI: z.string().url().optional(),
  GOVBR_AUTH_URL: z.string().url().default('https://sso.staging.acesso.gov.br'),
  GOVBR_SIGN_API_URL: z.string().url().default('https://assinatura-api.staging.iti.br'),
  USE_MOCK_GOVBR: z.coerce.boolean().default(true)
})

const parsedEnv = configSchema.safeParse(process.env)

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsedEnv.error.format())
  process.exit(1)
}

const env = parsedEnv.data

export const config = {
  // Environment
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  // Server configuration
  server: {
    port: env.PORT,
    host: env.HOST,
    corsOrigins: env.CORS_ORIGIN.split(',').map(origin => origin.trim()),
    maxBodySize: env.MAX_FILE_SIZE
  },

  // Database
  database: {
    url: env.DATABASE_URL,
    migrationUrl: env.DATABASE_MIGRATION_URL,
    replicaUrl: env.DATABASE_REPLICA_URL
  },

  // Redis
  redis: {
    url: env.REDIS_URL
  },

  // JWT configuration
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN
  },

  // Rate limiting
  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    authMax: env.RATE_LIMIT_AUTH_MAX,
    authWindow: env.RATE_LIMIT_AUTH_WINDOW
  },

  /** Saltos de proxy confiáveis — ver comentário em TRUST_PROXY. */
  trustProxy: env.TRUST_PROXY,

  honeypot: {
    enabled: env.HONEYPOT_ENABLED,
    banTtl: env.HONEYPOT_BAN_TTL,
    fieldStrikes: env.HONEYPOT_FIELD_STRIKES,
    allowlist: env.HONEYPOT_ALLOWLIST
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean),
  },

  turnstile: {
    secretKey: env.TURNSTILE_SECRET_KEY,
    // Sem TURNSTILE_ENABLED explícito, liga se houver segredo configurado.
    enabled: env.TURNSTILE_ENABLED ?? Boolean(env.TURNSTILE_SECRET_KEY),
  },

  // Email configuration
  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
    fromName: env.SMTP_FROM_NAME
  },

  // Application URLs
  urls: {
    app: env.APP_URL,
    frontend: env.FRONTEND_URL
  },

  // Security
  security: {
    bcryptRounds: env.BCRYPT_ROUNDS,
    sessionSecret: env.SESSION_SECRET
  },

  // Feature flags
  features: {
    twoFactor: env.ENABLE_2FA,
    emailVerification: env.ENABLE_EMAIL_VERIFICATION,
    passwordReset: env.ENABLE_PASSWORD_RESET,
    auditLogs: env.ENABLE_AUDIT_LOGS,
    swagger: env.SWAGGER_ENABLED
  },

  // File upload
  upload: {
    maxFileSize: env.MAX_FILE_SIZE,
    uploadDir: env.UPLOAD_DIR
  },

  // Logging
  logging: {
    level: env.LOG_LEVEL,
    enableRequestLogging: env.ENABLE_REQUEST_LOGGING
  },

  // Observability
  observability: {
    sentryDsn: env.SENTRY_DSN,
    betterstackToken: env.BETTERSTACK_SOURCE_TOKEN
  },

  // Gov.br OAuth2 + assinatura digital
  govbr: {
    clientId: env.GOVBR_CLIENT_ID,
    clientSecret: env.GOVBR_CLIENT_SECRET,
    redirectUri: env.GOVBR_REDIRECT_URI,
    authUrl: env.GOVBR_AUTH_URL,
    signApiUrl: env.GOVBR_SIGN_API_URL,
    useMock: env.USE_MOCK_GOVBR
  }
} as const

/**
 * Fail-fast de produção para o Turnstile.
 *
 * Sem isto, esquecer TURNSTILE_SECRET_KEY no ambiente de produção deixaria a
 * proteção anti-bot desligada em silêncio — o login continuaria funcionando e
 * ninguém perceberia até o primeiro ataque. Preferimos não subir.
 */
if (config.isProduction && config.turnstile.enabled && !config.turnstile.secretKey) {
  throw new Error(
    'TURNSTILE_ENABLED=true mas TURNSTILE_SECRET_KEY não foi definida. ' +
    'Configure o segredo ou defina TURNSTILE_ENABLED=false explicitamente.'
  )
}

// Type export for use in other files
export type Config = typeof config
