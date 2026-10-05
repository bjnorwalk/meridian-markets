import {
  getAlpacaStatus,
  getBars,
  getMarketClock,
  getOptionChain,
} from './alpacaClient.mjs'
import { securityHeaders } from './httpSecurity.mjs'
import {
  appendStrategyAudit,
  getKillSwitch,
  getDeploymentPL,
  getDeploymentPositions,
  getDeploymentTrades,
  listPaperDeployments,
  listStrategyAudit,
  savePaperDeployment,
  setKillSwitch,
} from './strategyStore.mjs'

const strategyLabels = {
  trend_breakout: 'Trend breakout',
  mean_reversion: 'Mean reversion',
  moving_average_cross: 'Moving average cross',
}

const optionStructureLabels = {
  long_call: 'Long call',
  long_put: 'Long put',
  covered_call: 'Covered call',
  cash_secured_put: 'Cash-secured put',
  bull_call_spread: 'Bull call spread',
  bear_put_spread: 'Bear put spread',
  iron_condor: 'Iron condor',
}

const defaultBacktestConfig = {
  symbol: 'AAPL',
  timeframe: '1M',
  instrument: 'equity',
  strategyType: 'trend_breakout',
  optionStructure: 'long_call',
  startingCapital: 100000,
  riskPerTradePercent: 1,
  maxPositionPercent: 20,
  maxDailyLossPercent: 3,
  maxDrawdownPercent: 12,
  stopLossPercent: 4,
}

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

function sendError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500
  sendJson(res, status, {
    error: {
      code: error.code ?? 'STRATEGY_API_ERROR',
      message: error.message ?? 'Strategy API request failed.',
    },
  })
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(apiError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

function normalizeSymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) {
    throw apiError(400, 'INVALID_SYMBOL', 'Use a valid stock or ETF symbol.')
  }
  return symbol
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? fallback).trim().toLowerCase()
  return allowed.includes(normalized) ? normalized : fallback
}

