import { readAlpacaConfig } from './env.mjs'

const timeframeConfig = {
  '1D': { timeframe: '5Min', lookbackMs: 24 * 60 * 60 * 1000, limit: 160 },
  '1W': { timeframe: '15Min', lookbackMs: 7 * 24 * 60 * 60 * 1000, limit: 260 },
  '1M': { timeframe: '1Hour', lookbackMs: 31 * 24 * 60 * 60 * 1000, limit: 260 },
  '6M': { timeframe: '1Day', lookbackMs: 183 * 24 * 60 * 60 * 1000, limit: 220 },
  '1Y': { timeframe: '1Day', lookbackMs: 366 * 24 * 60 * 60 * 1000, limit: 280 },
}

const trendingPeriodConfig = {
  day: { label: 'Best Day', lookbackDays: 3, cacheMs: 3 * 60 * 1000, source: 'Alpaca movers' },
  week: { label: 'Best Week', lookbackDays: 9, cacheMs: 20 * 60 * 1000, source: 'Daily bars' },
  month: { label: 'Best Month', lookbackDays: 40, cacheMs: 45 * 60 * 1000, source: 'Daily bars' },
}

const trendingUniverseSymbols = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'META',
  'GOOGL',
  'GOOG',
  'TSLA',
  'AVGO',
  'COST',
  'NFLX',
  'AMD',
  'CRM',
  'ADBE',
  'ORCL',
  'CSCO',
  'INTC',
  'QCOM',
  'TXN',
  'AMAT',
  'MU',
  'SMCI',
  'ARM',
  'PLTR',
  'PANW',
  'CRWD',
  'NOW',
  'SHOP',
  'UBER',
  'ABNB',
  'DASH',
  'SPOT',
  'SNOW',
  'NET',
  'DDOG',
  'JPM',
  'BAC',
  'WFC',
  'GS',
  'MS',
  'V',
  'MA',
  'AXP',
  'PYPL',
  'BRK.B',
  'UNH',
  'LLY',
  'JNJ',
  'MRK',
  'ABBV',
  'PFE',
  'TMO',
  'ISRG',
  'DHR',
  'WMT',
  'HD',
  'LOW',
  'MCD',
  'SBUX',
  'NKE',
  'LULU',
  'TGT',
  'CAVA',
  'CMG',
  'XOM',
  'CVX',
  'COP',
  'SLB',
  'OXY',
  'CAT',
  'DE',
  'GE',
  'HON',
  'BA',
  'LMT',
  'RTX',
  'NEE',
  'DUK',
  'SO',
  'LIN',
  'FCX',
  'NEM',
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'XLK',
  'XLF',
  'XLE',
  'XLV',
  'XLY',
  'ARKK',
]

const demoUnderlyingPrices = {
  AAPL: 195,
  MSFT: 430,
  NVDA: 125,
  AMZN: 185,
  META: 505,
  GOOGL: 172,
  GOOG: 174,
  TSLA: 245,
  AMD: 158,
  SPY: 535,
  QQQ: 465,
  IWM: 205,
  DIA: 390,
}

let assetCache = {
  cacheKey: '',
  assets: [],
  expiresAt: 0,
}

const trendingCache = new Map()

function roundPrice(value) {
  if (!Number.isFinite(value)) return 0
  if (value > 1000) return Math.round(value)
  return Math.round(value * 100) / 100
}

function getNumber(...values) {
  return values.find((value) => Number.isFinite(value)) ?? 0
}

function getOptionalNumber(...values) {
  for (const value of values) {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value
    if (Number.isFinite(number)) return number
  }
  return null
}

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function getSnapshotPrice(snapshot) {
  const tradePrice = snapshot.latestTrade?.p
  const quoteBid = snapshot.latestQuote?.bp
  const quoteAsk = snapshot.latestQuote?.ap
  const minuteClose = snapshot.minuteBar?.c
  const dailyClose = snapshot.dailyBar?.c

  if (Number.isFinite(tradePrice)) return tradePrice
  if (Number.isFinite(quoteBid) && Number.isFinite(quoteAsk)) {
    return (quoteBid + quoteAsk) / 2
  }
  return getNumber(minuteClose, dailyClose)
}

