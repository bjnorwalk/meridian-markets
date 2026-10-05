const dsn = process.env.SENTRY_DSN

export function isSentryConfigured() {
  return !!dsn
}

export async function initSentry() {
  if (!dsn) return
  try {
    const { init } = await import('@sentry/node')
    init({ dsn, environment: process.env.RAILWAY_ENVIRONMENT || 'production' })
  } catch {}
}

export async function captureException(error, context = {}) {
  if (!dsn) return
  try {
    const { captureException: sentryCapture, withScope } = await import('@sentry/node')
    withScope((scope) => {
      if (context.user) scope.setUser(context.user)
      if (context.extra) scope.setExtras(context.extra)
      sentryCapture(error)
    })
  } catch {}
}
