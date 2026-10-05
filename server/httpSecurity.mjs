const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isSecureRequest(req) {
  return (
    req?.headers?.['x-forwarded-proto'] === 'https' ||
    req?.socket?.encrypted === true ||
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT
  )
}

export function securityHeaders(req) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  }

  if (isSecureRequest(req)) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}

function firstHeaderValue(value) {
  return String(value ?? '').split(',')[0].trim()
}

function hostFromUrl(value) {
  if (!value) return ''
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return ''
  }
}

export function validateSameOriginMutation(req) {
  if (!unsafeMethods.has(req.method)) return

  const requestHost = firstHeaderValue(req.headers?.['x-forwarded-host'] ?? req.headers?.host).toLowerCase()
  if (!requestHost) return

  const originHost = hostFromUrl(req.headers?.origin)
  const refererHost = hostFromUrl(req.headers?.referer)
  const presentedHost = originHost || refererHost

  if (presentedHost && presentedHost !== requestHost) {
    const error = new Error('Cross-site requests are not allowed.')
    error.status = 403
    error.code = 'CSRF_BLOCKED'
    throw error
  }
}