function newestTimestamp(snapshot) {
  const candidates = [
    snapshot.latestTrade?.t,
    snapshot.latestQuote?.t,
    snapshot.minuteBar?.t,
    snapshot.dailyBar?.t,
  ]
    .map((value) => (value ? Date.parse(value) : 0))
    .filter((value) => Number.isFinite(value) && value > 0)

  return candidates.length ? Math.max(...candidates) : Date.now()
}

function inferMarketStatus(timestamp) {
  const ageMinutes = (Date.now() - timestamp) / 60000
  if (ageMinutes <= 30) return 'open'
  return 'closed'
}

function normalizeBar(bar) {
  return {
    time: Math.floor(Date.parse(bar.t) / 1000),
    open: getNumber(bar.o),
    high: getNumber(bar.h),
    low: getNumber(bar.l),
    close: getNumber(bar.c),
    volume: getNumber(bar.v),
  }
}

function normalizeSnapshot(symbol, snapshot) {
  const price = getSnapshotPrice(snapshot)
  const previousClose = getNumber(snapshot.prevDailyBar?.c, snapshot.dailyBar?.o, price)
  const change = price - previousClose
  const timestamp = newestTimestamp(snapshot)

  return {
    symbol,
    price: roundPrice(price),
    previousClose: roundPrice(previousClose),
    change: roundPrice(change),
    changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
    bid: roundPrice(getNumber(snapshot.latestQuote?.bp, price)),
    ask: roundPrice(getNumber(snapshot.latestQuote?.ap, price)),
    volume: getNumber(snapshot.dailyBar?.v, snapshot.minuteBar?.v),
    updatedAt: timestamp,
    marketStatus: inferMarketStatus(timestamp),
    source: 'alpaca',
  }
}

function normalizeAsset(asset) {
  const assetClass = asset.asset_class ?? asset.class ?? ''
  const isCrypto = assetClass === 'crypto'

  return {
    symbol: asset.symbol,
    name: asset.name || asset.symbol,
    exchange: asset.exchange || 'Market',
    sector: assetClass === 'us_equity' ? 'US Equity' : assetClass || 'Stock',
    assetClass: isCrypto ? 'crypto' : 'equity',
  }
}

function normalizeTrendingPeriod(period) {
  return Object.hasOwn(trendingPeriodConfig, period) ? period : 'day'
}

function normalizeOptionType(type) {
  const value = String(type ?? '').trim().toLowerCase()
  if (value === 'call' || value === 'c') return 'call'
  if (value === 'put' || value === 'p') return 'put'
  return null
}

function parseOptionSymbol(contractSymbol) {
  const match = String(contractSymbol ?? '').match(/^(.+?)(\d{6})([CP])(\d{8})$/i)
  if (!match) return {}

  const [, underlying, rawDate, rawType, rawStrike] = match
  const year = `20${rawDate.slice(0, 2)}`
  const month = rawDate.slice(2, 4)
  const day = rawDate.slice(4, 6)
  return {
    underlying: underlying.toUpperCase(),
    expirationDate: `${year}-${month}-${day}`,
    type: rawType.toUpperCase() === 'C' ? 'call' : 'put',
    strike: Number(rawStrike) / 1000,
  }
}

function newestOptionTimestamp(snapshot) {
  const candidates = [
    snapshot?.latestTrade?.t,
    snapshot?.latestQuote?.t,
    snapshot?.minuteBar?.t,
    snapshot?.dailyBar?.t,
  ]
    .map((value) => (value ? Date.parse(value) : 0))
    .filter((value) => Number.isFinite(value) && value > 0)

  return candidates.length ? Math.max(...candidates) : Date.now()
}