function clampNumber(value, fallback, min, max, digits = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  return Number(clamped.toFixed(digits))
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeBacktestConfig(input = {}) {
  return {
    symbol: normalizeSymbol(input.symbol ?? defaultBacktestConfig.symbol),
    timeframe: normalizeEnum(
      input.timeframe,
      ['1D', '1W', '1M', '6M', '1Y'].map((item) => item.toLowerCase()),
      defaultBacktestConfig.timeframe.toLowerCase(),
    ).toUpperCase(),
    instrument: normalizeEnum(input.instrument, ['equity', 'option'], defaultBacktestConfig.instrument),
    strategyType: normalizeEnum(
      input.strategyType,
      Object.keys(strategyLabels),
      defaultBacktestConfig.strategyType,
    ),
    optionStructure: normalizeEnum(
      input.optionStructure,
      Object.keys(optionStructureLabels),
      defaultBacktestConfig.optionStructure,
    ),
    startingCapital: clampNumber(input.startingCapital, defaultBacktestConfig.startingCapital, 1000, 10000000, 0),
    riskPerTradePercent: clampNumber(input.riskPerTradePercent, defaultBacktestConfig.riskPerTradePercent, 0.1, 20),
    maxPositionPercent: clampNumber(input.maxPositionPercent, defaultBacktestConfig.maxPositionPercent, 1, 100),
    maxDailyLossPercent: clampNumber(input.maxDailyLossPercent, defaultBacktestConfig.maxDailyLossPercent, 0.1, 50),
    maxDrawdownPercent: clampNumber(input.maxDrawdownPercent, defaultBacktestConfig.maxDrawdownPercent, 1, 80),
    stopLossPercent: clampNumber(input.stopLossPercent, defaultBacktestConfig.stopLossPercent, 0.5, 30),
  }
}

function seedFromSymbol(symbol) {
  return [...symbol].reduce((total, char) => total + char.charCodeAt(0), 0)
}

function buildDemoBars(symbol, timeframe = '1M') {
  const configs = {
    '1D': { count: 160, stepMs: 5 * 60 * 1000 },
    '1W': { count: 220, stepMs: 15 * 60 * 1000 },
    '1M': { count: 240, stepMs: 60 * 60 * 1000 },
    '6M': { count: 190, stepMs: 24 * 60 * 60 * 1000 },
    '1Y': { count: 250, stepMs: 24 * 60 * 60 * 1000 },
  }
  const selected = configs[timeframe] ?? configs['1M']
  const seed = seedFromSymbol(symbol)
  const base = 55 + (seed % 260)
  const bars = []
  let close = base
  const start = Date.now() - selected.count * selected.stepMs

  for (let index = 0; index < selected.count; index += 1) {
    const drift = Math.sin((index + seed) / 13) * 0.012 + Math.cos((index + seed) / 31) * 0.006
    const impulse = ((seed + index * 17) % 19 === 0 ? 0.024 : 0) - ((seed + index * 23) % 29 === 0 ? 0.026 : 0)
    const open = close
    close = Math.max(2, close * (1 + drift + impulse))
    const high = Math.max(open, close) * (1 + 0.004 + ((seed + index) % 7) / 1200)
    const low = Math.min(open, close) * (1 - 0.004 - ((seed + index) % 5) / 1200)
    bars.push({
      time: Math.floor((start + index * selected.stepMs) / 1000),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: 800000 + ((seed * 7919 + index * 15485863) % 2400000),
    })
  }

  return bars
}

async function loadBacktestBars(config) {
  try {
    const payload = await getBars(config.symbol, config.timeframe)
    const bars = (payload?.bars ?? [])
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .sort((left, right) => left.time - right.time)
    if (bars.length >= 40) {
      return {
        bars,
        source: 'Alpaca historical bars',
        requestId: payload.requestId ?? null,
      }
    }
  } catch (error) {
    return {
      bars: buildDemoBars(config.symbol, config.timeframe),
      source: 'Demo historical bars',
      fallbackReason: error?.message ?? 'Live historical bars unavailable',
      requestId: null,
    }
  }

  return {
    bars: buildDemoBars(config.symbol, config.timeframe),
    source: 'Demo historical bars',
    fallbackReason: 'Live historical bars returned too few points for a backtest.',
    requestId: null,
  }
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = average(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

function highest(values) {
  return values.reduce((best, value) => Math.max(best, value), -Infinity)
}

function lowest(values) {
  return values.reduce((best, value) => Math.min(best, value), Infinity)
}

function shouldEnter(strategyType, bars, index) {
  if (index < 25) return false
  const close = bars[index].close
  const previous = bars.slice(Math.max(0, index - 20), index)
  const closes = previous.map((bar) => bar.close)

  if (strategyType === 'trend_breakout') {
    const previousHigh = highest(previous.slice(-10).map((bar) => bar.high))
    return close > previousHigh
  }

  if (strategyType === 'mean_reversion') {
    const mean = average(closes)
    const band = standardDeviation(closes) * 1.15
    return close < mean - band
  }

  const fast = average(closes.slice(-6))
  const slow = average(closes)
  const priorFast = average(bars.slice(index - 7, index - 1).map((bar) => bar.close))
  const priorSlow = average(bars.slice(index - 21, index - 1).map((bar) => bar.close))
  return fast > slow && priorFast <= priorSlow
}

function shouldExit(strategyType, bars, index, position, config) {
  const close = bars[index].close
  const stopPrice = position.entryPrice * (1 - config.stopLossPercent / 100)
  if (close <= stopPrice) return { exit: true, reason: 'stop_loss' }

  const previous = bars.slice(Math.max(0, index - 20), index)
  const closes = previous.map((bar) => bar.close)

  if (strategyType === 'trend_breakout') {
    const trail = lowest(previous.slice(-8).map((bar) => bar.low))
    return { exit: close < trail, reason: 'trend_failed' }
  }

  if (strategyType === 'mean_reversion') {
    const mean = average(closes)
    return { exit: close >= mean, reason: 'mean_reversion_complete' }
  }

  const fast = average(closes.slice(-6))
  const slow = average(closes)
  return { exit: fast < slow, reason: 'moving_average_cross_down' }
}

function estimateOptionPosition(config, entryPrice, exitPrice, positionBudget) {
  const structure = config.optionStructure
  const width = Math.max(1, entryPrice * 0.06)
  const longCallStrike = entryPrice
  const shortCallStrike = entryPrice + width
  const longPutStrike = entryPrice
  const shortPutStrike = entryPrice - width
  const longCallDebit = Math.max(0.35, entryPrice * 0.035)
  const longPutDebit = Math.max(0.3, entryPrice * 0.032)
  const spreadDebit = Math.max(0.25, entryPrice * 0.018)
  const coveredCallCredit = Math.max(0.2, entryPrice * 0.014)
  const putCredit = Math.max(0.2, entryPrice * 0.016)
  const condorCredit = Math.max(0.15, entryPrice * 0.013)
  const contractValue = 100
  let contracts = 0
  let profit = 0
  let entryCost = 0
  let maxLoss = 0
  let maxProfit = null

  if (structure === 'long_call') {
    entryCost = longCallDebit * contractValue
    contracts = Math.max(1, Math.floor(positionBudget / entryCost))
    profit = contracts * (Math.max(exitPrice - longCallStrike, 0) * contractValue - entryCost)
    maxLoss = contracts * entryCost
  } else if (structure === 'long_put') {
    entryCost = longPutDebit * contractValue
    contracts = Math.max(1, Math.floor(positionBudget / entryCost))
    profit = contracts * (Math.max(longPutStrike - exitPrice, 0) * contractValue - entryCost)
    maxLoss = contracts * entryCost
    maxProfit = contracts * Math.max(0, (longPutStrike - longPutDebit) * contractValue)
  } else if (structure === 'bull_call_spread') {
    entryCost = spreadDebit * contractValue
    contracts = Math.max(1, Math.floor(positionBudget / entryCost))
    const payoff = Math.min(Math.max(exitPrice - longCallStrike, 0), width) * contractValue
    profit = contracts * (payoff - entryCost)
    maxLoss = contracts * entryCost
    maxProfit = contracts * (width * contractValue - entryCost)
  } else if (structure === 'bear_put_spread') {
    entryCost = spreadDebit * contractValue
    contracts = Math.max(1, Math.floor(positionBudget / entryCost))
    const payoff = Math.min(Math.max(longPutStrike - exitPrice, 0), width) * contractValue
    profit = contracts * (payoff - entryCost)
    maxLoss = contracts * entryCost
    maxProfit = contracts * (width * contractValue - entryCost)
  } else if (structure === 'covered_call') {
    const sharesBudget = Math.max(entryPrice * contractValue, positionBudget)
    contracts = Math.max(1, Math.floor(sharesBudget / (entryPrice * contractValue)))
    const shares = contracts * contractValue
    const shortCallStrike = entryPrice * 1.05
    profit =
      shares * (exitPrice - entryPrice) +
      contracts * coveredCallCredit * contractValue -
      contracts * Math.max(exitPrice - shortCallStrike, 0) * contractValue
    maxLoss = shares * entryPrice - contracts * coveredCallCredit * contractValue
    maxProfit = contracts * ((shortCallStrike - entryPrice + coveredCallCredit) * contractValue)
  } else if (structure === 'cash_secured_put') {
    const strike = entryPrice * 0.95
    const cashRequired = strike * contractValue
    contracts = Math.max(1, Math.floor(Math.max(cashRequired, positionBudget) / cashRequired))
    profit = contracts * (putCredit * contractValue - Math.max(strike - exitPrice, 0) * contractValue)
    maxLoss = contracts * (strike - putCredit) * contractValue
    maxProfit = contracts * putCredit * contractValue
  } else {
    const shortCall = entryPrice * 1.05
    const longCall = shortCall + width
    const shortPut = entryPrice * 0.95
    const longPut = shortPut - width
    const maxLossPerSpread = (width - condorCredit) * contractValue
    contracts = Math.max(1, Math.floor(positionBudget / maxLossPerSpread))
    const callLoss = Math.min(Math.max(exitPrice - shortCall, 0), longCall - shortCall)
    const putLoss = Math.min(Math.max(shortPut - exitPrice, 0), shortPut - longPut)
    profit = contracts * ((condorCredit - callLoss - putLoss) * contractValue)
    maxLoss = contracts * maxLossPerSpread
    maxProfit = contracts * condorCredit * contractValue
  }

  return {
    contracts,
    profit,
    entryCost,
    maxLoss,
    maxProfit,
  }
}

function equityPositionSize(config, equity, price) {
  const positionBudget = equity * (config.maxPositionPercent / 100)
  const riskBudget = equity * (config.riskPerTradePercent / 100)
  const stopDistance = price * (config.stopLossPercent / 100)
  const sizeByPosition = Math.floor(positionBudget / price)
  const sizeByRisk = Math.floor(riskBudget / stopDistance)
  return Math.max(0, Math.min(sizeByPosition, sizeByRisk))
}

function calculateMaxDrawdown(equityCurve) {
  let peak = equityCurve[0]?.equity ?? 0
  let maxDrawdown = 0
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity)
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, ((peak - point.equity) / peak) * 100)
    }
  }
  return maxDrawdown
}

