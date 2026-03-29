import * as Sentry from '@sentry/node'
import { config } from './config.js'

export function initSentry() {
  if (!config.observability.sentryDsn) return

  Sentry.init({
    dsn: config.observability.sentryDsn,
    environment: config.isDevelopment ? 'development' : 'production',
    tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    sendDefaultPii: false
  })
}

export { Sentry }