function normalizeOptionContract(underlyingSymbol, contractSymbol, snapshot) {
  const parsed = parseOptionSymbol(contractSymbol)
  const contract = snapshot?.contract ?? snapshot?.optionContract ?? {}
  const latestQuote = snapshot?.latestQuote ?? {}
  const latestTrade = snapshot?.latestTrade ?? {}
  const greeks = snapshot?.greeks ?? snapshot?.latestGreeks ?? {}
  const type = normalizeOptionType(contract.type ?? snapshot?.type ?? parsed.type)
  const strike = getOptionalNumber(
    contract.strike_price,
    contract.strikePrice,
    snapshot?.strike_price,
    snapshot?.strikePrice,
    parsed.strike,
  )
  const bid = getOptionalNumber(
    latestQuote.bp,
    latestQuote.bid_price,
    latestQuote.bidPrice,
    snapshot?.bid,
  )
  const ask = getOptionalNumber(
    latestQuote.ap,
    latestQuote.ask_price,
    latestQuote.askPrice,
    snapshot?.ask,
  )
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null
  const expirationDate =
    contract.expiration_date ??
    contract.expirationDate ??
    snapshot?.expiration_date ??
    snapshot?.expirationDate ??
    parsed.expirationDate ??
    ''

  if (!type || strike === null || !expirationDate) return null

  return {
    symbol: String(contractSymbol).toUpperCase(),
    underlying: String(underlyingSymbol ?? parsed.underlying ?? '').toUpperCase(),
    type,
    strike: roundNumber(strike, 3),
    expirationDate,
    bid: roundNumber(bid, 2),
    ask: roundNumber(ask, 2),
    mid: roundNumber(mid, 2),
    last: roundNumber(getOptionalNumber(latestTrade.p, latestTrade.price, snapshot?.last), 2),
    volume: getOptionalNumber(snapshot?.dailyBar?.v, snapshot?.minuteBar?.v, snapshot?.volume),
    openInterest: getOptionalNumber(snapshot?.open_interest, snapshot?.openInterest),
    impliedVolatility: roundNumber(
      getOptionalNumber(
        snapshot?.implied_volatility,
        snapshot?.impliedVolatility,
        snapshot?.iv,
      ),
      4,
    ),
    delta: roundNumber(getOptionalNumber(greeks.delta), 4),
    gamma: roundNumber(getOptionalNumber(greeks.gamma), 4),
    theta: roundNumber(getOptionalNumber(greeks.theta), 4),
    vega: roundNumber(getOptionalNumber(greeks.vega), 4),
    rho: roundNumber(getOptionalNumber(greeks.rho), 4),
    updatedAt: newestOptionTimestamp(snapshot),
  }
}

function sortOptionContracts(left, right) {
  const expirationSort = left.expirationDate.localeCompare(right.expirationDate)
  if (expirationSort !== 0) return expirationSort
  const strikeSort = left.strike - right.strike
  if (strikeSort !== 0) return strikeSort
  return left.type.localeCompare(right.type)
}

function normalizeOptionChain(symbol, payload, { requestId, source, limit }) {
  const snapshots = payload?.snapshots ?? payload ?? {}
  const entries = Array.isArray(snapshots)
    ? snapshots.map((item) => [item?.symbol, item])
    : Object.entries(snapshots)

  const contracts = entries
    .map(([contractSymbol, snapshot]) => normalizeOptionContract(symbol, contractSymbol, snapshot))
    .filter(Boolean)
    .sort(sortOptionContracts)
    .slice(0, limit)

  return {
    symbol,
    source,
    updatedAt: Date.now(),
    expirations: Array.from(new Set(contracts.map((contract) => contract.expirationDate))),
    contracts,
    requestId,
    nextPageToken: payload?.next_page_token ?? payload?.nextPageToken ?? null,
  }
}

function getDemoUnderlyingPrice(symbol) {
  const hinted = demoUnderlyingPrices[symbol]
  if (hinted) return hinted

  const seed = [...symbol].reduce((total, char) => total + char.charCodeAt(0), 0)
  return roundPrice(35 + (seed % 240) + symbol.length * 3.5)
}

function nextFridayAfter(daysFromNow) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  while (date.getUTCDay() !== 5) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return date.toISOString().slice(0, 10)
}

function buildDemoOptionSymbol(symbol, expirationDate, type, strike) {
  const datePart = expirationDate.slice(2).replaceAll('-', '')
  const typePart = type === 'call' ? 'C' : 'P'
  const strikePart = String(Math.round(strike * 1000)).padStart(8, '0')
  return `${symbol}${datePart}${typePart}${strikePart}`
}