function metricsFromTrades(config, trades, equityCurve, barsWithPosition) {
  const endingCapital = equityCurve.at(-1)?.equity ?? config.startingCapital
  const winners = trades.filter((trade) => trade.profit > 0)
  const losers = trades.filter((trade) => trade.profit < 0)
  const grossProfit = winners.reduce((total, trade) => total + trade.profit, 0)
  const grossLoss = Math.abs(losers.reduce((total, trade) => total + trade.profit, 0))
  return {
    startingCapital: config.startingCapital,
    endingCapital: round(endingCapital),
    totalReturnPercent: round(((endingCapital - config.startingCapital) / config.startingCapital) * 100),
    maxDrawdownPercent: round(calculateMaxDrawdown(equityCurve)),
    winRatePercent: round(trades.length ? (winners.length / trades.length) * 100 : 0),
    tradeCount: trades.length,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : round(grossProfit / grossLoss, 2),
    averageTrade: round(trades.length ? trades.reduce((total, trade) => total + trade.profit, 0) / trades.length : 0),
    exposurePercent: round((barsWithPosition / Math.max(1, equityCurve.length)) * 100),
  }
}

function runBacktestEngine(config, bars, killSwitch) {
  const audit = []
  const trades = []
  const equityCurve = []
  let cash = config.startingCapital
  let position = null
  let barsWithPosition = 0
  let halted = false
  let peakEquity = config.startingCapital

  if (killSwitch.enabled) {
    audit.push({
      eventType: 'risk_block',
      message: `Backtest blocked by global kill switch${killSwitch.reason ? `: ${killSwitch.reason}` : '.'}`,
      createdAt: new Date().toISOString(),
    })
    return {
      trades,
      equityCurve: bars.map((bar) => ({
        time: bar.time,
        equity: config.startingCapital,
        close: bar.close,
      })),
      metrics: metricsFromTrades(config, trades, bars.map((bar) => ({
        time: bar.time,
        equity: config.startingCapital,
        close: bar.close,
      })), 0),
      audit,
    }
  }

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]
    let markedEquity = cash
    if (position) {
      barsWithPosition += 1
      if (config.instrument === 'equity') {
        markedEquity = cash + position.quantity * bar.close
      } else {
        const estimate = estimateOptionPosition(config, position.entryPrice, bar.close, position.positionBudget)
        markedEquity = cash + position.reservedCapital + estimate.profit
      }
    }

    peakEquity = Math.max(peakEquity, markedEquity)
    const drawdownPercent = peakEquity === 0 ? 0 : ((peakEquity - markedEquity) / peakEquity) * 100
    if (!halted && drawdownPercent >= config.maxDrawdownPercent) {
      halted = true
      audit.push({
        eventType: 'risk_halt',
        message: `Risk engine halted new entries after ${round(drawdownPercent)}% drawdown.`,
        createdAt: new Date(bar.time * 1000).toISOString(),
      })
    }

    if (position) {
      const exitSignal = shouldExit(config.strategyType, bars, index, position, config)
      const lastBar = index === bars.length - 1
      if (exitSignal.exit || lastBar) {
        const exitPrice = bar.close
        let profit = 0
        if (config.instrument === 'equity') {
          cash += position.quantity * exitPrice
          profit = (exitPrice - position.entryPrice) * position.quantity
        } else {
          const estimate = estimateOptionPosition(config, position.entryPrice, exitPrice, position.positionBudget)
          cash += position.reservedCapital + estimate.profit
          profit = estimate.profit
        }
        const trade = {
          id: `trd_${trades.length + 1}`,
          symbol: config.symbol,
          instrument: config.instrument,
          optionStructure: config.instrument === 'option' ? config.optionStructure : null,
          entryTime: position.entryTime,
          exitTime: bar.time,
          entryPrice: round(position.entryPrice),
          exitPrice: round(exitPrice),
          quantity: position.quantity,
          contracts: position.contracts,
          profit: round(profit),
          profitPercent: round(position.riskCapital > 0 ? (profit / position.riskCapital) * 100 : 0),
          reason: lastBar ? 'period_end' : exitSignal.reason,
        }
        trades.push(trade)
        position = null
        markedEquity = cash
      }
    }

    if (!position && !halted && shouldEnter(config.strategyType, bars, index)) {
      const equity = markedEquity
      const positionBudget = equity * (config.maxPositionPercent / 100)
      if (config.instrument === 'equity') {
        const quantity = equityPositionSize(config, equity, bar.close)
        if (quantity > 0) {
          const reservedCapital = quantity * bar.close
          cash -= reservedCapital
          position = {
            entryTime: bar.time,
            entryPrice: bar.close,
            quantity,
            contracts: 0,
            riskCapital: reservedCapital,
          }
          audit.push({
            eventType: 'entry',
            message: `${strategyLabels[config.strategyType]} opened ${quantity} ${config.symbol} shares.`,
            createdAt: new Date(bar.time * 1000).toISOString(),
          })
        }
      } else {
        const estimate = estimateOptionPosition(config, bar.close, bar.close, positionBudget)
        if (estimate.contracts > 0 && estimate.maxLoss <= equity * (config.maxPositionPercent / 100) * 1.2) {
          const reservedCapital = Math.min(positionBudget, estimate.maxLoss)
          cash -= reservedCapital
          position = {
            entryTime: bar.time,
            entryPrice: bar.close,
            quantity: 0,
            contracts: estimate.contracts,
            positionBudget,
            reservedCapital,
            riskCapital: estimate.maxLoss,
          }
          audit.push({
            eventType: 'entry',
            message: `${optionStructureLabels[config.optionStructure]} idea opened for ${config.symbol}.`,
            createdAt: new Date(bar.time * 1000).toISOString(),
          })
        }
      }
    }

    equityCurve.push({
      time: bar.time,
      equity: round(markedEquity),
      close: round(bar.close),
    })
  }

  return {
    trades,
    equityCurve,
    metrics: metricsFromTrades(config, trades, equityCurve, barsWithPosition),
    audit,
  }
}

