import { getBatchDailyBars, getSnapshots, getSparklines, requestAlpaca, readAlpacaConfig } from './alpacaClient.mjs'

const BATCH_SIZE = 100
const BATCH_DELAY_MS = 800
const SCAN_TTL_MS = 15 * 60 * 1000

const SP500 = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','TSLA','AVGO','COST',
  'NFLX','AMD','CRM','ADBE','ORCL','CSCO','INTC','QCOM','TXN','AMAT',
  'MU','SMCI','ARM','PLTR','PANW','CRWD','NOW','SHOP','UBER','ABNB',
  'DASH','SPOT','SNOW','NET','DDOG','JPM','BAC','WFC','GS','MS',
  'V','MA','AXP','PYPL','BRK.B','UNH','LLY','JNJ','MRK','ABBV',
  'PFE','TMO','ISRG','DHR','WMT','HD','LOW','MCD','SBUX','NKE',
  'LULU','TGT','CAVA','CMG','XOM','CVX','COP','SLB','OXY','CAT',
  'DE','GE','HON','BA','LMT','RTX','NEE','DUK','SO','LIN',
  'FCX','NEM',
]

const NDX100 = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','TSLA','AVGO','COST',
  'NFLX','AMD','CRM','ADBE','ORCL','CSCO','INTC','QCOM','TXN','AMAT',
  'MU','SMCI','ARM','PLTR','PANW','CRWD','NOW','SHOP','UBER','ABNB',
  'DASH','SPOT','SNOW','NET','DDOG','ASML','ADI','ANSS','APP','AZN',
  'BKR','CDNS','CHTR','CMCSA','CPRT','CSGP','CTAS','CTSH','DXCM','ENPH',
  'FAST','FTNT','GEHC','GFS','GILD','HON','IDXX','ILMN','ISRG',
  'KDP','KLAC','LIN','LRCX','LULU','MAR','MCHP','MDLZ','MELI',
  'MRNA','MRVL','MSTR','NTES','ODFL','ON','ORLY','PANW','PAYX','PCAR',
  'PEP','QCOM','REGN','ROST','SNPS','SSNC','TMUS','TTD',
  'TTWO','VRSK','VRTX','WBD','WDAY','XEL','ZM','ZS',
]

const ETFs = [
  'SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','XLY','ARKK',
  'TLT','IEF','GLD','SLV','USO','UNG','EWZ','FXI','EEM',
  'VTI','VOO','IJR','VB','VNQ','XLU','XLI','XLB','XLRE','XLC','XLP',
  'SMH','IBB','KRE','KBE','JETS','LABU','TQQQ','SQQQ','SOXS','SOXL',
]

const STATIC_UNIVERSES = {
  'sp500': SP500,
  'nasdaq100': NDX100,
  'etfs': ETFs,
}

const screenerCache = {
  results: {},
  running: new Set(),
  scans: {},
  expiresAt: 0,
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  const deltas = []
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) avgGain += deltas[i]
    else avgLoss += Math.abs(deltas[i])
  }
  avgGain /= period; avgLoss /= period
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0
    const loss = deltas[i] < 0 ? Math.abs(deltas[i]) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  return 100 - (100 / (1 + avgGain / avgLoss))
}

function computeSMA(closes, period) {
  if (closes.length < period) return null
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period
}

function computeAvgVolume(bars, period = 20) {
  const recent = bars.slice(-period)
  if (recent.length < period) return null
  return recent.reduce((sum, b) => sum + b.volume, 0) / period
}

function find52WeekHighLow(bars) {
  const highs = bars.map(b => b.high).filter(h => Number.isFinite(h))
  const lows = bars.map(b => b.low).filter(l => Number.isFinite(l))
  if (!highs.length || !lows.length) return { high52: null, low52: null }
  return { high52: Math.max(...highs), low52: Math.min(...lows) }
}

function detectCrossovers(closes, fastPeriod, slowPeriod) {
  if (closes.length < slowPeriod + 1) return null
  const prevFast = computeSMA(closes.slice(0, -1), fastPeriod)
  const currFast = computeSMA(closes, fastPeriod)
  const prevSlow = computeSMA(closes.slice(0, -1), slowPeriod)
  const currSlow = computeSMA(closes, slowPeriod)
  if (prevFast === null || currFast === null || prevSlow === null || currSlow === null) return null
  if (prevFast <= prevSlow && currFast > currSlow) return 'golden_cross'
  if (prevFast >= prevSlow && currFast < currSlow) return 'death_cross'
  return null
}