function buildDemoOptionContract(symbol, expirationDate, type, strike, underlyingPrice, index) {
  const expirationTime = Date.parse(`${expirationDate}T20:00:00.000Z`)
  const dte = Math.max(1, Math.ceil((expirationTime - Date.now()) / (24 * 60 * 60 * 1000)))
  const isCall = type === 'call'
  const intrinsic = isCall
    ? Math.max(underlyingPrice - strike, 0)
    : Math.max(strike - underlyingPrice, 0)
  const moneyness = Math.max(-0.35, Math.min(0.35, (underlyingPrice - strike) / underlyingPrice))
  const extrinsic = Math.max(
    0.25,
    underlyingPrice * (0.013 + Math.sqrt(dte / 365) * 0.055) * (1 + Math.abs(moneyness) * 1.4),
  )
  const mid = roundPrice(intrinsic + extrinsic + index * 0.02)
  const bid = Math.max(0.01, roundPrice(mid * 0.96))
  const ask = roundPrice(mid * 1.04 + 0.02)
  const callDelta = Math.max(0.05, Math.min(0.95, 0.5 + moneyness * 3.2))
  const delta = isCall ? callDelta : callDelta - 1

  return {
    symbol: buildDemoOptionSymbol(symbol, expirationDate, type, strike),
    underlying: symbol,
    type,
    strike,
    expirationDate,
    bid,
    ask,
    mid: roundPrice((bid + ask) / 2),
    last: mid,
    volume: 120 + index * 34,
    openInterest: 480 + index * 97,
    impliedVolatility: roundNumber(0.22 + dte / 900 + Math.abs(moneyness) * 0.35, 4),
    delta: roundNumber(delta, 4),
    gamma: roundNumber(Math.max(0.004, 0.035 - Math.abs(moneyness) * 0.04), 4),
    theta: roundNumber(-(0.012 + mid / 180 + dte / 9000), 4),
    vega: roundNumber(0.04 + Math.sqrt(dte) / 95, 4),
    rho: roundNumber(isCall ? 0.01 + dte / 2500 : -(0.01 + dte / 3000), 4),
    updatedAt: Date.now(),
  }
}

function demoOptionChain(symbol, options = {}) {
  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase()
  const underlyingPrice = getDemoUnderlyingPrice(normalizedSymbol)
  const expirations = Array.from(new Set([
    nextFridayAfter(7),
    nextFridayAfter(14),
    nextFridayAfter(30),
    nextFridayAfter(60),
  ]))
  const strikeStep = underlyingPrice >= 300 ? 10 : underlyingPrice >= 90 ? 5 : 2.5
  const centerStrike = Math.round(underlyingPrice / strikeStep) * strikeStep
  const strikeOffsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const requestedType = normalizeOptionType(options.type)
  const requestedExpiration = options.expirationDate
  const limit = options.limit ?? 80
  const contracts = []

  for (const expirationDate of expirations) {
    if (requestedExpiration && expirationDate !== requestedExpiration) continue
    for (const offset of strikeOffsets) {
      const strike = roundNumber(centerStrike + offset * strikeStep, 3)
      for (const type of ['call', 'put']) {
        if (requestedType && requestedType !== type) continue
        contracts.push(
          buildDemoOptionContract(
            normalizedSymbol,
            expirationDate,
            type,
            strike,
            underlyingPrice,
            contracts.length,
          ),
        )
      }
    }
  }

  const selectedContracts = contracts
    .sort(sortOptionContracts)
    .slice(0, limit)

  return {
    symbol: normalizedSymbol,
    source: 'Demo fallback - live options unavailable',
    updatedAt: Date.now(),
    expirations: Array.from(new Set(selectedContracts.map((contract) => contract.expirationDate))),
    contracts: selectedContracts,
    requestId: null,
    nextPageToken: null,
  }
}

function fallbackAsset(symbol, assetMap = new Map()) {
  const asset = assetMap.get(symbol)
  if (asset) return normalizeAsset(asset)

  return {
    symbol,
    name: `${symbol} ticker`,
    exchange: 'Market',
    sector: 'US Equity',
    assetClass: 'equity',
  }
}

function buildAssetMap(assets) {
  return new Map(
    assets
      .filter((asset) => asset?.symbol)
      .map((asset) => [String(asset.symbol).toUpperCase(), asset]),
  )
}

