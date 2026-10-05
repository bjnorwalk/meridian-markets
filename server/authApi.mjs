import { rateLimited } from './rateLimiter.mjs'
import { createDbBackup } from './backup.mjs'
import { isSecureRequest, securityHeaders, validateSameOriginMutation } from './httpSecurity.mjs'
import {
  addActiveWatchlistItem,
  addPortfolioHolding,
  addWatchlistItem,
  authenticateUser,
  createNamedWatchlist,
  createSession,
  createUser,
  deleteWatchlist,
  deleteSession,
  refreshSession,
  getPortfolio,
  getPreferences,
  getWatchlists,
  getUserFromSession,
  getWatchlist,
  removeActiveWatchlistItem,
  removePortfolioHolding,
  removeWatchlistItem,
  requestPasswordReset,
  reorderWatchlistItems,
  resetUserPassword,
  setActiveWatchlist,
  updatePortfolioHolding,
  updateAlertSettings,
  updatePreferences,
  updateWatchlist,
  recordPortfolioSnapshot,
  getPortfolioPerformance,
  savePushSubscription,
  removePushSubscription,
} from './userStore.mjs'

const sessionCookieName = 'mm_session'
const maxJsonBodyBytes = 64 * 1024
function normalizeUsername(u) { return String(u ?? '').trim().toLowerCase() }

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(res.req),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

function sendError(res, error) {
  const status = error.status && Number.isInteger(error.status) ? error.status : 500
  sendJson(res, status, {
    error: {
      code: error.code ?? 'APP_API_ERROR',
      message: error.message ?? 'Request failed.',
    },
  })
}

function parseCookieHeader(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf('=')
        if (separator === -1) return [item, '']
        return [
          decodeURIComponent(item.slice(0, separator)),
          decodeURIComponent(item.slice(separator + 1)),
        ]
      }),
  )
}