function detectCopilotDraft(prompt, symbol) {
  const text = String(prompt ?? '').toLowerCase()
  const mentionsOptions = /\b(option|options|call|put|spread|covered|condor|premium|theta|income)\b/.test(text)
  let strategyType = 'trend_breakout'
  if (/\b(mean|reversion|oversold|dip|pullback)\b/.test(text)) strategyType = 'mean_reversion'
  if (/\b(cross|moving average|sma|ema)\b/.test(text)) strategyType = 'moving_average_cross'

  let optionStructure = 'long_call'
  if (/\bput\b/.test(text) && /\bspread\b/.test(text)) optionStructure = 'bear_put_spread'
  else if (/\bcall\b/.test(text) && /\bspread\b/.test(text)) optionStructure = 'bull_call_spread'
  else if (/\biron|condor|range|neutral\b/.test(text)) optionStructure = 'iron_condor'
  else if (/\bcovered\b/.test(text)) optionStructure = 'covered_call'
  else if (/\bcash|secured|income|wheel\b/.test(text)) optionStructure = 'cash_secured_put'
  else if (/\bput\b/.test(text)) optionStructure = 'long_put'

  const riskPerTradePercent = /\baggressive|high risk|swing\b/.test(text) ? 2 : 1
  const maxPositionPercent = mentionsOptions ? 12 : 18

  return {
    symbol,
    timeframe: '1M',
    instrument: mentionsOptions ? 'option' : 'equity',
    strategyType,
    optionStructure,
    startingCapital: 100000,
    riskPerTradePercent,
    maxPositionPercent,
    maxDailyLossPercent: 3,
    maxDrawdownPercent: 12,
    stopLossPercent: mentionsOptions ? 6 : 4,
  }
}