async function getAssetMap(config) {
  try {
    return buildAssetMap(await getBrokerAssets(config))
  } catch {
    return new Map()
  }
}

function normalizeMover(item, rank, assetMap) {
  const symbol = String(item?.symbol ?? '').toUpperCase()
  if (!symbol) return null

  const record = fallbackAsset(symbol, assetMap)
  const price = roundPrice(getNumber(item.price, item.close, item.last_price))
  const change = roundPrice(getNumber(item.change, item.price_change))
  const changePercent = getNumber(item.percent_change, item.percentChange, item.change_percent)

  return {
    ...record,
    rank,
    price,
    change,
    changePercent,
    volume: getNumber(item.volume),
    source: 'alpaca_movers',
  }
}

function calculateTrendItem(symbol, symbolBars, rank, assetMap) {
  const bars = (Array.isArray(symbolBars) ? symbolBars : [])
    .map(normalizeBar)
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.time - right.time)

  if (bars.length < 2) return null

  const first = bars[0]
  const last = bars[bars.length - 1]
  const baseline = first.open || first.close
  if (!Number.isFinite(baseline) || baseline <= 0) return null

  const change = last.close - baseline
  const changePercent = (change / baseline) * 100
  const record = fallbackAsset(symbol, assetMap)

  return {
    ...record,
    rank,
    price: roundPrice(last.close),
    change: roundPrice(change),
    changePercent,
    volume: bars.reduce((total, bar) => total + bar.volume, 0),
    source: 'daily_bars',
  }
}

function demoTrending(period) {
  const periodConfig = trendingPeriodConfig[period]
  const periodMultiplier = period === 'month' ? 2.2 : period === 'week' ? 1.45 : 1
  const items = trendingUniverseSymbols.slice(0, 28).map((symbol, index) => {
    const seed = [...symbol].reduce((total, char) => total + char.charCodeAt(0), 0)
    const price = roundPrice(35 + (seed % 420) + index * 1.7)
    const changePercent = 1.4 + ((seed * 7 + index * 13) % 1250) / 100 * periodMultiplier
    const change = price * (changePercent / 100)
    return {
      ...fallbackAsset(symbol),
      rank: index + 1,
      price,
      change: roundPrice(change),
      changePercent,
      volume: 1_200_000 + seed * 610,
      source: 'demo',
    }
  })

  return {
    period,
    label: periodConfig.label,
    source: 'Demo fallback - live data unavailable',
    updatedAt: Date.now(),
    items: items.sort((left, right) => right.changePercent - left.changePercent).slice(0, 12)
      .map((item, index) => ({ ...item, rank: index + 1 })),
  }
}

async function getMoverTrending(period, config) {
  const { payload } = await requestAlpaca('/v1beta1/screener/stocks/movers', { top: 12 })
  const assetMap = await getAssetMap(config)
  const gainers = (payload?.gainers ?? [])
    .map((item, index) => normalizeMover(item, index + 1, assetMap))
    .filter(Boolean)
    .slice(0, 12)
    .map((item, index) => ({ ...item, rank: index + 1 }))

  return {
    period,
    label: trendingPeriodConfig[period].label,
    source: 'Alpaca market movers',
    updatedAt: payload?.last_updated ? Date.parse(payload.last_updated) : Date.now(),
    items: gainers,
  }
}

async function getHistoricalTrending(period, config) {
  const selected = trendingPeriodConfig[period]
  const end = new Date(Date.now() - config.endDelayMinutes * 60 * 1000)
  const start = new Date(end.getTime() - selected.lookbackDays * 24 * 60 * 60 * 1000)
  const assetMap = await getAssetMap(config)
  const symbols = Array.from(new Set(trendingUniverseSymbols))
  const batchSize = 45
  const items = []

  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize)
    const { payload } = await requestAlpaca('/v2/stocks/bars', {
      symbols: batch.join(','),
      timeframe: '1Day',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(selected.lookbackDays + 6),
      adjustment: 'split',
      feed: config.feed,
      sort: 'asc',
    })

    const barsBySymbol = payload?.bars ?? {}
    for (const symbol of batch) {
      const item = calculateTrendItem(symbol, barsBySymbol[symbol], items.length + 1, assetMap)
      if (item && item.changePercent > 0) items.push(item)
    }
  }

  return {
    period,
    label: selected.label,
    source: `${selected.source} liquid universe`,
    updatedAt: Date.now(),
    items: items
      .sort((left, right) => right.changePercent - left.changePercent)
      .slice(0, 12)
      .map((item, index) => ({ ...item, rank: index + 1 })),
  }
}