function sessionCookie(req, token, maxAge) {
  const secure = isSecureRequest(req) ? '; Secure' : ''
  return `${sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge)}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

function clearSessionCookie(req) {
  const secure = isSecureRequest(req) ? '; Secure' : ''
  return `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`
}

async function readJsonBody(req) {
  const contentLength = Number(req.headers['content-length'] ?? '0')
  if (Number.isFinite(contentLength) && contentLength > maxJsonBodyBytes) {
    const error = new Error('Request body is too large.')
    error.status = 413
    error.code = 'REQUEST_BODY_TOO_LARGE'
    throw error
  }

  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    totalBytes += Buffer.byteLength(chunk)
    if (totalBytes > maxJsonBodyBytes) {
      const error = new Error('Request body is too large.')
      error.status = 413
      error.code = 'REQUEST_BODY_TOO_LARGE'
      throw error
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Invalid JSON request body.')
    error.status = 400
    error.code = 'INVALID_JSON'
    throw error
  }
}

async function currentUser(req) {
  const cookies = parseCookieHeader(req.headers.cookie)
  return getUserFromSession(cookies[sessionCookieName])
}

async function requireUser(req) {
  const user = await currentUser(req)
  if (!user) {
    const error = new Error('Sign in first.')
    error.status = 401
    error.code = 'UNAUTHORIZED'
    throw error
  }
  return user
}

export function createAuthApiMiddleware() {
  return async function authApiMiddleware(req, res, next) {
    if (
      !req.url?.startsWith('/api/auth') &&
      !req.url?.startsWith('/api/preferences') &&
      !req.url?.startsWith('/api/watchlist') &&
      !req.url?.startsWith('/api/portfolio')
    ) {
      next?.()
      return false
    }

    try {
      res.req = req
      const url = new URL(req.url, 'http://localhost')
      validateSameOriginMutation(req)

      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        sendJson(res, 200, { user: await currentUser(req) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
        const cookies = parseCookieHeader(req.headers.cookie)
        const token = cookies[sessionCookieName]
        if (!token) { sendError(res, { status: 401, code: 'NO_SESSION', message: 'No session.' }); return true }
        const refreshed = await refreshSession(token)
        if (!refreshed) { sendError(res, { status: 401, code: 'SESSION_EXPIRED', message: 'Session expired.' }); return true }
        sendJson(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, refreshed.token, refreshed.maxAge) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        const rl = rateLimited(req, 5)
        if (!rl.allowed) return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${rl.retryAfter}s.` } }, { 'retry-after': String(rl.retryAfter) })
        const body = await readJsonBody(req)
        const user = await createUser(body.username, body.password, body.email)
        const session = await createSession(user.id)
        sendJson(res, 201, { user }, { 'set-cookie': sessionCookie(req, session.token, session.maxAge) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const rl = rateLimited(req, 10)
        if (!rl.allowed) return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${rl.retryAfter}s.` } }, { 'retry-after': String(rl.retryAfter) })
        const body = await readJsonBody(req)
        const user = await authenticateUser(body.username, body.password)
        const session = await createSession(user.id)
        sendJson(res, 200, { user }, { 'set-cookie': sessionCookie(req, session.token, session.maxAge) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
        const rl = rateLimited(req, 3)
        if (!rl.allowed) return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${rl.retryAfter}s.` } }, { 'retry-after': String(rl.retryAfter) })
        const body = await readJsonBody(req)
        sendJson(res, 200, { reset: await requestPasswordReset(body.username) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') {
        const rl = rateLimited(req, 5)
        if (!rl.allowed) return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${rl.retryAfter}s.` } }, { 'retry-after': String(rl.retryAfter) })
        const body = await readJsonBody(req)
        const user = await resetUserPassword(body.username, body.resetCode, body.password)
        const session = await createSession(user.id)
        sendJson(res, 200, { user }, { 'set-cookie': sessionCookie(req, session.token, session.maxAge) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/backup') {
        const user = await requireUser(req)
        const envUser = process.env.ADMIN_USERNAME
        if (!envUser || user.username !== normalizeUsername(envUser)) {
          return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Admin only.' } })
        }
        const result = createDbBackup()
        sendJson(res, result.ok ? 200 : 500, result)
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const cookies = parseCookieHeader(req.headers.cookie)
        await deleteSession(cookies[sessionCookieName])
        sendJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie(req) })
        return true
      }

      if (req.method === 'GET' && url.pathname === '/api/preferences') {
        const user = await requireUser(req)
        sendJson(res, 200, await getPreferences(user.id))
        return true
      }

      if (req.method === 'PATCH' && url.pathname === '/api/preferences/alerts') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 200, await updateAlertSettings(user.id, body.alerts))
        return true
      }

      if (req.method === 'PATCH' && url.pathname === '/api/preferences') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 200, await updatePreferences(user.id, body.preferences))
        return true
      }

      if (req.method === 'GET' && url.pathname === '/api/portfolio') {
        const user = await requireUser(req)
        sendJson(res, 200, await getPortfolio(user.id))
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/portfolio') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 200, await addPortfolioHolding(user.id, body.holding))
        return true
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/portfolio/')) {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        const holdingId = decodeURIComponent(url.pathname.replace('/api/portfolio/', ''))
        sendJson(res, 200, await updatePortfolioHolding(user.id, holdingId, body.holding))
        return true
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/portfolio/')) {
        const user = await requireUser(req)
        const holdingId = decodeURIComponent(url.pathname.replace('/api/portfolio/', ''))
        sendJson(res, 200, await removePortfolioHolding(user.id, holdingId))
        return true
      }

      if (req.method === 'GET' && url.pathname === '/api/portfolio/performance') {
        const user = await requireUser(req)
        const days = Math.min(Number(url.searchParams.get('days')) || 365, 1095)
        const symbols = (user.portfolio || []).map((h) => h.symbol).filter(Boolean)
        let currentPrices = {}
        if (symbols.length > 0) {
          try {
            const snapRes = await fetch(`http://localhost:${process.env.PORT || 5180}/api/market/snapshots?symbols=${symbols.join(',')}`)
            if (snapRes.ok) {
              const snapData = await snapRes.json()
              currentPrices = snapData?.snapshots || {}
            }
          } catch {}
        }
        const data = getPortfolioPerformance(user.id, { days, currentPrices })
        if (data.snapshots.length === 0 && symbols.length > 0) {
          try {
            await recordPortfolioSnapshot(user.id, currentPrices)
            const retry = getPortfolioPerformance(user.id, { days, currentPrices })
            sendJson(res, 200, retry || data)
            return true
          } catch {}
        }
        sendJson(res, 200, data)
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/portfolio/snapshot') {
        const user = await requireUser(req)
        const result = await recordPortfolioSnapshot(user.id)
        sendJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/notifications/push-subscribe') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        if (!body.endpoint) { sendError(res, { status: 400, code: 'MISSING_ENDPOINT', message: 'Push subscription endpoint required.' }); return true }
        savePushSubscription(user.id, body)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/notifications/push-unsubscribe') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        if (body.endpoint) removePushSubscription(user.id, body.endpoint)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (req.method === 'GET' && url.pathname === '/api/watchlists') {
        const user = await requireUser(req)
        sendJson(res, 200, await getWatchlists(user.id))
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/watchlists') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 201, await createNamedWatchlist(user.id, body.name))
        return true
      }

      if (req.method === 'PATCH' && url.pathname === '/api/watchlists/active') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 200, await setActiveWatchlist(user.id, body.watchlistId))
        return true
      }

      if (req.method === 'PATCH' && url.pathname.endsWith('/items/reorder')) {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        const watchlistId = url.pathname
          .replace('/api/watchlists/', '')
          .replace('/items/reorder', '')
        sendJson(res, 200, await reorderWatchlistItems(user.id, watchlistId, body.symbols))
        return true
      }

      if (req.method === 'POST' && url.pathname.endsWith('/items')) {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        const watchlistId = url.pathname
          .replace('/api/watchlists/', '')
          .replace('/items', '')
        sendJson(res, 200, await addWatchlistItem(user.id, watchlistId, body.symbol))
        return true
      }

      if (req.method === 'DELETE' && url.pathname.includes('/items/')) {
        const user = await requireUser(req)
        const [watchlistId, symbol] = url.pathname
          .replace('/api/watchlists/', '')
          .split('/items/')
        sendJson(
          res,
          200,
          await removeWatchlistItem(user.id, watchlistId, decodeURIComponent(symbol)),
        )
        return true
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/watchlists/')) {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        const watchlistId = decodeURIComponent(url.pathname.replace('/api/watchlists/', ''))
        sendJson(res, 200, await updateWatchlist(user.id, watchlistId, body))
        return true
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/watchlists/')) {
        const user = await requireUser(req)
        const watchlistId = decodeURIComponent(url.pathname.replace('/api/watchlists/', ''))
        sendJson(res, 200, await deleteWatchlist(user.id, watchlistId))
        return true
      }

      if (req.method === 'GET' && url.pathname === '/api/watchlist') {
        const user = await requireUser(req)
        sendJson(res, 200, { watchlist: await getWatchlist(user.id) })
        return true
      }

      if (req.method === 'POST' && url.pathname === '/api/watchlist') {
        const user = await requireUser(req)
        const body = await readJsonBody(req)
        sendJson(res, 200, { watchlist: await addActiveWatchlistItem(user.id, body.symbol) })
        return true
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/watchlist/')) {
        const user = await requireUser(req)
        const symbol = decodeURIComponent(url.pathname.replace('/api/watchlist/', ''))
        sendJson(res, 200, { watchlist: await removeActiveWatchlistItem(user.id, symbol) })
        return true
      }

      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Unknown auth API endpoint.' },
      })
      return true
    } catch (error) {
      sendError(res, error)
      return true
    }
  }
}