async function buildHealth(symbol) {
  const provider = getAlpacaStatus()
  let clock = {
    status: provider.configured ? 'unavailable' : 'demo',
    message: provider.configured ? 'Market clock could not be verified.' : 'Alpaca credentials are not configured.',
    isOpen: null,
    nextOpen: null,
    nextClose: null,
  }
  try {
    const payload = await getMarketClock()
    clock = {
      status: 'ok',
      message: payload.isOpen ? 'Market clock reports open.' : 'Market clock reports closed.',
      isOpen: payload.isOpen,
      nextOpen: payload.nextOpen,
      nextClose: payload.nextClose,
    }
  } catch (error) {
    clock = {
      ...clock,
      status: provider.configured ? 'error' : 'demo',
      message: error?.message ?? clock.message,
    }
  }

  const optionChain = await getOptionChain(symbol, { limit: 4 })
  const optionsLive = String(optionChain.source ?? '').toLowerCase().includes('alpaca')
  const checks = [
    {
      key: 'market_data',
      label: 'Market data',
      status: provider.configured ? 'ok' : 'demo',
      detail: provider.configured
        ? `${provider.feed} feed, ${provider.endDelayMinutes}m delayed end window`
        : 'Using deterministic demo bars until Alpaca credentials are configured.',
    },
    {
      key: 'clock',
      label: 'Trading clock',
      status: clock.status,
      detail: clock.message,
    },
    {
      key: 'options',
      label: 'Options entitlement',
      status: optionsLive ? 'ok' : 'demo',
      detail: optionsLive
        ? `${optionChain.source} returned ${optionChain.contracts.length} contracts.`
        : optionChain.fallbackReason ?? 'Live options unavailable; demo chain is active.',
    },
    {
      key: 'paper_trading',
      label: 'Paper trading',
      status: 'ok',
      detail: 'Strategy deployment is paper-only and does not place broker orders.',
    },
  ]

  return {
    provider,
    clock,
    options: {
      symbol,
      source: optionChain.source,
      live: optionsLive,
      contracts: optionChain.contracts.length,
      fallbackReason: optionChain.fallbackReason,
      optionsFeed: provider.optionsFeed,
    },
    killSwitch: getKillSwitch(),
    checks,
    updatedAt: Date.now(),
  }
}