async function getBrokerAssets(config) {
  const cacheKey = `${config.brokerBaseUrl}:${config.keyId}`
  if (
    assetCache.cacheKey === cacheKey &&
    assetCache.assets.length > 0 &&
    assetCache.expiresAt > Date.now()
  ) {
    return assetCache.assets
  }

  let assets = null

  const tryBrokerApi = async () => {
    const response = await fetch(`${config.brokerBaseUrl}/v1/assets?status=active`, {
      headers: {
        accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.secretKey}`).toString('base64')}`,
      },
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    if (!Array.isArray(payload)) return null
    return payload
  }

  const tryTradingApi = async () => {
    const url = new URL('/v2/assets?status=active', config.tradingBaseUrl)
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'APCA-API-KEY-ID': config.keyId,
        'APCA-API-SECRET-KEY': config.secretKey,
      },
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    if (!Array.isArray(payload)) return null
    return payload
  }

  assets = await tryBrokerApi() || await tryTradingApi()

  if (!assets) {
    const error = new Error('Alpaca asset search failed. Verify API credentials and try again.')
    error.status = 503
    error.code = 'ALPACA_ASSETS_UNAVAILABLE'
    throw error
  }

  assetCache = {
    cacheKey,
    assets,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }

  return assetCache.assets
}

function ensureConfigured(config) {
  if (!config.configured) {
    const error = new Error('Alpaca API credentials are not configured.')
    error.status = 503
    error.code = 'ALPACA_NOT_CONFIGURED'
    throw error
  }
}

