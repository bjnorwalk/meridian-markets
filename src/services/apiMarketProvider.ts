import { symbols } from '../data/symbols'
import { demoMarketProvider } from './demoMarketProvider'
import type {
  Bar,
  MarketDataProvider,
  MarketTick,
  QuoteSnapshot,
  SymbolRecord,
} from '../types/market'

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
    requestId?: string
  }
}

interface ApiStatus {
  configured: boolean
  provider: 'alpaca' | 'demo'
  feed: string
  authMode: string
  endDelayMinutes: number
}

const stockSymbolPattern = /^[A-Z.]+$/

function isStockSymbol(symbol: string) {
  return stockSymbolPattern.test(symbol)
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  })
  const payload = (await response.json()) as T & ApiErrorPayload

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Market API failed with ${response.status}`)
  }

  return payload
}

async function withFallback<T>(request: () => Promise<T>, fallback: () => Promise<T>) {
  try {
    return await request()
  } catch {
    return fallback()
  }
}

function fallbackReason(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Live market data unavailable'
}

function localSearch(query: string) {
  const term = query.trim().toLowerCase()
  if (!term) return symbols

  return symbols.filter((item) =>
    [item.symbol, item.name, item.exchange, item.sector]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
}

function typedTickerRecord(query: string): SymbolRecord | null {
  const symbol = query.trim().toUpperCase()
  if (!isStockSymbol(symbol) || symbol.length < 1 || symbol.length > 6) return null

  return {
    symbol,
    name: `${symbol} ticker`,
    exchange: 'Market',
    sector: 'US Equity',
    assetClass: 'equity',
  }
}

function mergeSearchResults(results: SymbolRecord[], query: string) {
  const typed = typedTickerRecord(query)
  const seen = new Set<string>()
  const merged = [...results]

  if (typed && !merged.some((item) => item.symbol === typed.symbol)) {
    merged.unshift(typed)
  }

  return merged.filter((item) => {
    if (seen.has(item.symbol)) return false
    seen.add(item.symbol)
    return true
  })
}

export async function getApiMarketStatus(): Promise<ApiStatus> {
  return getJson<ApiStatus>('/api/market/status')
}

export function labelFromStatus(status: ApiStatus) {
  if (!status.configured) return demoMarketProvider.label
  const delay =
    status.endDelayMinutes > 0 ? `, ${status.endDelayMinutes}m chart delay` : ''
  return `Alpaca Data API (${status.feed}, ${status.authMode} auth${delay})`
}

export const apiMarketProvider: MarketDataProvider = {
  label: 'Alpaca Data API',

  async listSymbols() {
    return symbols
  },

  async searchSymbols(query) {
    if (!query.trim()) return symbols

    return withFallback(
      async () => {
        const payload = await getJson<{ symbols: SymbolRecord[] }>(
          `/api/market/search?query=${encodeURIComponent(query)}&limit=12`,
        )
        return mergeSearchResults(payload.symbols, query)
      },
      async () => mergeSearchResults(localSearch(query), query),
    )
  },

  async getBars(symbol, timeframe) {
    if (!isStockSymbol(symbol)) return demoMarketProvider.getBars(symbol, timeframe)

    return withFallback(
      async () => {
        const payload = await getJson<{ bars: Bar[] }>(
          `/api/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`,
        )
        return payload.bars
      },
      () => demoMarketProvider.getBars(symbol, timeframe),
    )
  },

  async getSnapshot(symbol, timeframe) {
    if (!isStockSymbol(symbol)) {
      const snapshot = await demoMarketProvider.getSnapshot(symbol, timeframe)
      return { ...snapshot, fallbackReason: 'Demo feed for unsupported symbol format' }
    }

    try {
      const payload = await getJson<{ snapshot: QuoteSnapshot }>(
        `/api/market/snapshot?symbol=${encodeURIComponent(symbol)}`,
      )
      return payload.snapshot
    } catch (reason) {
      const snapshot = await demoMarketProvider.getSnapshot(symbol, timeframe)
      return { ...snapshot, fallbackReason: fallbackReason(reason) }
    }
  },

  subscribe(symbol, timeframe, onTick) {
    if (!isStockSymbol(symbol)) {
      return demoMarketProvider.subscribe(symbol, timeframe, onTick)
    }

    let isActive = true
    let currentBars: Bar[] = []

    const publishTick = async () => {
      const snapshot = await this.getSnapshot(symbol, timeframe)
      if (!isActive) return

      if (currentBars.length === 0) {
        currentBars = await this.getBars(symbol, timeframe)
      }

      const previousBar = currentBars[currentBars.length - 1]
      const lastBar: Bar = previousBar
        ? {
            ...previousBar,
            close: snapshot.price,
            high: Math.max(previousBar.high, snapshot.price),
            low: Math.min(previousBar.low, snapshot.price),
            volume: Math.max(previousBar.volume, snapshot.volume),
          }
        : {
            time: Math.floor(snapshot.updatedAt / 1000),
            open: snapshot.price,
            high: snapshot.price,
            low: snapshot.price,
            close: snapshot.price,
            volume: snapshot.volume,
          }

      if (currentBars.length > 0) {
        currentBars[currentBars.length - 1] = lastBar
      } else {
        currentBars = [lastBar]
      }

      const tick: MarketTick = { snapshot, lastBar }
      onTick(tick)
    }

    publishTick().catch(() => undefined)
    const interval = window.setInterval(() => {
      publishTick().catch(() => undefined)
    }, 6000)

    return () => {
      isActive = false
      window.clearInterval(interval)
    }
  },
}