async function handleBacktest(body) {
  const config = normalizeBacktestConfig(body)
  const killSwitch = getKillSwitch()
  const { bars, source, fallbackReason, requestId } = await loadBacktestBars(config)
  const result = runBacktestEngine(config, bars, killSwitch)
  const payload = {
    config,
    data: {
      source,
      fallbackReason,
      requestId,
      barCount: bars.length,
    },
    ...result,
    generatedAt: Date.now(),
  }
  appendStrategyAudit({
    eventType: 'backtest',
    message: `${strategyLabels[config.strategyType]} backtest generated for ${config.symbol}.`,
    payload: {
      symbol: config.symbol,
      instrument: config.instrument,
      optionStructure: config.instrument === 'option' ? config.optionStructure : null,
      totalReturnPercent: payload.metrics.totalReturnPercent,
      tradeCount: payload.metrics.tradeCount,
      source,
    },
  })
  return payload
}

function riskStateForDeployment(config, backtestMetrics, killSwitch) {
  const warnings = []
  if (killSwitch.enabled) warnings.push('Global kill switch is enabled.')
  if ((backtestMetrics?.maxDrawdownPercent ?? 0) > config.maxDrawdownPercent) {
    warnings.push('Backtest drawdown exceeds configured maximum.')
  }
  if ((backtestMetrics?.tradeCount ?? 0) < 1) warnings.push('Backtest generated no completed trades.')
  if (config.instrument === 'option' && ['long_call', 'long_put'].includes(config.optionStructure)) {
    warnings.push('Long premium option ideas can expire worthless.')
  }
  return {
    status: warnings.length ? 'warning' : 'clear',
    warnings,
  }
}

