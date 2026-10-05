export type AssetClass = 'equity' | 'etf' | 'crypto'

export type Timeframe = '1D' | '1W' | '1M' | '6M' | '1Y'

export type TrendingPeriod = 'day' | 'week' | 'month'

export type MarketStatus = 'open' | 'closed' | 'simulated'

export type OptionType = 'call' | 'put'

export interface SymbolRecord {
  symbol: string
  name: string
  exchange: string
  sector: string
  assetClass: AssetClass
}

export interface WatchlistRecord {
  id: string
  name: string
  items: SymbolRecord[]
  createdAt: string
  updatedAt: string
}

export interface PortfolioHolding {
  id: string
  symbol: string
  name: string
  exchange: string
  sector: string
  assetClass: AssetClass
  shares: number
  averageCost: number
  targetWeight: number
  notes: string
  createdAt: string
  updatedAt: string
}

export type PortfolioHoldingInput = Omit<
  PortfolioHolding,
  'id' | 'createdAt' | 'updatedAt'
>

export interface AlertSettings {
  driftPercent: number
  concentrationPercent: number
  dayMovePercent: number
}

export interface Bar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface QuoteSnapshot {
  symbol: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  bid: number
  ask: number
  volume: number
  updatedAt: number
  marketStatus: MarketStatus
  source?: 'alpaca' | 'demo'
  fallbackReason?: string
}

export interface MarketTick {
  snapshot: QuoteSnapshot
  lastBar: Bar
}

export interface NewsItem {
  id: number
  headline: string
  summary: string
  source: string
  url: string
  createdAt: string
  symbols: string[]
  images: { url: string; size: string }[]
}

export interface TrendingItem extends SymbolRecord {
  rank: number
  price: number
  change: number
  changePercent: number
  volume: number
  source: string
}

export interface TrendingResponse {
  period: TrendingPeriod
  label: string
  source: string
  updatedAt: number
  items: TrendingItem[]
}

export interface OptionContract {
  symbol: string
  underlying: string
  type: OptionType
  strike: number
  expirationDate: string
  bid: number | null
  ask: number | null
  mid: number | null
  last: number | null
  volume: number | null
  openInterest: number | null
  impliedVolatility: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  rho: number | null
  updatedAt: number
}

export interface OptionChainResponse {
  symbol: string
  source: string
  updatedAt: number
  expirations: string[]
  contracts: OptionContract[]
  requestId?: string | null
  nextPageToken?: string | null
  fallbackReason?: string
}

export type StrategyInstrument = 'equity' | 'option'

export type StrategyType = 'trend_breakout' | 'mean_reversion' | 'moving_average_cross'

export type OptionStrategyStructure =
  | 'long_call'
  | 'long_put'
  | 'covered_call'
  | 'cash_secured_put'
  | 'bull_call_spread'
  | 'bear_put_spread'
  | 'iron_condor'

export interface StrategyConfig {
  symbol: string
  timeframe: Timeframe
  instrument: StrategyInstrument
  strategyType: StrategyType
  optionStructure: OptionStrategyStructure
  startingCapital: number
  riskPerTradePercent: number
  maxPositionPercent: number
  maxDailyLossPercent: number
  maxDrawdownPercent: number
  stopLossPercent: number
}

export interface StrategyMetricSet {
  startingCapital: number
  endingCapital: number
  totalReturnPercent: number
  maxDrawdownPercent: number
  winRatePercent: number
  tradeCount: number
  profitFactor: number
  averageTrade: number
  exposurePercent: number
}

export interface StrategyTrade {
  id: string
  symbol: string
  instrument: StrategyInstrument
  optionStructure: OptionStrategyStructure | null
  entryTime: number
  exitTime: number
  entryPrice: number
  exitPrice: number
  quantity: number
  contracts: number
  profit: number
  profitPercent: number
  reason: string
}

export interface StrategyEquityPoint {
  time: number
  equity: number
  close: number
}

export interface StrategyAuditEntry {
  id?: string
  deploymentId?: string | null
  eventType: string
  message: string
  payload?: Record<string, unknown>
  createdAt: string
}

export interface StrategyBacktestResponse {
  config: StrategyConfig
  data: {
    source: string
    fallbackReason?: string
    requestId?: string | null
    barCount: number
  }
  metrics: StrategyMetricSet
  trades: StrategyTrade[]
  equityCurve: StrategyEquityPoint[]
  audit: StrategyAuditEntry[]
  generatedAt: number
}

export interface StrategyHealthCheck {
  key: string
  label: string
  status: 'ok' | 'demo' | 'error' | 'unavailable'
  detail: string
}

export interface StrategyHealthResponse {
  provider: {
    configured: boolean
    provider: string
    feed: string
    optionsFeed: string
    authMode: string
    endDelayMinutes: number
    baseUrl: string
  }
  clock: {
    status: string
    message: string
    isOpen: boolean | null
    nextOpen?: string | null
    nextClose?: string | null
  }
  options: {
    symbol: string
    source: string
    live: boolean
    contracts: number
    fallbackReason?: string
    optionsFeed: string
  }
  killSwitch: StrategyKillSwitch
  checks: StrategyHealthCheck[]
  updatedAt: number
}

export interface StrategyKillSwitch {
  enabled: boolean
  reason: string
  updatedAt: string | null
}

export interface PaperDeployment {
  id: string
  config: StrategyConfig
  metrics: StrategyMetricSet | null
  status: 'running' | 'blocked' | 'paused' | 'stopped'
  mode: 'paper'
  riskState: {
    status: 'clear' | 'warning'
    warnings: string[]
  }
  createdAt: string
  updatedAt: string
  nextReviewAt: string
}

export interface StrategyMonitorResponse {
  deployments: PaperDeployment[]
  audit: StrategyAuditEntry[]
  killSwitch: StrategyKillSwitch
  updatedAt: number
}

export interface StrategyCopilotResponse {
  draft: StrategyConfig
  title: string
  rationale: string[]
  warnings: string[]
}

export interface SparklinePoint {
  t: string
  c: number
}

export interface MarketDataProvider {
  label: string
  listSymbols: () => Promise<SymbolRecord[]>
  searchSymbols: (query: string) => Promise<SymbolRecord[]>
  getBars: (symbol: string, timeframe: Timeframe) => Promise<Bar[]>
  getSnapshot: (symbol: string, timeframe: Timeframe) => Promise<QuoteSnapshot>
  subscribe: (
    symbol: string,
    timeframe: Timeframe,
    onTick: (tick: MarketTick) => void,
  ) => () => void
}
