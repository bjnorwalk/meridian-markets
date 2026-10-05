import { getSnapshot } from './alpacaClient.mjs'
import { securityHeaders } from './httpSecurity.mjs'
import { sendAlertEmail } from './mailer.mjs'
import {
  createNotification,
  getNotifications,
  getUnreadNotificationCount,
  getAlertKeys,
  markNotificationRead,
  markAllNotificationsRead,
  getUserFromSession,
  dispatchPushNotifications,
} from './userStore.mjs'

const SESSION_COOKIE = 'mm_session'

function parseCookies(h) {
  if (!h) return {}
  return Object.fromEntries(h.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=')
    return i === -1 ? [s, ''] : [decodeURIComponent(s.slice(0, i)), decodeURIComponent(s.slice(i + 1))]
  }))
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(res.req),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendError(res, status, message) {
  sendJson(res, status, { error: { message } })
}

export function createNotifyApiMiddleware() {
  return async function notifyApiMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/notifications')) { next?.(); return false }

    try {
      res.req = req
      const url = new URL(req.url, 'http://localhost')

      const cookies = parseCookies(req.headers.cookie)
      const user = await getUserFromSession(cookies[SESSION_COOKIE])
      if (!user) { sendError(res, 401, 'Sign in first.'); return true }
      const userId = user.id

      if (url.pathname === '/api/notifications' && req.method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100)
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
        sendJson(res, 200, getNotifications(userId, limit, offset))
        return true
      }

      if (url.pathname === '/api/notifications/unread-count' && req.method === 'GET') {
        sendJson(res, 200, { unreadCount: getUnreadNotificationCount(userId) })
        return true
      }

      if (url.pathname === '/api/notifications' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { type, title, body: notifBody, symbol, severity, key } = JSON.parse(body)
        if (!type || !title) { sendError(res, 400, 'Missing type or title.'); return true }

        const id = createNotification(userId, type, title, notifBody || '', {
          symbol: symbol || '',
          severity: severity || 'info',
          key: key || '',
          metadata: { key: key || '' },
        })
        sendJson(res, 201, { id })
        return true
      }

      if (url.pathname === '/api/notifications/read-all' && req.method === 'POST') {
        markAllNotificationsRead(userId)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (url.pathname.startsWith('/api/notifications/') && url.pathname.endsWith('/read') && req.method === 'PATCH') {
        const match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/)
        if (match) {
          markNotificationRead(userId, match[1])
          sendJson(res, 200, { ok: true })
          return true
        }
      }

      if (url.pathname === '/api/notifications/evaluate' && req.method === 'POST') {
        const result = await evaluatePortfolioAlerts(userId)
        sendJson(res, 200, result)
        return true
      }

      sendError(res, 404, 'Unknown notification endpoint.')
      return true
    } catch (err) {
      sendError(res, 500, err.message || 'Notification error')
      return true
    }
  }
}

async function evaluatePortfolioAlerts(userId) {
  const { getPortfolio, getPreferences, getUserEmail } = await import('./userStore.mjs')
  const portfolioResult = await getPortfolio(userId)
  const holdings = portfolioResult?.portfolio ?? []
  if (!holdings.length) return { notifications: [], unreadCount: 0 }

  const prefs = await getPreferences(userId)
  const thresholds = prefs?.preferences?.alerts || { driftPercent: 5, concentrationPercent: 35, dayMovePercent: 2 }
  const activeKeys = getAlertKeys(userId)

  const userEmail = thresholds.emailAlerts ? await getUserEmail(userId) : null

  const enriched = []
  let totalValue = 0
  for (const h of holdings) {
    let price = null
    try { const snap = await getSnapshot(h.symbol); if (snap?.snapshot?.price) price = snap.snapshot.price } catch {}
    const avg = h.averageCost ?? 0; const sh = h.shares ?? 0; const cp = price ?? avg
    const mv = sh * cp; const cb = sh * avg
    totalValue += mv
    enriched.push({ ...h, price: cp, marketValue: mv, costBasis: cb, gain: mv - cb })
  }

  const createdIds = []
  const link = 'https://meridianmarkets.app'

  for (const p of enriched) {
    const alloc = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0

    if (alloc >= thresholds.concentrationPercent) {
      const key = 'concentration_' + p.symbol
      if (!activeKeys.has(key)) {
        const msg = p.symbol + ' is ' + alloc.toFixed(1) + '% of your portfolio — above your ' + thresholds.concentrationPercent + '% threshold.'
        const id = createNotification(userId, 'concentration', 'Concentration alert', msg, { symbol: p.symbol, severity: 'warning', key, metadata: { key } })
        if (id) {
          createdIds.push(id)
          if (userEmail && thresholds.emailConcentration) {
            sendAlertEmail(userEmail, 'Concentration alert', p.symbol, msg, { link }).catch(() => {})
          }
          dispatchPushNotifications(userId, 'Concentration alert', msg, 'concentration', link).catch(() => {})
        }
      }
    }

    if (p.targetWeight > 0) {
      const drift = alloc - p.targetWeight
      if (Math.abs(drift) >= thresholds.driftPercent) {
        const key = 'drift_' + p.symbol
        if (!activeKeys.has(key)) {
          const msg = p.symbol + ' has drifted ' + (drift > 0 ? '+' : '') + drift.toFixed(1) + '% from its ' + p.targetWeight + '% target.'
          const id = createNotification(userId, 'drift', 'Drift alert', msg, { symbol: p.symbol, severity: 'warning', key, metadata: { key } })
          if (id) {
            createdIds.push(id)
            if (userEmail && thresholds.emailDrift) {
              sendAlertEmail(userEmail, 'Drift alert', p.symbol, msg, { link }).catch(() => {})
            }
            dispatchPushNotifications(userId, 'Drift alert', msg, 'drift', link).catch(() => {})
          }
        }
      }
    }

    if (p.price && p.costBasis > 0) {
      const dayMove = ((p.price - p.averageCost) / p.averageCost) * 100
      if (Math.abs(dayMove) >= thresholds.dayMovePercent) {
        const key = 'daymove_' + p.symbol
        if (!activeKeys.has(key)) {
          const direction = dayMove > 0 ? 'up' : 'down'
          const msg = p.symbol + ' is ' + direction + ' ' + Math.abs(dayMove).toFixed(1) + '% from your average cost of $' + p.averageCost.toFixed(2) + '.'
          const id = createNotification(userId, 'day_move', 'Day move alert', msg, { symbol: p.symbol, severity: dayMove > 0 ? 'info' : 'warning', key, metadata: { key } })
          if (id) {
            createdIds.push(id)
            if (userEmail && thresholds.emailDayMove) {
              sendAlertEmail(userEmail, 'Day move alert', p.symbol, msg, { link }).catch(() => {})
            }
            dispatchPushNotifications(userId, 'Day move alert', msg, 'daymove', link).catch(() => {})
          }
        }
      }
    }
  }

  if (enriched.length > 0 && !activeKeys.has('no_targets')) {
    const hasAllTargets = enriched.every((p) => p.targetWeight > 0)
    if (!hasAllTargets && enriched.some((p) => p.targetWeight > 0)) {
      const id = createNotification(userId, 'info', 'Allocation model', 'Some holdings are missing target allocations. Add targets to unlock drift monitoring.', { severity: 'info', key: 'no_targets', metadata: { key: 'no_targets' } })
      if (id) createdIds.push(id)
    }
  }

  return { notifications: createdIds, unreadCount: getUnreadNotificationCount(userId) }
}
