import {
  getAlpacaStatus,
  getAlpacaDebug,
  getBars,
  getMarketClock,
  getNews,
  getOptionChain,
  getSnapshot,
  getSnapshots,
  getSparklines,
  getTrending,
  searchAssets,
} from './alpacaClient.mjs'
import { getScreenerResults, getScreenerScanState, runScreener } from './screener.mjs'
import { getUserFromSession } from './userStore.mjs'
import { securityHeaders } from './httpSecurity.mjs'

const sessionCookieName = 'mm_session'
const marketCache = new Map()
const marketCacheMaxEntries = 250
const maxBatchSymbols = 50
const maxOptionContracts = 120

const ttl = {
  search: 10 * 60 * 1000,
  bars: 60 * 1000,
  snapshot: 10 * 1000,
  snapshots: 10 * 1000,
  clock: 30 * 1000,
  news: 2 * 60 * 1000,
  sparklines: 2 * 60 * 1000,
  trending: 60 * 1000,
  optionsChain: 30 * 1000,
}

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase()
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(res.req),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendError(res, error) {
  const status = error.status && Number.isInteger(error.status) ? error.status : 500
  sendJson(res, status, {
    error: {
      code: error.code ?? 'MARKET_API_ERROR',
      message: error.message ?? 'Market data request failed.',
      requestId: error.requestId,
      authMode: error.authMode,
      authModes: error.authModes,
    },
  })
}

function apiError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function readCache(cacheKey) {
  const entry = marketCache.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    marketCache.delete(cacheKey)
    return null
  }
  return entry.payload
}

function writeCache(cacheKey, payload, ttlMs) {
  if (ttlMs <= 0) return payload
  if (marketCache.size >= marketCacheMaxEntries) {
    const firstKey = marketCache.keys().next().value
    if (firstKey) marketCache.delete(firstKey)
  }
  marketCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  })
  return payload
}

async function cached(cacheKey, ttlMs, factory) {
  const existing = readCache(cacheKey)
  if (existing) return existing
  return writeCache(cacheKey, await factory(), ttlMs)
}

function clampLimit(value, fallback = 12, min = 1, max = 24) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function parseSymbolsParam(value) {
  const symbols = Array.from(
    new Set(
      String(value ?? '')
        .split(',')
        .map(normalizeSymbol)
        .filter(Boolean),
    ),
  ).sort()

  if (symbols.length > maxBatchSymbols) {
    throw apiError(
      400,
      'TOO_MANY_SYMBOLS',
      `Request up to ${maxBatchSymbols} symbols at a time.`,
    )
  }

  return symbols
}

async function canAccessDebug(req) {
  if (process.env.ALLOW_MARKET_DEBUG === 'true') return true

  const envUser = process.env.ADMIN_USERNAME
  if (!envUser) return false

  const cookies = parseCookieHeader(req.headers.cookie)
  const user = await getUserFromSession(cookies[sessionCookieName])
  return user?.username === normalizeUsername(envUser)
}