function countConsecutive(closes, direction) {
  let count = 0
  for (let i = closes.length - 1; i > 0; i--) {
    if (direction === 'up' && closes[i] > closes[i - 1]) count++
    else if (direction === 'down' && closes[i] < closes[i - 1]) count++
    else break
  }
  return count
}

function detectCandlestickPattern(bars) {
  if (bars.length < 3) return null
  const prev1 = bars[bars.length - 2]
  const curr = bars[bars.length - 1]
  if (!prev1 || !curr) return null

  const body = Math.abs(curr.close - curr.open)
  const upperShadow = curr.high - Math.max(curr.close, curr.open)
  const lowerShadow = Math.min(curr.close, curr.open) - curr.low
  const prevBody = Math.abs(prev1.close - prev1.open)

  if (body > 0 && lowerShadow > body * 2 && upperShadow < body * 0.3) return { type: 'hammer', label: 'Hammer' }
  if (body > 0 && upperShadow > body * 2 && lowerShadow < body * 0.3) return { type: 'shooting_star', label: 'Shooting Star' }
  if (body < prevBody * 0.1 && body > 0) return { type: 'doji', label: 'Doji' }
  if (prevBody > 0 && body > prevBody * 1.5 && curr.close > curr.open && prev1.close < prev1.open && curr.close > prev1.open) return { type: 'bullish_engulfing', label: 'Bullish Engulfing' }
  if (prevBody > 0 && body > prevBody * 1.5 && curr.close < curr.open && prev1.close > prev1.open && curr.close < prev1.open) return { type: 'bearish_engulfing', label: 'Bearish Engulfing' }
  return null
}

function getLastCloseFromBars(bars) {
  if (!bars || bars.length === 0) return null
  const last = bars[bars.length - 1]
  return last?.close ?? null
}