async function requestAlpaca(path, params = {}) {
  const config = readAlpacaConfig()
  ensureConfigured(config)

  const url = new URL(path, config.baseUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': config.keyId,
      'APCA-API-SECRET-KEY': config.secretKey,
    },
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  let payload = null

  if (text && contentType.includes('application/json')) {
    payload = JSON.parse(text)
  } else if (text) {
    payload = {
      message: `Alpaca returned a non-JSON response from ${url.hostname}.`,
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error ??
      `Alpaca request failed with HTTP ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.code = payload?.code ?? 'ALPACA_REQUEST_FAILED'
    error.requestId = requestId
    throw error
  }

  if (text && !contentType.includes('application/json')) {
    const error = new Error(payload.message)
    error.status = 502
    error.code = 'ALPACA_NON_JSON_RESPONSE'
    error.requestId = requestId
    throw error
  }

  return { payload, requestId }
}

export { requestAlpaca, readAlpacaConfig, getBrokerAssets }

export function getAlpacaStatus() {
  const config = readAlpacaConfig()
  return {
    configured: config.configured,
    provider: config.configured ? 'alpaca' : 'demo',
    feed: config.feed,
    optionsFeed: config.optionsFeed,
    authMode: config.authMode,
    endDelayMinutes: config.endDelayMinutes,
    baseUrl: config.baseUrl,
  }
}

export function getAlpacaDebug() {
  const config = readAlpacaConfig()
  const keyPreview = config.keyId ? config.keyId.substring(0, 6) + '...' : '(empty)'
  const secretPreview = config.secretKey ? config.secretKey.substring(0, 3) + '...' : '(empty)'
  return {
    configured: config.configured,
    keyPreview,
    secretPreview,
    feed: config.feed,
    optionsFeed: config.optionsFeed,
    baseUrl: config.baseUrl,
    tradingBaseUrl: config.tradingBaseUrl,
    authMode: config.authMode,
    endDelayMinutes: config.endDelayMinutes,
  }
}

export async function getBars(symbol, timeframe) {
  const config = readAlpacaConfig()
  const selected = timeframeConfig[timeframe] ?? timeframeConfig['1D']
  const end = new Date(Date.now() - config.endDelayMinutes * 60 * 1000)
  const start = new Date(end.getTime() - selected.lookbackMs)

  const { payload, requestId } = await requestAlpaca(`/v2/stocks/${symbol}/bars`, {
    timeframe: selected.timeframe,
    start: start.toISOString(),
    end: end.toISOString(),
    limit: selected.limit,
    adjustment: 'split',
    feed: config.feed,
    sort: 'asc',
  })

  return {
    bars: (payload?.bars ?? []).map(normalizeBar),
    requestId,
  }
}

export async function getSnapshot(symbol) {
  const config = readAlpacaConfig()
  const { payload, requestId } = await requestAlpaca(
    `/v2/stocks/${symbol}/snapshot`,
    { feed: config.feed },
  )

  return {
    snapshot: normalizeSnapshot(symbol, payload),
    requestId,
  }
}

export async function getSnapshots(symbols) {
  const config = readAlpacaConfig()
  const requestedSymbols = symbols.filter(Boolean)

  const { payload, requestId } = await requestAlpaca('/v2/stocks/snapshots', {
    symbols: requestedSymbols.join(','),
    feed: config.feed,
  })

  const rawSnapshots = payload?.snapshots ?? payload ?? {}
  const snapshots = Object.fromEntries(
    requestedSymbols
      .filter((symbol) => rawSnapshots[symbol])
      .map((symbol) => [symbol, normalizeSnapshot(symbol, rawSnapshots[symbol])]),
  )

  return { snapshots, requestId }
}

export async function getMarketClock() {
  const config = readAlpacaConfig()
  ensureConfigured(config)

  const url = new URL('/v1/clock', config.tradingBaseUrl)
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': config.keyId,
      'APCA-API-SECRET-KEY': config.secretKey,
    },
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(
      payload?.message ?? payload?.error ?? `Alpaca clock request failed with HTTP ${response.status}`,
    )
    error.status = response.status
    error.code = payload?.code ?? 'ALPACA_CLOCK_REQUEST_FAILED'
    throw error
  }

  return {
    isOpen: payload?.is_open ?? false,
    timestamp: payload?.timestamp ?? null,
    nextOpen: payload?.next_open ?? null,
    nextClose: payload?.next_close ?? null,
  }
}

export async function getSparklines(symbols) {
  const config = readAlpacaConfig()
  ensureConfigured(config)
  if (symbols.length === 0) return { sparklines: {} }

  const end = new Date(Date.now() - config.endDelayMinutes * 60 * 1000)
  const start = new Date(end.getTime() - 10 * 24 * 60 * 60 * 1000)

  const url = new URL('/v2/stocks/bars', config.baseUrl)
  url.searchParams.set('symbols', symbols.join(','))
  url.searchParams.set('timeframe', '1Day')
  url.searchParams.set('start', start.toISOString())
  url.searchParams.set('end', end.toISOString())
  url.searchParams.set('limit', '8')
  url.searchParams.set('adjustment', 'split')
  url.searchParams.set('feed', config.feed)
  url.searchParams.set('sort', 'asc')

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': config.keyId,
      'APCA-API-SECRET-KEY': config.secretKey,
    },
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(
      payload?.message ?? payload?.error ?? `Alpaca sparklines request failed with HTTP ${response.status}`,
    )
    error.status = response.status
    error.code = payload?.code ?? 'ALPACA_SPARKLINES_REQUEST_FAILED'
    throw error
  }

  const bars = payload?.bars ?? {}
  const sparklines = {}
  for (const [symbol, symbolBars] of Object.entries(bars)) {
    sparklines[symbol] = symbolBars.map((bar) => ({
      t: bar.t,
      c: bar.c,
    }))
  }

  return { sparklines }
}

export async function getNews(symbol) {
  const config = readAlpacaConfig()
  ensureConfigured(config)

  const url = new URL('/v1beta1/news', config.baseUrl)
  url.searchParams.set('symbols', symbol)
  url.searchParams.set('limit', '25')
  url.searchParams.set('include_content', 'false')

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': config.keyId,
      'APCA-API-SECRET-KEY': config.secretKey,
    },
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(
      payload?.message ?? payload?.error ?? `Alpaca news request failed with HTTP ${response.status}`,
    )
    error.status = response.status
    error.code = payload?.code ?? 'ALPACA_NEWS_REQUEST_FAILED'
    throw error
  }

  return {
    news: (payload?.news ?? []).map((item) => ({
      id: item.id,
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      createdAt: item.created_at,
      symbols: item.symbols ?? [],
      images: (item.images ?? []).map((img) => ({ url: img.url, size: img.size })),
    })),
  }
}

export async function getTrending(periodInput) {
  const period = normalizeTrendingPeriod(periodInput)
  const periodConfig = trendingPeriodConfig[period]
  const config = readAlpacaConfig()
  const cacheKey = `${config.baseUrl}:${config.feed}:${config.keyId}:${period}`
  const cached = trendingCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.payload

  let payload
  if (!config.configured) {
    payload = demoTrending(period)
  } else {
    try {
      payload = period === 'day'
        ? await getMoverTrending(period, config).catch(() => getHistoricalTrending(period, config))
        : await getHistoricalTrending(period, config)
    } catch (error) {
      console.warn('Trending live data unavailable; using demo fallback.', error?.message ?? error)
      payload = {
        ...demoTrending(period),
      }
    }
  }

  trendingCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + periodConfig.cacheMs,
  })

  return payload
}

export async function getOptionChain(symbolInput, options = {}) {
  const symbol = String(symbolInput ?? '').trim().toUpperCase()
  const config = readAlpacaConfig()
  const limit = Math.min(120, Math.max(1, Number(options.limit) || 80))
  const type = normalizeOptionType(options.type)
  const expirationDate = options.expirationDate

  if (!config.configured) {
    return demoOptionChain(symbol, { ...options, limit, type, expirationDate })
  }

  try {
    const { payload, requestId } = await requestAlpaca(
      `/v1beta1/options/snapshots/${encodeURIComponent(symbol)}`,
      {
        feed: config.optionsFeed,
        limit,
        type,
        expiration_date: expirationDate,
        updated_since: options.updatedSince,
      },
    )

    return normalizeOptionChain(symbol, payload, {
      requestId,
      limit,
      source: `Alpaca options ${config.optionsFeed}`,
    })
  } catch (error) {
    console.warn('Options live data unavailable; using demo fallback.', error?.message ?? error)
    return {
      ...demoOptionChain(symbol, { ...options, limit, type, expirationDate }),
      fallbackReason: error?.message ?? 'Live options chain unavailable',
    }
  }
}

export async function getBatchDailyBars(symbols, lookbackDays = 400) {
  const config = readAlpacaConfig()
  const end = new Date(Date.now() - config.endDelayMinutes * 60 * 1000)
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  const batchSize = 45
  const allBars = {}

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize)
    const { payload } = await requestAlpaca('/v2/stocks/bars', {
      symbols: batch.join(','),
      timeframe: '1Day',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(lookbackDays + 6),
      adjustment: 'split',
      feed: config.feed,
      sort: 'asc',
    })
    for (const [sym, bars] of Object.entries(payload?.bars ?? {})) {
      allBars[sym] = bars.map(normalizeBar)
    }
  }

  return allBars
}

export async function searchAssets(query, limit = 12) {
  const config = readAlpacaConfig()
  ensureConfigured(config)

  const term = query.trim().toUpperCase()
  if (!term) return { symbols: [] }

  const assets = await getBrokerAssets(config)
  const matches = assets
    .filter((asset) => {
      if (!asset?.symbol) return false
      const haystack = `${asset.symbol} ${asset.name ?? ''} ${asset.exchange ?? ''}`.toUpperCase()
      return haystack.includes(term)
    })
    .sort((first, second) => {
      const firstSymbol = first.symbol.toUpperCase()
      const secondSymbol = second.symbol.toUpperCase()
      if (firstSymbol === term) return -1
      if (secondSymbol === term) return 1
      if (firstSymbol.startsWith(term) && !secondSymbol.startsWith(term)) return -1
      if (!firstSymbol.startsWith(term) && secondSymbol.startsWith(term)) return 1
      return firstSymbol.localeCompare(secondSymbol)
    })
    .slice(0, limit)
    .map(normalizeAsset)

  return { symbols: matches }
}
