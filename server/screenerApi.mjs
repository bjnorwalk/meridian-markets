import { securityHeaders } from './httpSecurity.mjs'
import { getScreenerResults, getScreenerScanState, runScreener } from './screener.mjs'
import { searchFundamentals, getSectors, getIndustries, fetchFundamentals, upsertFundamentals } from './fundamentalsStore.mjs'

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(res.req),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function apiError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

const VALID_SORT_KEYS = ['marketCap', 'peRatio', 'forwardPe', 'avgVolume', 'divYield', 'beta', 'shortFloatPct', 'institutionPct', 'epsGrowth', 'revenueGrowth', 'change', 'volume', 'price', 'volumeSpike', 'rsi', 'totalReturn']
const VALID_SORT_DIRS = ['asc', 'desc']

function parseNumericParam(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function buildSearchQuery(filter) {
  const sectors = filter.sectors && filter.sectors.length > 0 ? filter.sectors : null
  const industries = filter.industries && filter.industries.length > 0 ? filter.industries : null
  const marketCapMin = parseNumericParam(filter.marketCapMin)
  const marketCapMax = parseNumericParam(filter.marketCapMax)
  const peMin = parseNumericParam(filter.peMin)
  const peMax = parseNumericParam(filter.peMax)
  const avgVolumeMin = parseNumericParam(filter.avgVolumeMin)
  const avgVolumeMax = parseNumericParam(filter.avgVolumeMax)
  const divYieldMin = parseNumericParam(filter.divYieldMin)
  const divYieldMax = parseNumericParam(filter.divYieldMax)
  const betaMin = parseNumericParam(filter.betaMin)
  const betaMax = parseNumericParam(filter.betaMax)
  const shortFloatPctMin = parseNumericParam(filter.shortFloatPctMin)
  const shortFloatPctMax = parseNumericParam(filter.shortFloatPctMax)
  const institutionPctMin = parseNumericParam(filter.institutionPctMin)
  const institutionPctMax = parseNumericParam(filter.institutionPctMax)
  const nameQuery = filter.nameQuery ?? null

  return { sectors, industries, marketCapMin, marketCapMax, peMin, peMax, avgVolumeMin, avgVolumeMax, divYieldMin, divYieldMax, betaMin, betaMax, shortFloatPctMin, shortFloatPctMax, institutionPctMin, institutionPctMax, nameQuery }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function loadTechnicalMap(scope, userId) {
  const screenerData = getScreenerResults(scope, userId)
  const state = getScreenerScanState(scope, userId)
  if (!screenerData && (!state || state.status !== 'scanning')) {
    runScreener(scope, userId).catch(() => {})
  }
  if (!screenerData) return {}
  const map = {}
  for (const key of ['gainers', 'losers', 'mostActive', 'oversold', 'overbought', 'goldenCrosses', 'deathCrosses', 'volumeSpikes', 'nearHigh52', 'nearLow52']) {
    const items = screenerData[key] || []
    for (const item of items) {
      map[item.symbol] = item
    }
  }
  return map
}

export function createScreenerApiMiddleware() {
  return async function screenerApiMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/screener')) {
      next?.()
      return false
    }

    try {
      res.req = req
      const url = new URL(req.url, 'http://localhost')

      if (url.pathname === '/api/screener/sectors') {
        sendJson(res, 200, getSectors())
        return true
      }

      if (url.pathname === '/api/screener/industries') {
        sendJson(res, 200, getIndustries())
        return true
      }

      if (url.pathname === '/api/screener/search') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } })
          return true
        }

        const body = await readBody(req)
        const filter = JSON.parse(body || '{}')

        const sortKey = VALID_SORT_KEYS.includes(filter.sortKey) ? filter.sortKey : 'marketCap'
        const sortDir = VALID_SORT_DIRS.includes(filter.sortDir) ? filter.sortDir : 'desc'
        const limit = Math.min(Math.max(parseInt(filter.limit) || 100, 1), 500)
        const offset = Math.max(parseInt(filter.offset) || 0, 0)
        const scope = filter.scope || 'sp500'
        const userId = filter.userId || null

        const technicalMap = loadTechnicalMap(scope, userId)
        const query = buildSearchQuery(filter)
        const fundamentalRows = searchFundamentals(query)

        const merged = fundamentalRows.map(f => ({
          symbol: f.symbol,
          name: f.name,
          sector: f.sector,
          industry: f.industry,
          marketCap: f.marketCap,
          avgVolume: f.avgVolume,
          peRatio: f.peRatio,
          forwardPe: f.forwardPe,
          epsGrowth: f.epsGrowth,
          revenueGrowth: f.revenueGrowth,
          divYield: f.divYield,
          beta: f.beta,
          shortFloatPct: f.shortFloatPct,
          institutionPct: f.institutionPct,
          ...(technicalMap[f.symbol] || {}),
        }))

        const sorted = [...merged].sort((a, b) => {
          const aVal = a[sortKey] ?? (sortKey === 'marketCap' ? 0 : null)
          const bVal = b[sortKey] ?? (sortKey === 'marketCap' ? 0 : null)
          if (aVal === null && bVal === null) return 0
          if (aVal === null) return 1
          if (bVal === null) return -1
          return sortDir === 'desc' ? bVal - aVal : aVal - bVal
        })

        const total = sorted.length
        const page = sorted.slice(offset, offset + limit)

        sendJson(res, 200, {
          total,
          offset,
          limit,
          results: page,
          sectors: getSectors(),
          industries: getIndustries(),
        })
        return true
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown screener API endpoint.' } })
      return true
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: { code: error.code || 'SCREENER_API_ERROR', message: error.message },
      })
      return true
    }
  }
}

export { VALID_SORT_KEYS, VALID_SORT_DIRS }