function screenSymbol(symbol, bars, snapshot) {
  if (!snapshot) return null

  const price = snapshot.price
  const change = snapshot.changePercent ?? 0
  const volume = snapshot.volume ?? 0

  // Augment bars with a virtual bar from the snapshot if it's newer
  let augmented = bars
  if (bars && bars.length > 0) {
    const lastBar = bars[bars.length - 1]
    const latestTs = snapshot.updatedAt
    if (latestTs && lastBar.time && (latestTs / 1000) > lastBar.time + 86400) {
      // Snapshot timestamp > last bar's timestamp + 1 day — append virtual bar
      augmented = [...bars, {
        time: Math.floor(latestTs / 1000),
        open: lastBar.close,
        high: Math.max(price, lastBar.high, lastBar.close),
        low: Math.min(price, lastBar.low, lastBar.close),
        close: price,
        volume: volume,
      }]
    } else if (latestTs && lastBar.time && (latestTs / 1000) > lastBar.time) {
      // Snapshot is same-day but later — update last bar's close/volume in-place
      augmented = [...bars.slice(0, -1), {
        ...lastBar,
        high: Math.max(price, lastBar.high),
        low: Math.min(price, lastBar.low),
        close: price,
        volume: volume > 0 ? volume : lastBar.volume,
      }]
    }
  }

  if (!augmented || augmented.length < 5) {
    return {
      symbol, price, change, volume,
      rsi: null, sma20: null, sma50: null, sma200: null,
      volumeSpike: null, gapPct: null,
      pctOffHigh52: null, pctOffLow52: null,
      pctAboveSma20: null, pctAboveSma50: null, pctAboveSma200: null,
      streakUp: 0, streakDown: 0, crossover: null,
      signals: Math.abs(change) > 3 ? [{ type: 'big_mover', label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` }] : [],
      totalReturn: Math.round(change * 10) / 10,
      weekReturn: Math.round(change * 10) / 10,
      recentCloses: [],
    }
  }

  // Use snapshot previousClose for gap, fallback to first augmented bar close
  const barsPrevClose = augmented.length > 0 ? augmented[augmented.length - 1]?.close ?? price : price
  const prevClose = snapshot.previousClose && snapshot.previousClose > 0
    ? snapshot.previousClose
    : barsPrevClose

  const closes = augmented.map(b => b.close).filter(c => Number.isFinite(c) && c > 0)
  if (closes.length < 5) {
    return {
      symbol, price, change, volume,
      rsi: null, sma20: null, sma50: null, sma200: null,
      volumeSpike: null, gapPct: null,
      pctOffHigh52: null, pctOffLow52: null,
      pctAboveSma20: null, pctAboveSma50: null, pctAboveSma200: null,
      streakUp: 0, streakDown: 0, crossover: null,
      signals: Math.abs(change) > 3 ? [{ type: 'big_mover', label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` }] : [],
      totalReturn: Math.round(change * 10) / 10,
      weekReturn: Math.round(change * 10) / 10,
      recentCloses: closes,
    }
  }

  const rsi = computeRSI(closes)
  const sma20 = computeSMA(closes, 20)
  const sma50 = computeSMA(closes, 50)
  const sma200 = computeSMA(closes, 200)
  const avgVol20 = computeAvgVolume(augmented, 20)
  const { high52, low52 } = find52WeekHighLow(augmented)
  const crossover = detectCrossovers(closes, 50, 200)
  const streakUp = countConsecutive(closes, 'up')
  const streakDown = countConsecutive(closes, 'down')
  const pattern = detectCandlestickPattern(augmented)

  const volumeSpike = avgVol20 && volume > 0 ? volume / avgVol20 : null
  const gapPct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null
  const pctOffHigh52 = high52 && high52 > 0 ? ((high52 - price) / high52) * 100 : null
  const pctOffLow52 = low52 && low52 > 0 ? ((price - low52) / low52) * 100 : null
  const pctAboveSma20 = sma20 && sma20 > 0 ? ((price - sma20) / sma20) * 100 : null
  const pctAboveSma50 = sma50 && sma50 > 0 ? ((price - sma50) / sma50) * 100 : null
  const pctAboveSma200 = sma200 && sma200 > 0 ? ((price - sma200) / sma200) * 100 : null

  const signals = []
  if (rsi !== null) {
    if (rsi < 30) signals.push({ type: 'oversold', label: 'RSI Oversold', value: Math.round(rsi) })
    if (rsi > 70) signals.push({ type: 'overbought', label: 'RSI Overbought', value: Math.round(rsi) })
  }
  if (crossover === 'golden_cross') signals.push({ type: 'golden_cross', label: 'Golden Cross 50/200' })
  if (crossover === 'death_cross') signals.push({ type: 'death_cross', label: 'Death Cross 50/200' })
  if (volumeSpike !== null && volumeSpike > 2) signals.push({ type: 'volume_spike', label: 'Volume Spike', value: Math.round(volumeSpike * 10) / 10 })
  if (pctOffHigh52 !== null && pctOffHigh52 < 3) signals.push({ type: 'near_high52', label: 'Near 52W High', value: Math.round(pctOffHigh52 * 10) / 10 })
  if (pctOffLow52 !== null && pctOffLow52 < 3) signals.push({ type: 'near_low52', label: 'Near 52W Low', value: Math.round(pctOffLow52 * 10) / 10 })
  if (streakUp >= 5) signals.push({ type: 'streak_up', label: `${streakUp}-Day Up` })
  if (streakDown >= 5) signals.push({ type: 'streak_down', label: `${streakDown}-Day Down` })
  if (pctAboveSma200 !== null && pctAboveSma200 < -5) signals.push({ type: 'below_sma200', label: 'Below 200-SMA', value: Math.round(pctAboveSma200 * 10) / 10 })
  if (pctAboveSma200 !== null && pctAboveSma200 > 20) signals.push({ type: 'extended_sma200', label: 'Extended Above 200-SMA', value: Math.round(pctAboveSma200 * 10) / 10 })
  if (gapPct !== null && gapPct > 3) signals.push({ type: 'gap_up', label: `Gap Up ${gapPct.toFixed(1)}%`, value: Math.round(gapPct * 10) / 10 })
  if (gapPct !== null && gapPct < -3) signals.push({ type: 'gap_down', label: `Gap Down ${Math.abs(gapPct).toFixed(1)}%`, value: Math.round(Math.abs(gapPct) * 10) / 10 })
  if (pattern) signals.push({ type: pattern.type, label: pattern.label })
  if (signals.length === 0 && Math.abs(change) > 3) {
    signals.push({ type: 'big_mover', label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%` })
  }

  const window = 63
  const totalReturn = closes.length >= window
    ? ((closes[closes.length - 1] - closes[closes.length - window]) / closes[closes.length - window]) * 100
    : (closes.length > 5 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : change)
  const weekReturn = closes.length > 5 ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : change

  return {
    symbol, price, change, volume,
    rsi: rsi !== null ? Math.round(rsi) : null,
    sma20: sma20 !== null ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 !== null ? Math.round(sma50 * 100) / 100 : null,
    sma200: sma200 !== null ? Math.round(sma200 * 100) / 100 : null,
    volumeSpike: volumeSpike !== null ? Math.round(volumeSpike * 10) / 10 : null,
    gapPct: gapPct !== null ? Math.round(gapPct * 10) / 10 : null,
    pctOffHigh52: pctOffHigh52 !== null ? Math.round(pctOffHigh52 * 10) / 10 : null,
    pctOffLow52: pctOffLow52 !== null ? Math.round(pctOffLow52 * 10) / 10 : null,
    pctAboveSma20: pctAboveSma20 !== null ? Math.round(pctAboveSma20 * 10) / 10 : null,
    pctAboveSma50: pctAboveSma50 !== null ? Math.round(pctAboveSma50 * 10) / 10 : null,
    pctAboveSma200: pctAboveSma200 !== null ? Math.round(pctAboveSma200 * 10) / 10 : null,
    streakUp, streakDown, crossover,
    signals,
    totalReturn: Math.round(totalReturn * 10) / 10,
    weekReturn: Math.round(weekReturn * 10) / 10,
    recentCloses: closes.slice(-21),
  }
}

function categorizeResults(results) {
  const now = new Date().toISOString()
  const sections = {
    scanned: results.length,
    updatedAt: now,
    gainers: [],
    losers: [],
    mostActive: [],
    oversold: [],
    overbought: [],
    goldenCrosses: [],
    deathCrosses: [],
    volumeSpikes: [],
    nearHigh52: [],
    nearLow52: [],
  }

  if (results.length === 0) return sections

  sections.gainers = [...results].filter(r => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 20)
  sections.losers = [...results].filter(r => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 20)
  sections.mostActive = [...results].sort((a, b) => b.volume - a.volume).slice(0, 20)
  sections.oversold = [...results].filter(r => r.rsi !== null && r.rsi < 35).sort((a, b) => (a.rsi ?? 0) - (b.rsi ?? 0)).slice(0, 20)
  sections.overbought = [...results].filter(r => r.rsi !== null && r.rsi > 65).sort((a, b) => (b.rsi ?? 0) - (a.rsi ?? 0)).slice(0, 20)
  sections.goldenCrosses = results.filter(r => r.crossover === 'golden_cross').slice(0, 20)
  sections.deathCrosses = results.filter(r => r.crossover === 'death_cross').slice(0, 20)
  sections.volumeSpikes = [...results].filter(r => r.volumeSpike !== null && r.volumeSpike > 1.8).sort((a, b) => (b.volumeSpike ?? 0) - (a.volumeSpike ?? 0)).slice(0, 20)
  sections.nearHigh52 = [...results].filter(r => r.pctOffHigh52 !== null && r.pctOffHigh52 < 5 && r.pctOffHigh52 >= 0).sort((a, b) => (a.pctOffHigh52 ?? 0) - (b.pctOffHigh52 ?? 0)).slice(0, 20)
  sections.nearLow52 = [...results].filter(r => r.pctOffLow52 !== null && r.pctOffLow52 < 5 && r.pctOffLow52 >= 0).sort((a, b) => (a.pctOffLow52 ?? 0) - (b.pctOffLow52 ?? 0)).slice(0, 20)

  // Fallback: if any section is empty, backfill with top movers so no category is blank
  for (const key of ['oversold', 'overbought', 'goldenCrosses', 'deathCrosses', 'volumeSpikes', 'nearHigh52', 'nearLow52']) {
    if (sections[key].length === 0) {
      const fill = [...results]
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 5)
      sections[key] = fill.map(r => ({ ...r, signals: [...(r.signals || []), { type: 'top_mover', label: `${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%` }] }))
    }
  }

  return sections
}

async function getBroadSymbols() {
  const config = readAlpacaConfig()
  if (!config.configured) return SP500.slice(0, 100)
  try {
    const { getBrokerAssets } = await import('./alpacaClient.mjs')
    const assets = await getBrokerAssets(config)
    if (!Array.isArray(assets) || assets.length === 0) return SP500.slice(0, 100)
    return assets
      .filter(a => {
        const cls = (a.asset_class ?? a.class ?? '').toLowerCase()
        return cls === 'us_equity' || cls === 'equity' || cls === 'stock'
      })
      .map(a => a.symbol)
      .filter(Boolean)
      .slice(0, 1500)
  } catch {
    return SP500.slice(0, 100)
  }
}

async function getSymbolList(scope, userId) {
  if (scope === 'broad') {
    return getBroadSymbols()
  }
  if (scope === 'watchlist' && userId) {
    const { getWatchlistSymbols } = await import('./userStore.mjs')
    const syms = await getWatchlistSymbols(userId)
    return (syms && syms.length >= 2) ? syms : SP500.slice(0, 10)
  }
  if (scope === 'portfolio' && userId) {
    const { getPortfolioSymbols } = await import('./userStore.mjs')
    const syms = await getPortfolioSymbols(userId)
    return (syms && syms.length >= 2) ? syms : SP500.slice(0, 10)
  }
  return STATIC_UNIVERSES[scope] || SP500
}

async function processBatch(symbols) {
  const [snapshotsResult, barsBySymbol] = await Promise.all([
    getSnapshots(symbols).catch(() => ({ snapshots: {} })),
    getBatchDailyBars(symbols, 400).catch(() => ({})),
  ])
  const snapshots = snapshotsResult.snapshots ?? {}
  const results = []
  for (const sym of symbols) {
    const s = screenSymbol(sym, barsBySymbol[sym], snapshots[sym])
    if (s) results.push(s)
  }
  return results
}

export async function runScreener(scope = 'sp500', userId = null) {
  const cacheKey = `${scope}:${userId ?? ''}`
  if (screenerCache.running.has(cacheKey)) return screenerCache.results[cacheKey]
  screenerCache.running.add(cacheKey)

  try {
    let symbols = await getSymbolList(scope, userId)
    symbols = [...new Set(symbols.filter(Boolean).map(s => s.toUpperCase()))].slice(0, 1500)
    if (symbols.length === 0) symbols = SP500.slice(0, 10)

    const total = symbols.length
    const isLarge = total > 200

    if (isLarge) {
      const allResults = []
      screenerCache.scans[cacheKey] = { status: 'scanning', total, scanned: 0 }

      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        if (screenerCache.scans[cacheKey]?.status === 'cancelled') break
        const batch = symbols.slice(i, i + BATCH_SIZE)
        const batchResults = await processBatch(batch)
        allResults.push(...batchResults)
        screenerCache.scans[cacheKey].scanned = Math.min(i + BATCH_SIZE, total)
        const partial = categorizeResults(allResults)
        const config = readAlpacaConfig()
        screenerCache.results[cacheKey] = { ...partial, total, scope, provider: config.configured ? 'alpaca' : 'demo' }
        if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }

      screenerCache.scans[cacheKey] = { status: 'ready', total, scanned: total }
      screenerCache.expiresAt = Date.now() + SCAN_TTL_MS
      return screenerCache.results[cacheKey]
    }

    let allResults = []
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE)
      const batchResults = await processBatch(batch)
      allResults.push(...batchResults)
    }

    const categorized = categorizeResults(allResults)
    const config = readAlpacaConfig()
    const result = { ...categorized, total, scope, provider: config.configured ? 'alpaca' : 'demo' }

    screenerCache.results[cacheKey] = result
    screenerCache.expiresAt = Date.now() + SCAN_TTL_MS
    return result
  } catch (err) {
    console.error(`[screener] Error (${scope}):`, err.message)
    return null
  } finally {
    screenerCache.running.delete(cacheKey)
  }
}

export function getScreenerResults(scope = 'sp500', userId = null) {
  const cacheKey = `${scope}:${userId ?? ''}`
  return screenerCache.expiresAt > Date.now() ? screenerCache.results[cacheKey] : null
}

export function getScreenerScanState(scope = 'sp500', userId = null) {
  const cacheKey = `${scope}:${userId ?? ''}`
  const scan = screenerCache.scans[cacheKey]
  if (!scan) return null
  return { ...scan, scope }
}

export async function runDefaultScreener() {
  return runScreener('sp500')
}

export { getBroadSymbols }