export function createMarketApiMiddleware() {
  return async function marketApiMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/market') && !req.url?.startsWith('/api/options')) {
      next?.()
      return false
    }

    try {
      res.req = req
      const url = new URL(req.url, 'http://localhost')

      if (url.pathname === '/api/market/status') {
        sendJson(res, 200, getAlpacaStatus())
        return true
      }

      if (url.pathname === '/api/options/chain') {
        const symbol = normalizeSymbol(url.searchParams.get('symbol'))
        const requestedType = String(url.searchParams.get('type') ?? '').trim().toLowerCase()
        const expirationDate = String(url.searchParams.get('expiration_date') ?? url.searchParams.get('expiration') ?? '').trim()
        const limit = clampLimit(
          url.searchParams.get('limit') ?? '80',
          80,
          1,
          maxOptionContracts,
        )

        if (!symbol) {
          sendJson(res, 400, { error: { code: 'SYMBOL_REQUIRED', message: 'Missing symbol.' } })
          return true
        }

        if (requestedType && !['call', 'put', 'all'].includes(requestedType)) {
          sendJson(res, 400, { error: { code: 'INVALID_OPTION_TYPE', message: 'Type must be call, put, or all.' } })
          return true
        }

        if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
          sendJson(res, 400, { error: { code: 'INVALID_EXPIRATION', message: 'Expiration must use YYYY-MM-DD.' } })
          return true
        }

        const optionType = requestedType === 'call' || requestedType === 'put'
          ? requestedType
          : undefined
        sendJson(
          res,
          200,
          await cached(
            `options-chain:${symbol}:${optionType ?? 'all'}:${expirationDate || 'all'}:${limit}`,
            ttl.optionsChain,
            () => getOptionChain(symbol, {
              type: optionType,
              expirationDate: expirationDate || undefined,
              limit,
            }),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/debug') {
        if (!(await canAccessDebug(req))) {
          sendJson(res, 403, {
            error: {
              code: 'FORBIDDEN',
              message: 'Market debug is restricted to administrators.',
            },
          })
          return true
        }

        sendJson(res, 200, getAlpacaDebug())
        return true
      }

      if (url.pathname === '/api/market/search') {
        const query = url.searchParams.get('query') ?? ''
        const limit = clampLimit(url.searchParams.get('limit') ?? '12')
        const term = query.trim().toUpperCase()
        if (!term) {
          sendJson(res, 200, { symbols: [] })
          return true
        }
        sendJson(
          res,
          200,
          await cached(
            `search:${term}:${limit}`,
            ttl.search,
            () => searchAssets(query, limit),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/bars') {
        const symbol = normalizeSymbol(url.searchParams.get('symbol'))
        const timeframe = url.searchParams.get('timeframe') ?? '1D'
        if (!symbol) {
          sendJson(res, 400, { error: { code: 'SYMBOL_REQUIRED', message: 'Missing symbol.' } })
          return true
        }

        sendJson(
          res,
          200,
          await cached(
            `bars:${symbol}:${timeframe}`,
            ttl.bars,
            () => getBars(symbol, timeframe),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/snapshot') {
        const symbol = normalizeSymbol(url.searchParams.get('symbol'))
        if (!symbol) {
          sendJson(res, 400, { error: { code: 'SYMBOL_REQUIRED', message: 'Missing symbol.' } })
          return true
        }

        sendJson(
          res,
          200,
          await cached(
            `snapshot:${symbol}`,
            ttl.snapshot,
            () => getSnapshot(symbol),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/clock') {
        sendJson(
          res,
          200,
          await cached('clock', ttl.clock, () => getMarketClock()),
        )
        return true
      }

      if (url.pathname === '/api/market/news') {
        const symbol = normalizeSymbol(url.searchParams.get('symbol'))
        if (!symbol) {
          sendJson(res, 400, { error: { code: 'SYMBOL_REQUIRED', message: 'Missing symbol.' } })
          return true
        }
        sendJson(
          res,
          200,
          await cached(
            `news:${symbol}`,
            ttl.news,
            () => getNews(symbol),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/sparklines') {
        const symbols = parseSymbolsParam(url.searchParams.get('symbols'))
        if (symbols.length === 0) {
          sendJson(res, 400, { error: { code: 'SYMBOLS_REQUIRED', message: 'Missing symbols.' } })
          return true
        }
        sendJson(
          res,
          200,
          await cached(
            `sparklines:${symbols.join(',')}`,
            ttl.sparklines,
            () => getSparklines(symbols),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/trending') {
        const period = url.searchParams.get('period') ?? 'day'
        sendJson(
          res,
          200,
          await cached(
            `trending:${period}`,
            ttl.trending,
            () => getTrending(period),
          ),
        )
        return true
      }

      if (url.pathname === '/api/market/screener') {
        const scope = url.searchParams.get('scope') || 'sp500'
        const userId = url.searchParams.get('userId') || null
        const force = url.searchParams.get('force') === 'true'

        // If client asks for force, kick off scan in background and return current state
        if (force) {
          runScreener(scope, userId).catch(() => {})
          const scanState = getScreenerScanState(scope, userId)
          if (scanState) {
            sendJson(res, 200, { ...scanState, partial: true })
            return true
          }
        }

        let data = getScreenerResults(scope, userId)
        // If nothing cached and not already running, kick off a scan
        if (!data && !getScreenerScanState(scope, userId)) {
          runScreener(scope, userId).catch(() => {})
          sendJson(res, 200, { scanned: 0, total: 0, status: 'scanning', scope, partial: true })
          return true
        }
        sendJson(res, 200, data || { scanned: 0, total: 0, updatedAt: null, scope, status: 'waiting', message: 'Screener data not yet available. Try again shortly.' })
        return true
      }

      if (url.pathname === '/api/market/snapshots') {
        const symbols = parseSymbolsParam(url.searchParams.get('symbols'))

        if (symbols.length === 0) {
          sendJson(res, 400, { error: { code: 'SYMBOLS_REQUIRED', message: 'Missing symbols.' } })
          return true
        }

        sendJson(
          res,
          200,
          await cached(
            `snapshots:${symbols.join(',')}`,
            ttl.snapshots,
            () => getSnapshots(symbols),
          ),
        )
        return true
      }

      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Unknown market API endpoint.' },
      })
      return true
    } catch (error) {
      sendError(res, error)
      return true
    }
  }
}
