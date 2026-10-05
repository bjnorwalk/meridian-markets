const attempts = new Map()

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of attempts) {
    if (now - entry.windowStart > WINDOW_MS * 2) attempts.delete(key)
  }
}, WINDOW_MS * 2).unref()

export function rateLimited(req, maxPerWindow = MAX_ATTEMPTS, windowMs = WINDOW_MS) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  const key = ip
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now - entry.windowStart > windowMs) {
    attempts.set(key, { count: 1, windowStart: now })
    return { allowed: true }
  }
  entry.count++
  if (entry.count > maxPerWindow) {
    const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000)
    return { allowed: false, retryAfter }
  }
  return { allowed: true }
}