function handleDeployPaper(body) {
  const config = normalizeBacktestConfig(body.config ?? body)
  const killSwitch = getKillSwitch()
  const backtestMetrics = body.metrics ?? body.backtestMetrics ?? null
  const riskState = riskStateForDeployment(config, backtestMetrics, killSwitch)
  const status = killSwitch.enabled ? 'blocked' : 'running'
  const deployment = savePaperDeployment({
    config,
    metrics: backtestMetrics,
    status,
    riskState,
    mode: 'paper',
    createdAt: new Date().toISOString(),
    nextReviewAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  })

  appendStrategyAudit({
    deploymentId: deployment.id,
    eventType: status === 'blocked' ? 'deployment_blocked' : 'deployment_started',
    message: status === 'blocked'
      ? `${config.symbol} paper deployment blocked by kill switch.`
      : `${config.symbol} paper deployment started in simulator.`,
    payload: {
      deploymentId: deployment.id,
      symbol: config.symbol,
      instrument: config.instrument,
      strategyType: config.strategyType,
      riskState,
    },
  })

  return { deployment, killSwitch }
}

function handleCopilot(body) {
  const symbol = normalizeSymbol(body.symbol ?? defaultBacktestConfig.symbol)
  const draft = detectCopilotDraft(body.prompt, symbol)
  return {
    draft,
    title: `${draft.instrument === 'option' ? optionStructureLabels[draft.optionStructure] : strategyLabels[draft.strategyType]} draft for ${symbol}`,
    rationale: [
      draft.instrument === 'option'
        ? 'The prompt points to an options idea, so the draft uses defined-risk sizing where possible.'
        : 'The prompt points to an equity signal, so the draft uses share sizing and stop-aware risk limits.',
      `${strategyLabels[draft.strategyType]} is selected from the language in the prompt.`,
      'Paper deployment stays disabled from live execution until explicit broker order controls are built.',
    ],
    warnings: [
      'This is a rules-based strategy draft, not financial advice.',
      'Run a backtest and inspect the audit trail before deploying to the paper simulator.',
    ],
  }
}

function monitorPayload() {
  return {
    deployments: listPaperDeployments(),
    audit: listStrategyAudit(),
    killSwitch: getKillSwitch(),
    updatedAt: Date.now(),
  }
}

export function createStrategyApiMiddleware() {
  return async function strategyApiMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/strategy')) {
      next?.()
      return false
    }

    try {
      res.req = req
      const url = new URL(req.url, 'http://localhost')

      if (url.pathname === '/api/strategy/health' && req.method === 'GET') {
        const symbol = normalizeSymbol(url.searchParams.get('symbol') ?? defaultBacktestConfig.symbol)
        sendJson(res, 200, await buildHealth(symbol))
        return true
      }

      if (url.pathname === '/api/strategy/backtest' && req.method === 'POST') {
        sendJson(res, 200, await handleBacktest(await readJsonBody(req)))
        return true
      }

      if (url.pathname === '/api/strategy/copilot' && req.method === 'POST') {
        sendJson(res, 200, handleCopilot(await readJsonBody(req)))
        return true
      }

      if (url.pathname === '/api/strategy/deploy-paper' && req.method === 'POST') {
        sendJson(res, 201, handleDeployPaper(await readJsonBody(req)))
        return true
      }

      if (url.pathname === '/api/strategy/monitor' && req.method === 'GET') {
        sendJson(res, 200, monitorPayload())
        return true
      }

      if (url.pathname === '/api/strategy/tick' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const { runPaperTickLoop, runSingleDeploymentTick } = await import('./paperTrader.mjs')
        const result = body.deploymentId
          ? await runSingleDeploymentTick(body.deploymentId)
          : await runPaperTickLoop()
        sendJson(res, 200, { result })
        return true
      }

      if (url.pathname.startsWith('/api/strategy/paper-pl/') && req.method === 'GET') {
        const deploymentId = decodeURIComponent(url.pathname.replace('/api/strategy/paper-pl/', ''))
        sendJson(res, 200, {
          pl: getDeploymentPL(deploymentId),
          positions: getDeploymentPositions(deploymentId),
          trades: getDeploymentTrades(deploymentId),
        })
        return true
      }

      if (url.pathname === '/api/strategy/kill-switch' && req.method === 'POST') {
        const body = await readJsonBody(req)
        sendJson(res, 200, {
          killSwitch: setKillSwitch(Boolean(body.enabled), body.reason),
          monitor: monitorPayload(),
        })
        return true
      }

      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Unknown strategy API endpoint.' },
      })
      return true
    } catch (error) {
      sendError(res, error)
      return true
    }
  }
}
