import { defaultWatchlist, symbols } from '../data/symbols'
import type {
  Bar,
  MarketDataProvider,
  MarketTick,
  QuoteSnapshot,
  Timeframe,
} from '../types/market'

const timeframeConfig: Record<
  Timeframe,
  { points: number; stepSeconds: number; volatility: number }
> = {
  '1D': { points: 96, stepSeconds: 5 * 60, volatility: 0.004 },
  '1W': { points: 120, stepSeconds: 30 * 60, volatility: 0.006 },
  '1M': { points: 90, stepSeconds: 8 * 60 * 60, volatility: 0.01 },
  '6M': { points: 126, stepSeconds: 24 * 60 * 60, volatility: 0.018 },
  '1Y': { points: 252, stepSeconds: 24 * 60 * 60, volatility: 0.024 },
}

const basePriceBySymbol: Record<string, number> = {
  AAPL: 214,
  MSFT: 468,
  NVDA: 141,
  TSLA: 184,
  AMZN: 221,
  GOOGL: 176,
  META: 636,
  JPM: 267,
  SPY: 592,
  QQQ: 514,
  'BTC-USD': 106400,
  'ETH-USD': 3820,
}

const symbolIndex = new Map(symbols.map((item) => [item.symbol, item]))

function seedFromSymbol(symbol: string) {
  return [...symbol].reduce((seed, char) => seed + char.charCodeAt(0) * 17, 31)
}

function wave(seed: number, index: number, strength = 1) {
  return (
    Math.sin((index + seed) * 0.19) * 0.62 +
    Math.cos((index + seed) * 0.047) * 0.38
  ) * strength
}

function roundPrice(value: number) {
  if (value > 1000) return Math.round(value)
  if (value > 100) return Math.round(value * 100) / 100
  return Math.round(value * 1000) / 1000
}

function roundVolume(value: number) {
  return Math.max(1, Math.round(value))
}

function makeBars(symbol: string, timeframe: Timeframe): Bar[] {
  const config = timeframeConfig[timeframe]
  const seed = seedFromSymbol(symbol)
  const basePrice = basePriceBySymbol[symbol] ?? 100 + (seed % 300)
  const baseVolume =
    symbol.includes('USD') ? 1200 + seed * 2 : 280000 + (seed % 9000) * 120
  const now = Math.floor(Date.now() / 1000)
  const start = now - (config.points - 1) * config.stepSeconds
  let close = basePrice * (1 + wave(seed, 1, 0.035))

  return Array.from({ length: config.points }, (_, index) => {
    const drift = (index - config.points / 2) / config.points
    const move =
      wave(seed, index, config.volatility) +
      Math.sin(index * 0.73 + seed) * config.volatility * 0.75 +
      drift * 0.0017
    const open = close
    close = Math.max(0.01, open * (1 + move))
    const spread = Math.abs(open - close) + basePrice * config.volatility * 0.9
    const high = Math.max(open, close) + spread * (0.18 + Math.abs(wave(seed, index, 0.16)))
    const low = Math.max(0.01, Math.min(open, close) - spread * (0.18 + Math.abs(wave(seed, index + 9, 0.16))))
    const volumeWave = 1 + Math.abs(wave(seed, index, 0.32))

    return {
      time: start + index * config.stepSeconds,
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      volume: roundVolume(baseVolume * volumeWave),
    }
  })
}

function snapshotFromBars(symbol: string, bars: Bar[]): QuoteSnapshot {
  const last = bars[bars.length - 1]
  const previous = bars[Math.max(0, bars.length - 12)] ?? bars[0]
  const spread = Math.max(last.close * 0.0007, 0.01)
  const change = last.close - previous.close
  const changePercent = previous.close === 0 ? 0 : (change / previous.close) * 100
  const record = symbolIndex.get(symbol)

  return {
    symbol,
    price: last.close,
    previousClose: previous.close,
    change: roundPrice(change),
    changePercent,
    bid: roundPrice(last.close - spread),
    ask: roundPrice(last.close + spread),
    volume: bars.reduce((total, bar) => total + bar.volume, 0),
    updatedAt: Date.now(),
    marketStatus: record?.assetClass === 'crypto' ? 'simulated' : 'simulated',
    source: 'demo',
  }
}

function nextTick(symbol: string, timeframe: Timeframe, bars: Bar[], tick: number): MarketTick {
  const seed = seedFromSymbol(symbol)
  const config = timeframeConfig[timeframe]
  const last = bars[bars.length - 1]
  const microMove = wave(seed + tick, tick, config.volatility * 0.32)
  const nextClose = roundPrice(Math.max(0.01, last.close * (1 + microMove)))
  const nextBar: Bar = {
    ...last,
    high: roundPrice(Math.max(last.high, nextClose)),
    low: roundPrice(Math.min(last.low, nextClose)),
    close: nextClose,
    volume: roundVolume(last.volume + Math.abs(seed * microMove * 1000)),
  }
  bars[bars.length - 1] = nextBar

  return {
    snapshot: snapshotFromBars(symbol, bars),
    lastBar: nextBar,
  }
}

export const demoMarketProvider: MarketDataProvider = {
  label: 'Demo feed',

  async listSymbols() {
    return symbols
  },

  async searchSymbols(query) {
    const term = query.trim().toLowerCase()
    if (!term) return symbols

    return symbols.filter((item) =>
      [item.symbol, item.name, item.exchange, item.sector]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  },

  async getBars(symbol, timeframe) {
    return makeBars(symbol, timeframe)
  },

  async getSnapshot(symbol, timeframe) {
    return snapshotFromBars(symbol, makeBars(symbol, timeframe))
  },

  subscribe(symbol, timeframe, onTick) {
    const bars = makeBars(symbol, timeframe)
    let tick = 1
    const interval = window.setInterval(() => {
      onTick(nextTick(symbol, timeframe, bars, tick))
      tick += 1
    }, 2200)

    return () => window.clearInterval(interval)
  },
}

export function getDefaultSymbol() {
  return defaultWatchlist[0]
}
