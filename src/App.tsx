import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import {
  Activity,
  Bell,
  Check,
  CornerDownLeft,
  Download,
  LogOut,
  LoaderCircle,
  Moon,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sun,
  Target,
  Trash2,
  Upload,
  User,
  Wifi,
  X,
} from 'lucide-react'
import './App.css'
import AuthScreen from './components/AuthScreen'
import { MarketChart } from './components/MarketChart'
import { Metric } from './components/Metric'
import { NewsFeed } from './components/NewsFeed'
import { OptionsPanel } from './components/OptionsPanel'
import { SearchResultRow } from './components/SearchResultRow'
import { SortableWatchlistRow } from './components/SortableWatchlistRow'
import { StrategyLab } from './components/StrategyLab'
import { StockScreener } from './components/StockScreener'
import { TrendingPanel } from './components/TrendingPanel'
import { TradingChat } from './components/TradingChat'
import { InstallPrompt } from './components/InstallPrompt'
import { defaultWatchlist } from './data/symbols'
import { useMarketData } from './hooks/useMarketData'
import {
  getCurrentUser,
  logoutUser,
  type AuthUser,
} from './services/userApi'
import type {
  PortfolioHolding,
  PortfolioHoldingInput,
  SymbolRecord,
  Timeframe,
} from './types/market'
import {
  buildPortfolioCsv,
  buildVisibleRangeQuote,
  compactFormatter,
  formatChange,
  formatPlainPercent,
  formatPrice,
  formatSignedCurrency,
  formatSignedPercent,
  formatTimeAgo,
  parsePortfolioCsv,
  parseCsvNumber,
  percentFormatter,
  toneFromValue,
} from './utils/format'

const timeframes: Timeframe[] = ['1D', '1W', '1M', '6M', '1Y']
const searchListboxId = 'symbol-search-results'
type WatchlistSort = 'manual' | 'changePercent' | 'changeDollar' | 'price' | 'symbol'
type WatchlistFilter = 'all' | 'gainers' | 'losers'
type PortfolioSort = 'value' | 'gainPercent' | 'dayChange' | 'allocation' | 'drift' | 'symbol'
type InsightTab = 'trending' | 'news' | 'movement' | 'options' | 'strategy' | 'chat' | 'screener'
type PortfolioAlert = {
  label: string
  value: string
  detail: string
  tone?: 'positive' | 'negative'
}
type ConfirmAction =
  | { type: 'remove-watchlist-symbol'; symbol: string }
  | { type: 'delete-watchlist'; id: string; name: string }
  | { type: 'remove-holding'; id: string; symbol: string }
type LayoutSettingKey = 'watchlistWidth' | 'detailsWidth' | 'chartHeight' | 'watchlistHeight'
type LayoutSettings = Record<LayoutSettingKey, number>
type NotificationItem = {
  id: string
  title: string
  body: string
  severity: string
  read: boolean
  createdAt: string
}

const emptyPortfolioDraft = {
  symbol: '',
  shares: '',
  averageCost: '',
  targetWeight: '',
  notes: '',
}

const emptyAlertDraft = {
  driftPercent: '',
  concentrationPercent: '',
  dayMovePercent: '',
}

const layoutStorageKey = 'meridian-layout-settings-v3'
const defaultLayoutSettings: LayoutSettings = {
  watchlistWidth: 340,
  detailsWidth: 240,
  chartHeight: 360,
  watchlistHeight: 450,
}
const layoutRanges: Record<LayoutSettingKey, { min: number; max: number; step: number; label: string }> = {
  watchlistWidth: { min: 220, max: 420, step: 10, label: 'Watchlist' },
  detailsWidth: { min: 210, max: 340, step: 10, label: 'Details' },
  chartHeight: { min: 320, max: 520, step: 10, label: 'Chart' },
  watchlistHeight: { min: 360, max: 680, step: 10, label: 'Rows' },
}

function clampLayoutValue(key: LayoutSettingKey, value: number) {
  const range = layoutRanges[key]
  if (!Number.isFinite(value)) return defaultLayoutSettings[key]
  return Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step))
}

function readLayoutSettings(): LayoutSettings {
  if (typeof window === 'undefined') return defaultLayoutSettings

  try {
    const parsed = JSON.parse(window.localStorage?.getItem(layoutStorageKey) ?? '{}') as Partial<LayoutSettings>
    return {
      watchlistWidth: clampLayoutValue('watchlistWidth', Number(parsed.watchlistWidth)),
      detailsWidth: clampLayoutValue('detailsWidth', Number(parsed.detailsWidth)),
      chartHeight: clampLayoutValue('chartHeight', Number(parsed.chartHeight)),
      watchlistHeight: clampLayoutValue('watchlistHeight', Number(parsed.watchlistHeight)),
    }
  } catch {
    return defaultLayoutSettings
  }
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolRecord[]>([])
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const [selectedSearchRecord, setSelectedSearchRecord] = useState<SymbolRecord | null>(null)
  const [watchlistEditorMode, setWatchlistEditorMode] = useState<'create' | 'rename' | null>(null)
  const [watchlistNameDraft, setWatchlistNameDraft] = useState('')
  const [watchlistUiError, setWatchlistUiError] = useState<string | null>(null)
  const [watchlistSort, setWatchlistSort] = useState<WatchlistSort>('manual')
  const [watchlistFilter, setWatchlistFilter] = useState<WatchlistFilter>('all')
  const [portfolioDraft, setPortfolioDraft] = useState(emptyPortfolioDraft)
  const [portfolioSort, setPortfolioSort] = useState<PortfolioSort>('value')
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null)
  const [portfolioUiError, setPortfolioUiError] = useState<string | null>(null)
  const [portfolioUiMessage, setPortfolioUiMessage] = useState<string | null>(null)
  const [isAlertEditorOpen, setIsAlertEditorOpen] = useState(false)
  const [alertDraft, setAlertDraft] = useState(emptyAlertDraft)
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false)
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>(() => readLayoutSettings())
  const [activeInsightTab, setActiveInsightTab] = useState<InsightTab>('trending')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const portfolioImportRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [marketClock, setMarketClock] = useState<{ isOpen: boolean; timestamp: string | null; nextOpen: string | null; nextClose: string | null } | null>(null)
  const [marketClockError, setMarketClockError] = useState<string | null>(null)
  const [sparklines, setSparklines] = useState<Record<string, { t: string; c: number }[]>>({})
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('meridian-dark-mode')
    if (stored !== null) return stored === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', isDarkMode)
    localStorage.setItem('meridian-dark-mode', String(isDarkMode))
  }, [isDarkMode])

  useEffect(() => {
    let isMounted = true
    const fetchClock = () => fetch('/api/market/clock')
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || typeof payload.isOpen !== 'boolean') {
          throw new Error(payload.error?.message ?? 'Market hours unavailable')
        }
        return payload
      })
      .then((payload) => {
        if (!isMounted) return
        setMarketClock(payload)
        setMarketClockError(null)
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setMarketClock(null)
        setMarketClockError(reason instanceof Error ? reason.message : 'Market hours unavailable')
      })
    fetchClock()
    const interval = window.setInterval(fetchClock, 60000)
    return () => { isMounted = false; window.clearInterval(interval) }
  }, [])

  useEffect(() => {
    try {
      window.localStorage?.setItem(layoutStorageKey, JSON.stringify(layoutSettings))
    } catch {
      // Layout persistence is optional; the controls still work for the current session.
    }
  }, [layoutSettings])

  const layoutStyle = useMemo(
    () => ({
      '--layout-watchlist-width': `${layoutSettings.watchlistWidth}px`,
      '--layout-details-width': `${layoutSettings.detailsWidth}px`,
      '--layout-chart-height': `${layoutSettings.chartHeight}px`,
      '--layout-watchlist-height': `${layoutSettings.watchlistHeight}px`,
    }) as CSSProperties,
    [layoutSettings],
  )

  const updateLayoutSetting = (key: LayoutSettingKey, value: string) => {
    setLayoutSettings((current) => ({
      ...current,
      [key]: clampLayoutValue(key, Number(value)),
    }))
  }

  const resetLayoutSettings = () => {
    setLayoutSettings(defaultLayoutSettings)
  }

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    globalThis.addEventListener('keydown', handler)
    return () => globalThis.removeEventListener('keydown', handler)
  }, [])

  const watchlistDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const {
    providerLabel,
    symbols,
    watchlists,
    activeWatchlist,
    activeWatchlistId,
    watchlist,
    portfolio,
    alertSettings,
    selectedRecord,
    selectedSymbol,
    setSelectedSymbol,
    timeframe,
    setTimeframe,
    bars,
    snapshot,
    watchlistSnapshots,
    isLoading,
    error,
    refresh,
    searchSymbols,
    watchlistError,
    portfolioError,
    addPortfolioHolding,
    addToWatchlist,
    createWatchlist,
    deleteWatchlist,
    removeFromWatchlist,
    renameWatchlist,
    removePortfolioHolding,
    reorderWatchlistItems,
    setActiveWatchlist,
    updateAlertSettings,
    updatePortfolioHolding,
  } = useMarketData(Boolean(authUser))

  const [lastRefreshTime, setLastRefreshTime] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notifUnreadCount, setNotifUnreadCount] = useState(0)
  const [notifLoading, setNotifLoading] = useState(false)
  const [performanceData, setPerformanceData] = useState<{ snapshots: { date: string; totalValue: number }[]; metrics: Record<string, number> | null } | null>(null)

  useEffect(() => {
    if (!authUser) return
    const fetchUnread = () => {
      fetch('/api/notifications/unread-count').then((r) => r.json()).then((d) => {
        if (typeof d?.unreadCount === 'number') {
          if (!authUser) return
          setNotifUnreadCount(d.unreadCount)
        }
      }).catch(() => {})
    }
    fetchUnread()
    const interval = window.setInterval(fetchUnread, 30000)
    return () => window.clearInterval(interval)
  }, [authUser])

  useEffect(() => {
    if (!authUser) return
    fetch('/api/notifications/evaluate', { method: 'POST' }).then((r) => r.json()).catch(() => {})
  }, [authUser])

  useEffect(() => {
    if (!authUser) return
    let cancelled = false
    fetch('/api/portfolio/performance?days=365').then((r) => r.json()).then((d) => {
      if (!cancelled) setPerformanceData(d)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authUser])

  useEffect(() => {
    if (isLoading) return undefined
    const timeout = window.setTimeout(() => setLastRefreshTime(Date.now()), 0)
    return () => window.clearTimeout(timeout)
  }, [isLoading])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let isMounted = true

    getCurrentUser()
      .then((payload) => {
        if (isMounted) setAuthUser(payload.user)
      })
      .finally(() => {
        if (isMounted) setIsAuthLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const trimmedQuery = query.trim()

    if (!trimmedQuery) {
      return () => {
        isMounted = false
      }
    }

    const timeout = window.setTimeout(() => {
      searchSymbols(trimmedQuery)
        .then((items) => {
          if (!isMounted) return
          setResults(items.slice(0, 12))
          setActiveResultIndex(0)
          setSearchError(null)
        })
        .catch((reason: unknown) => {
          if (!isMounted) return
          setResults([])
          setSearchError(
            reason instanceof Error ? reason.message : 'Symbol search failed',
          )
        })
        .finally(() => {
          if (isMounted) setIsSearchLoading(false)
        })
    }, 120)

    return () => {
      isMounted = false
      window.clearTimeout(timeout)
    }
  }, [query, searchSymbols])

  const watchlistSymbols = authUser ? watchlist : symbols.filter((item) => defaultWatchlist.includes(item.symbol))
  const displayedWatchlistSymbols = useMemo(() => {
    const filteredSymbols = watchlistSymbols.filter((item) => {
      const changePercent = watchlistSnapshots[item.symbol]?.changePercent ?? 0
      if (watchlistFilter === 'gainers') return changePercent > 0
      if (watchlistFilter === 'losers') return changePercent < 0
      return true
    })

    if (watchlistSort === 'manual') return filteredSymbols

    return filteredSymbols.slice().sort((left, right) => {
      const leftSnapshot = watchlistSnapshots[left.symbol]
      const rightSnapshot = watchlistSnapshots[right.symbol]
      if (watchlistSort === 'symbol') return left.symbol.localeCompare(right.symbol)
      if (watchlistSort === 'price') return (rightSnapshot?.price ?? 0) - (leftSnapshot?.price ?? 0)
      if (watchlistSort === 'changeDollar') return (rightSnapshot?.change ?? 0) - (leftSnapshot?.change ?? 0)
      return (rightSnapshot?.changePercent ?? 0) - (leftSnapshot?.changePercent ?? 0)
    })
  }, [watchlistFilter, watchlistSnapshots, watchlistSort, watchlistSymbols])

  const watchlistSymbolsList = useMemo(
    () => Array.from(new Set(displayedWatchlistSymbols.map((symbol) => symbol.symbol))),
    [displayedWatchlistSymbols],
  )
  useEffect(() => {
    if (watchlistSymbolsList.length === 0) return
    let isMounted = true
    fetch(`/api/market/sparklines?symbols=${watchlistSymbolsList.join(',')}`)
      .then((r) => r.json())
      .then((d) => { if (isMounted) setSparklines(d.sparklines ?? {}) })
      .catch(() => {})
    return () => { isMounted = false }
  }, [watchlistSymbolsList])

  const isWatchlistReorderEnabled = watchlistSort === 'manual' && watchlistFilter === 'all'
  const watchlistCountLabel =
    displayedWatchlistSymbols.length === watchlistSymbols.length
      ? String(watchlistSymbols.length)
      : `${displayedWatchlistSymbols.length}/${watchlistSymbols.length}`
  const activeRecord =
    selectedRecord ??
    (selectedSearchRecord?.symbol === selectedSymbol ? selectedSearchRecord : null)
  const selectedWatchlistRecord = activeRecord ?? {
    symbol: selectedSymbol,
    name: `${selectedSymbol} ticker`,
    exchange: 'Market',
    sector: 'US Equity',
    assetClass: 'equity' as const,
  }
  const isSelectedInWatchlist = watchlistSymbols.some(
    (item) => item.symbol === selectedWatchlistRecord.symbol,
  )
  const selectedPortfolioHolding =
    portfolio.find((holding) => holding.symbol === selectedSymbol) ?? null
  const selectedSnapshot = snapshot?.symbol === selectedSymbol ? snapshot : null
  const selectedCachedSnapshot = watchlistSnapshots[selectedSymbol] ?? null
  const selectedBars = selectedSnapshot ? bars : []
  const selectedQuoteSnapshot = selectedSnapshot ?? selectedCachedSnapshot
  const isSimulatedQuote = selectedQuoteSnapshot?.marketStatus === 'simulated'
  const providerDisplayLabel =
    isSimulatedQuote && !providerLabel.toLowerCase().includes('demo')
      ? `${providerLabel} · demo fallback`
      : providerLabel
  function getDataAge(refreshTime: number, currentTime: number): string {
    const diff = currentTime - refreshTime
    if (diff < 120000) return 'fresh'
    if (diff < 300000) return 'stale'
    return 'ancient'
  }

  const statusMetricValue = isSimulatedQuote
    ? 'Simulated data'
    : marketClock
      ? (marketClock.isOpen ? 'Market open' : 'Market closed')
      : marketClockError
        ? 'Hours unavailable'
        : '--'
  const visibleQuote = buildVisibleRangeQuote(selectedQuoteSnapshot, selectedBars)
  const selectedTone =
    visibleQuote && visibleQuote.changePercent < 0
      ? 'negative'
      : visibleQuote && visibleQuote.changePercent > 0
        ? 'positive'
        : undefined
  const dailyHigh = selectedBars.reduce((high, bar) => Math.max(high, bar.high), 0)
  const dailyLow = selectedBars.reduce((low, bar) => Math.min(low, bar.low), selectedBars[0]?.low ?? 0)
  const week52High = selectedBars.reduce((high, bar) => Math.max(high, bar.high), 0)
  const week52Low = selectedBars.reduce((low, bar) => Math.min(low, bar.low), selectedBars[0]?.low ?? 0)
  const recentBars = selectedBars.slice(-6)
  const trimmedQuery = query.trim()
  const activeResult = results[activeResultIndex] ?? results[0]
  const portfolioBasePositions = useMemo(
    () =>
      portfolio.map((holding) => {
        const holdingSnapshot = watchlistSnapshots[holding.symbol]
        const price = holdingSnapshot?.price ?? holding.averageCost
        const previousClose = holdingSnapshot?.previousClose ?? price
        const marketValue = holding.shares * price
        const costBasis = holding.shares * holding.averageCost
        const gain = marketValue - costBasis
        const dayChange = holding.shares * (price - previousClose)
        return {
          holding,
          snapshot: holdingSnapshot,
          price,
          marketValue,
          costBasis,
          gain,
          gainPercent: costBasis === 0 ? 0 : (gain / costBasis) * 100,
          dayChange,
        }
      }),
    [portfolio, watchlistSnapshots],
  )
  const portfolioSummary = useMemo(() => {
    const totalValue = portfolioBasePositions.reduce((total, item) => total + item.marketValue, 0)
    const totalCost = portfolioBasePositions.reduce((total, item) => total + item.costBasis, 0)
    const totalGain = totalValue - totalCost
    const dayChange = portfolioBasePositions.reduce((total, item) => total + item.dayChange, 0)
    const priorValue = totalValue - dayChange
    const targetWeightTotal = portfolioBasePositions.reduce(
      (total, item) => total + (item.holding.targetWeight ?? 0),
      0,
    )
    const targetGap = 100 - targetWeightTotal
    return {
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent: totalCost === 0 ? 0 : (totalGain / totalCost) * 100,
      dayChange,
      dayChangePercent: priorValue === 0 ? 0 : (dayChange / priorValue) * 100,
      targetWeightTotal,
      targetGap,
    }
  }, [portfolioBasePositions])
  const portfolioPositions = useMemo(() => {
    const enrichedPositions = portfolioBasePositions.map((position) => {
      const targetWeight = position.holding.targetWeight ?? 0
      const allocation =
        portfolioSummary.totalValue === 0
          ? 0
          : (position.marketValue / portfolioSummary.totalValue) * 100
      const hasTarget = targetWeight > 0
      const priorValue = position.marketValue - position.dayChange

      return {
        ...position,
        allocation,
        targetWeight,
        hasTarget,
        drift: hasTarget ? allocation - targetWeight : 0,
        dayChangePercent: priorValue === 0 ? 0 : (position.dayChange / priorValue) * 100,
      }
    })

    return enrichedPositions.slice().sort((left, right) => {
      if (portfolioSort === 'symbol') return left.holding.symbol.localeCompare(right.holding.symbol)
      if (portfolioSort === 'gainPercent') return right.gainPercent - left.gainPercent
      if (portfolioSort === 'dayChange') return right.dayChange - left.dayChange
      if (portfolioSort === 'allocation') return right.allocation - left.allocation
      if (portfolioSort === 'drift') return Math.abs(right.drift) - Math.abs(left.drift)
      return right.marketValue - left.marketValue
    })
  }, [portfolioBasePositions, portfolioSort, portfolioSummary.totalValue])
  const portfolioAlerts = useMemo<PortfolioAlert[]>(() => {
    if (portfolioPositions.length === 0) return []

    const alerts: PortfolioAlert[] = []
    const targetGapAbs = Math.abs(portfolioSummary.targetGap)
    const largestDrift = portfolioPositions
      .filter((item) => item.hasTarget)
      .sort((left, right) => Math.abs(right.drift) - Math.abs(left.drift))[0]
    const topExposure = portfolioPositions.reduce((best, item) =>
      item.allocation > best.allocation ? item : best,
    )
    const largestDayMove = portfolioPositions
      .slice()
      .sort((left, right) => Math.abs(right.dayChangePercent) - Math.abs(left.dayChangePercent))[0]

    if (portfolioSummary.targetWeightTotal === 0) {
      alerts.push({
        label: 'Allocation model',
        value: 'No targets',
        detail: 'Add target percentages to unlock drift monitoring.',
      })
    } else if (targetGapAbs > 1) {
      alerts.push({
        label: 'Target model',
        value: portfolioSummary.targetGap > 0
          ? `${formatPlainPercent(portfolioSummary.targetGap)} open`
          : `${formatPlainPercent(targetGapAbs)} over`,
        detail: `${formatPlainPercent(portfolioSummary.targetWeightTotal)} assigned`,
        tone: 'negative',
      })
    }

    if (largestDrift && Math.abs(largestDrift.drift) >= alertSettings.driftPercent) {
      alerts.push({
        label: 'Drift alert',
        value: `${largestDrift.holding.symbol} ${formatSignedPercent(largestDrift.drift)}`,
        detail: `Target ${formatPlainPercent(largestDrift.targetWeight)}`,
        tone: 'negative',
      })
    }

    if (topExposure.allocation >= alertSettings.concentrationPercent) {
      alerts.push({
        label: 'Concentration',
        value: `${topExposure.holding.symbol} ${formatPlainPercent(topExposure.allocation)}`,
        detail: 'Largest single holding exposure.',
        tone: 'negative',
      })
    }

    if (largestDayMove && Math.abs(largestDayMove.dayChangePercent) >= alertSettings.dayMovePercent) {
      alerts.push({
        label: 'Day move',
        value: `${largestDayMove.holding.symbol} ${formatSignedPercent(largestDayMove.dayChangePercent)}`,
        detail: formatSignedCurrency(largestDayMove.dayChange),
        tone: toneFromValue(largestDayMove.dayChangePercent),
      })
    }

    return alerts.slice(0, 4)
  }, [
    alertSettings.concentrationPercent,
    alertSettings.dayMovePercent,
    alertSettings.driftPercent,
    portfolioPositions,
    portfolioSummary.targetGap,
    portfolioSummary.targetWeightTotal,
  ])
  const portfolioInsights = useMemo(() => {
    if (portfolioPositions.length === 0) return []

    const topExposure = portfolioPositions.reduce((best, item) =>
      item.allocation > best.allocation ? item : best,
    )
    const bestGain = portfolioPositions.reduce((best, item) =>
      item.gainPercent > best.gainPercent ? item : best,
    )
    const largestDrift = portfolioPositions
      .filter((item) => item.hasTarget)
      .sort((left, right) => Math.abs(right.drift) - Math.abs(left.drift))[0]
    const sectorExposure = Array.from(
      portfolioPositions.reduce((exposures, item) => {
        exposures.set(item.holding.sector, (exposures.get(item.holding.sector) ?? 0) + item.allocation)
        return exposures
      }, new Map<string, number>()),
    ).sort((left, right) => right[1] - left[1])[0]

    return [
      {
        label: 'Top exposure',
        value: `${topExposure.holding.symbol} ${formatPlainPercent(topExposure.allocation)}`,
        detail: topExposure.allocation > 35 ? 'Concentrated' : 'Balanced',
        tone: topExposure.allocation > 35 ? 'negative' : undefined,
      },
      {
        label: 'Best gain',
        value: `${bestGain.holding.symbol} ${formatSignedPercent(bestGain.gainPercent)}`,
        detail: formatSignedCurrency(bestGain.gain),
        tone: toneFromValue(bestGain.gainPercent),
      },
      largestDrift
        ? {
            label: 'Target drift',
            value: `${largestDrift.holding.symbol} ${formatSignedPercent(largestDrift.drift)}`,
            detail: `Target ${formatPlainPercent(largestDrift.targetWeight)}`,
            tone: toneFromValue(-Math.abs(largestDrift.drift)),
          }
        : {
            label: 'Target drift',
            value: 'No targets',
            detail: 'Add target %',
            tone: undefined,
          },
      {
        label: 'Top sector',
        value: sectorExposure
          ? `${sectorExposure[0]} ${formatPlainPercent(sectorExposure[1])}`
          : '--',
        detail: `${portfolioPositions.length} holdings`,
        tone: undefined,
      },
    ]
  }, [portfolioPositions])

  const selectSearchResult = (item: SymbolRecord) => {
    setSelectedSearchRecord(item)
    setSelectedSymbol(item.symbol)
    setQuery('')
    setResults([])
    setSearchError(null)
    setIsSearchLoading(false)
    setIsSearchOpen(false)
    setActiveResultIndex(0)
  }

  const handleAddSearchResultToWatchlist = async (item: SymbolRecord) => {
    try {
      setWatchlistUiError(null)
      await addToWatchlist(item)
    } catch (reason) {
      setWatchlistUiError(reason instanceof Error ? reason.message : 'Watchlist update failed')
    }
  }

  const resolveSymbolRecord = (symbolInput: string): SymbolRecord => {
    const symbol = symbolInput.trim().toUpperCase()
    const existingHolding = portfolio.find((item) => item.symbol === symbol)
    const fallbackRecord =
      selectedRecord?.symbol === symbol
        ? selectedRecord
        : selectedSearchRecord?.symbol === symbol
          ? selectedSearchRecord
          : symbols.find((item) => item.symbol === symbol) ??
            watchlist.find((item) => item.symbol === symbol)

    return fallbackRecord ?? {
      symbol,
      name: existingHolding?.name ?? `${symbol} holding`,
      exchange: existingHolding?.exchange ?? 'Market',
      sector: existingHolding?.sector ?? 'Portfolio',
      assetClass: existingHolding?.assetClass ?? 'equity',
    }
  }

  const buildPortfolioPayload = (
    symbolInput: string,
    values: {
      shares: number
      averageCost: number
      targetWeight: number
      notes: string
      name?: string
      exchange?: string
      sector?: string
      assetClass?: string
    },
  ): PortfolioHoldingInput => {
    const symbolRecord = resolveSymbolRecord(symbolInput)
    let assetClass = symbolRecord.assetClass
    if (
      values.assetClass === 'crypto' ||
      values.assetClass === 'etf' ||
      values.assetClass === 'equity'
    ) {
      assetClass = values.assetClass
    }

    return {
      ...symbolRecord,
      name: values.name || symbolRecord.name,
      exchange: values.exchange || symbolRecord.exchange,
      sector: values.sector || symbolRecord.sector,
      assetClass,
      shares: values.shares,
      averageCost: values.averageCost,
      targetWeight: values.targetWeight,
      notes: values.notes,
    }
  }

  const resetPortfolioDraft = () => {
    setPortfolioDraft(emptyPortfolioDraft)
    setEditingHoldingId(null)
    setPortfolioUiError(null)
    setPortfolioUiMessage(null)
  }

  const submitPortfolioHolding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const symbol = portfolioDraft.symbol.trim().toUpperCase()
    const shares = Number(portfolioDraft.shares)
    const averageCost = Number(portfolioDraft.averageCost)
    const targetWeightText = portfolioDraft.targetWeight.trim()
    const targetWeight = targetWeightText ? Number(targetWeightText) : 0
    const notes = portfolioDraft.notes.trim()

    if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(averageCost) || averageCost <= 0) {
      setPortfolioUiError('Enter a symbol, shares, and average cost.')
      return
    }

    if (!Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 100) {
      setPortfolioUiError('Target must be between 0 and 100%.')
      return
    }

    const holdingPayload = buildPortfolioPayload(symbol, {
      shares,
      averageCost,
      targetWeight,
      notes,
    })

    try {
      setPortfolioUiError(null)
      setPortfolioUiMessage(null)
      if (editingHoldingId) {
        await updatePortfolioHolding(editingHoldingId, holdingPayload)
      } else {
        await addPortfolioHolding(holdingPayload)
      }
      resetPortfolioDraft()
    } catch (reason) {
      setPortfolioUiError(reason instanceof Error ? reason.message : 'Portfolio update failed')
    }
  }

  const beginEditHolding = (holding: PortfolioHolding) => {
    setPortfolioUiError(null)
    setPortfolioUiMessage(null)
    setEditingHoldingId(holding.id)
    setPortfolioDraft({
      symbol: holding.symbol,
      shares: String(holding.shares),
      averageCost: String(holding.averageCost),
      targetWeight: holding.targetWeight ? String(holding.targetWeight) : '',
      notes: holding.notes ?? '',
    })
  }

  const beginSelectedHolding = () => {
    setPortfolioUiError(null)
    setPortfolioUiMessage(null)
    setEditingHoldingId(null)
    setPortfolioDraft((current) => ({
      ...current,
      symbol: selectedSymbol,
    }))
  }

  const handleRemoveHolding = async (holdingId: string) => {
    const holding = portfolio.find((item) => item.id === holdingId)
    setConfirmAction({
      type: 'remove-holding',
      id: holdingId,
      symbol: holding?.symbol ?? 'holding',
    })
  }

  const removeHoldingNow = async (holdingId: string) => {
    try {
      setPortfolioUiError(null)
      setPortfolioUiMessage(null)
      await removePortfolioHolding(holdingId)
      if (editingHoldingId === holdingId) resetPortfolioDraft()
    } catch (reason) {
      setPortfolioUiError(reason instanceof Error ? reason.message : 'Portfolio remove failed')
    }
  }

  const submitAlertSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const driftPercent = Number(alertDraft.driftPercent)
    const concentrationPercent = Number(alertDraft.concentrationPercent)
    const dayMovePercent = Number(alertDraft.dayMovePercent)

    if (
      !Number.isFinite(driftPercent) ||
      !Number.isFinite(concentrationPercent) ||
      !Number.isFinite(dayMovePercent) ||
      driftPercent < 0 ||
      concentrationPercent < 0 ||
      dayMovePercent < 0 ||
      driftPercent > 100 ||
      concentrationPercent > 100 ||
      dayMovePercent > 100
    ) {
      setPortfolioUiMessage(null)
      setPortfolioUiError('Alert thresholds must be between 0 and 100%.')
      return
    }

    try {
      setPortfolioUiError(null)
      setPortfolioUiMessage(null)
      await updateAlertSettings({
        driftPercent,
        concentrationPercent,
        dayMovePercent,
      })
      setIsAlertEditorOpen(false)
      setPortfolioUiMessage('Alert thresholds saved.')
    } catch (reason) {
      setPortfolioUiError(reason instanceof Error ? reason.message : 'Alert settings failed')
    }
  }

  const toggleAlertEditor = () => {
    setPortfolioUiError(null)
    setPortfolioUiMessage(null)
    if (isAlertEditorOpen) {
      setIsAlertEditorOpen(false)
      return
    }

    setAlertDraft({
      driftPercent: String(alertSettings.driftPercent),
      concentrationPercent: String(alertSettings.concentrationPercent),
      dayMovePercent: String(alertSettings.dayMovePercent),
    })
    setIsAlertEditorOpen(true)
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)

    try {
      if (action.type === 'remove-watchlist-symbol') {
        setWatchlistUiError(null)
        await removeFromWatchlist(action.symbol)
        return
      }

      if (action.type === 'delete-watchlist') {
        setWatchlistUiError(null)
        await deleteWatchlist(action.id)
        cancelWatchlistEditor()
        return
      }

      await removeHoldingNow(action.id)
    } catch (reason) {
      if (action.type === 'remove-holding') {
        setPortfolioUiError(reason instanceof Error ? reason.message : 'Portfolio remove failed')
      } else {
        setWatchlistUiError(reason instanceof Error ? reason.message : 'Watchlist update failed')
      }
    }
  }

  const handlePortfolioExport = () => {
    if (portfolio.length === 0) {
      setPortfolioUiError('Add a holding before exporting.')
      return
    }

    const blob = new Blob([buildPortfolioCsv(portfolio)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `meridian-portfolio-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setPortfolioUiError(null)
    setPortfolioUiMessage(`${portfolio.length} holdings exported.`)
  }

  const handlePortfolioImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const rows = parsePortfolioCsv(await file.text())
      if (rows.length === 0) throw new Error('CSV did not contain any holdings.')

      let importedCount = 0
      for (const row of rows) {
        const symbol = row.symbol.trim().toUpperCase()
        const shares = parseCsvNumber(row.shares)
        const averageCost = parseCsvNumber(row.averageCost)
        const targetWeight = row.targetWeight ? parseCsvNumber(row.targetWeight) : 0
        const normalizedAssetClass = row.assetClass.trim().toLowerCase()

        if (!symbol) throw new Error(`Line ${row.line}: missing symbol.`)
        if (!Number.isFinite(shares) || shares <= 0) {
          throw new Error(`Line ${row.line}: shares must be greater than 0.`)
        }
        if (!Number.isFinite(averageCost) || averageCost <= 0) {
          throw new Error(`Line ${row.line}: average cost must be greater than 0.`)
        }
        if (!Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 100) {
          throw new Error(`Line ${row.line}: target weight must be between 0 and 100.`)
        }
        if (
          normalizedAssetClass &&
          !['equity', 'etf', 'crypto'].includes(normalizedAssetClass)
        ) {
          throw new Error(`Line ${row.line}: asset class must be equity, etf, or crypto.`)
        }

        await addPortfolioHolding(
          buildPortfolioPayload(symbol, {
            name: row.name,
            exchange: row.exchange,
            sector: row.sector,
            assetClass: normalizedAssetClass,
            shares,
            averageCost,
            targetWeight,
            notes: row.notes,
          }),
        )
        importedCount += 1
      }

      setPortfolioUiError(null)
      resetPortfolioDraft()
      setPortfolioUiMessage(`${importedCount} holdings imported.`)
    } catch (reason) {
      setPortfolioUiMessage(null)
      setPortfolioUiError(reason instanceof Error ? reason.message : 'Portfolio import failed')
    }
  }

  const handleSearchChange = (value: string) => {
    setQuery(value)
    setResults([])
    setSearchError(null)
    setActiveResultIndex(0)

    if (!value.trim()) {
      setResults([])
      setIsSearchLoading(false)
      setIsSearchOpen(false)
      return
    }

    setIsSearchOpen(true)
    setIsSearchLoading(true)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSearchOpen && event.key !== 'Escape') setIsSearchOpen(true)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveResultIndex((current) =>
        results.length ? (current + 1) % results.length : 0,
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveResultIndex((current) =>
        results.length ? (current - 1 + results.length) % results.length : 0,
      )
      return
    }

    if (event.key === 'Enter' && activeResult) {
      event.preventDefault()
      selectSearchResult(activeResult)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      setResults([])
      setSearchError(null)
      setIsSearchLoading(false)
      setIsSearchOpen(false)
    }
  }

  const handleAddSelectedToWatchlist = async () => {
    await addToWatchlist(selectedWatchlistRecord)
  }

  const handleRemoveFromWatchlist = async (symbol: string) => {
    setConfirmAction({ type: 'remove-watchlist-symbol', symbol })
  }

  const beginCreateWatchlist = () => {
    setWatchlistUiError(null)
    setWatchlistEditorMode('create')
    setWatchlistNameDraft(`List ${watchlists.length + 1}`)
  }

  const beginRenameWatchlist = () => {
    if (!activeWatchlist) return
    setWatchlistUiError(null)
    setWatchlistEditorMode('rename')
    setWatchlistNameDraft(activeWatchlist.name)
  }

  const cancelWatchlistEditor = () => {
    setWatchlistEditorMode(null)
    setWatchlistNameDraft('')
    setWatchlistUiError(null)
  }

  const submitWatchlistEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = watchlistNameDraft.trim()
    if (!name) {
      setWatchlistUiError('Name the watchlist first.')
      return
    }

    try {
      setWatchlistUiError(null)
      if (watchlistEditorMode === 'create') {
        await createWatchlist(name)
      } else if (watchlistEditorMode === 'rename' && activeWatchlist) {
        await renameWatchlist(activeWatchlist.id, name)
      }
      cancelWatchlistEditor()
    } catch (reason) {
      setWatchlistUiError(reason instanceof Error ? reason.message : 'Watchlist update failed')
    }
  }

  const handleDeleteWatchlist = async () => {
    if (!activeWatchlist || watchlists.length <= 1) return
    setConfirmAction({
      type: 'delete-watchlist',
      id: activeWatchlist.id,
      name: activeWatchlist.name,
    })
  }

  const handleActiveWatchlistChange = async (watchlistId: string) => {
    try {
      setWatchlistUiError(null)
      await setActiveWatchlist(watchlistId)
      cancelWatchlistEditor()
    } catch (reason) {
      setWatchlistUiError(reason instanceof Error ? reason.message : 'Watchlist switch failed')
    }
  }

  const handleWatchlistDragEnd = async (event: DragEndEvent) => {
    if (!isWatchlistReorderEnabled) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = displayedWatchlistSymbols.findIndex((item) => item.symbol === active.id)
    const newIndex = displayedWatchlistSymbols.findIndex((item) => item.symbol === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const nextSymbols = arrayMove(displayedWatchlistSymbols, oldIndex, newIndex).map(
      (item) => item.symbol,
    )
    try {
      setWatchlistUiError(null)
      await reorderWatchlistItems(nextSymbols)
    } catch (reason) {
      setWatchlistUiError(reason instanceof Error ? reason.message : 'Watchlist reorder failed')
      refresh()
    }
  }

  const handleLogout = async () => {
    await logoutUser()
    setAuthUser(null)
    setShowAuth(false)
  }

  const fetchNotifications = async () => {
    setNotifLoading(true)
    try {
      const r = await fetch('/api/notifications?limit=50')
      const d = await r.json()
      setNotifications(d.notifications ?? [])
      if (typeof d.unreadCount === 'number') setNotifUnreadCount(d.unreadCount)
    } catch { /* notification fetch is best-effort */ } finally { setNotifLoading(false) }
  }

  const markAllNotifRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setNotifUnreadCount(0)
  }

  const markOneNotifRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
    setNotifUnreadCount((c) => Math.max(0, c - 1))
  }

  const formatNotifTime = (iso: string) => {
    const diff = now - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  const confirmCopy = confirmAction
    ? confirmAction.type === 'remove-watchlist-symbol'
      ? {
          title: `Remove ${confirmAction.symbol}?`,
          detail: 'This symbol will leave the active watchlist.',
        }
      : confirmAction.type === 'delete-watchlist'
        ? {
            title: `Delete ${confirmAction.name}?`,
            detail: 'The watchlist and its saved order will be removed.',
          }
        : {
            title: `Remove ${confirmAction.symbol}?`,
            detail: 'This holding will be removed from the portfolio.',
          }
    : null

  if (isAuthLoading) {
    return (
      <main className="auth-shell">
        <div className="auth-loading">Loading workspace</div>
      </main>
    )
  }

  if (!authUser && showAuth) {
    return (
      <main className="auth-shell">
        <AuthScreen onAuth={(user) => { setAuthUser(user); setShowAuth(false) }} />
      </main>
    )
  }

  return (
    <main className="app-shell" style={layoutStyle}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Activity aria-hidden="true" size={18} />
          </span>
          <div>
            <strong>Meridian Markets</strong>
            <small>{providerDisplayLabel}</small>
          </div>
        </div>

        <div className={`search-wrap ${isSearchOpen ? 'is-open' : ''}`}>
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={
              isSearchOpen && activeResult
                ? `search-result-${activeResult.symbol}`
                : undefined
            }
            aria-label="Search symbols (Ctrl+K)"
            aria-controls={searchListboxId}
            aria-expanded={isSearchOpen}
            aria-autocomplete="list"
            autoComplete="off"
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="Search ticker or company (Ctrl+K)"
            role="combobox"
            onBlur={() => {
              window.setTimeout(() => setIsSearchOpen(false), 120)
            }}
            onChange={(event) => handleSearchChange(event.target.value)}
            onFocus={() => {
              if (trimmedQuery) setIsSearchOpen(true)
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {query && (
            <button
              aria-label="Clear search"
              className="search-clear"
              onClick={() => handleSearchChange('')}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          )}
          {isSearchOpen && trimmedQuery && (
            <div className="search-results" id={searchListboxId} role="listbox">
              <div className="search-panel-header">
                <span>{isSearchLoading ? 'Searching Alpaca assets' : `${results.length} matches`}</span>
                <small>
                  {isSearchLoading ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={14} />
                  ) : (
                    <>
                      Enter
                      <CornerDownLeft aria-hidden="true" size={13} />
                    </>
                  )}
                </small>
              </div>

              {results.map((item, index) => (
                <div key={item.symbol}>
                  <SearchResultRow
                    item={item}
                    resultId={`search-result-${item.symbol}`}
                    isActive={index === activeResultIndex}
                    isInWatchlist={!authUser || watchlistSymbols.some((symbol) => symbol.symbol === item.symbol)}
                    onActive={() => setActiveResultIndex(index)}
                    onAddToWatchlist={authUser ? handleAddSearchResultToWatchlist : undefined}
                    onSelect={selectSearchResult}
                  />
                </div>
              ))}

              {!isSearchLoading && searchError && (
                <div className="search-empty">{searchError}</div>
              )}

              {!isSearchLoading && !searchError && results.length === 0 && (
                <div className="search-empty">No matching Alpaca assets</div>
              )}
            </div>
          )}
        </div>

        <nav className="top-actions" aria-label="Market tools">
          {authUser ? (
            <>
              <span className="account-chip">
                <User aria-hidden="true" size={14} />
                {authUser.username}
              </span>
              <span style={{ position: 'relative' }}>
                <button type="button" className="notif-trigger" title="Notifications" onClick={() => { setNotifPanelOpen((c) => !c); if (!notifPanelOpen) fetchNotifications() }}>
                  <Bell aria-hidden="true" size={16} />
                  {notifUnreadCount > 0 && <span className="notif-badge">{notifUnreadCount > 99 ? '99+' : notifUnreadCount}</span>}
                </button>
                {notifPanelOpen && (
                  <div className={`notif-panel ${notifLoading ? '' : 'notif-loaded'}`}>
                    <div className="notif-panel-header">
                      <span>Notifications</span>
                      <div className="notif-panel-header-actions">
                        {notifUnreadCount > 0 && <button type="button" onClick={markAllNotifRead}>Mark all read</button>}
                        <button type="button" onClick={() => { setNotifPanelOpen(false) }}><X size={14} /></button>
                      </div>
                    </div>
                    <div className="notif-list">
                      {notifications.length === 0 && !notifLoading && <div className="notif-empty">No notifications yet</div>}
                      {notifications.map((n) => (
                        <div key={n.id} className={`notif-item ${n.read ? '' : 'notif-item-unread'} notif-severity-${n.severity}`} onClick={() => { if (!n.read) markOneNotifRead(n.id); setNotifPanelOpen(false) }}>
                          <span className="notif-icon">{n.severity === 'warning' ? '⚠' : 'ℹ'}</span>
                          <div className="notif-body">
                            <div className="notif-title">{n.title}</div>
                            {n.body && <div className="notif-detail">{n.body}</div>}
                            <div className="notif-time">{formatNotifTime(n.createdAt)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </span>
              <button type="button" title="Sign out" onClick={handleLogout}>
                <LogOut aria-hidden="true" size={17} />
              </button>
            </>
          ) : (
            <button type="button" title="Sign in" onClick={() => setShowAuth(true)}>
              <User aria-hidden="true" size={17} />
              Sign in
            </button>
          )}
          <button type="button" title={isDarkMode ? 'Light mode' : 'Dark mode'} onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
          </button>
          <InstallPrompt />
          <button
            aria-label="Layout controls"
            aria-pressed={isLayoutEditorOpen}
            className={isLayoutEditorOpen ? 'is-active' : undefined}
            onClick={() => setIsLayoutEditorOpen((current) => !current)}
            title="Layout controls"
            type="button"
          >
            <PanelLeft aria-hidden="true" size={17} />
          </button>
          <button type="button" title="Refresh" onClick={refresh}>
            <RefreshCcw aria-hidden="true" size={17} />
          </button>
        </nav>
      </header>

      {isLayoutEditorOpen && (
        <section className="layout-panel" aria-label="Layout controls">
          <div className="layout-panel-heading">
            <span>Layout</span>
            <small>{layoutSettings.watchlistWidth}/{layoutSettings.detailsWidth}</small>
          </div>
          {(Object.keys(layoutRanges) as LayoutSettingKey[]).map((key) => {
            const range = layoutRanges[key]
            return (
              <label className="layout-control" key={key}>
                <span>{range.label}</span>
                <input
                  aria-label={`${range.label} size`}
                  max={range.max}
                  min={range.min}
                  onChange={(event) => updateLayoutSetting(key, event.target.value)}
                  onInput={(event) => updateLayoutSetting(key, event.currentTarget.value)}
                  step={range.step}
                  type="range"
                  value={layoutSettings[key]}
                />
                <em>{layoutSettings[key]}</em>
              </label>
            )
          })}
          <button aria-label="Reset layout" onClick={resetLayoutSettings} title="Reset layout" type="button">
            <RotateCcw aria-hidden="true" size={14} />
            Reset
          </button>
        </section>
      )}

      {confirmCopy && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm action">
          <span>
            <strong>{confirmCopy.title}</strong>
            <small>{confirmCopy.detail}</small>
          </span>
          <button
            aria-label="Cancel action"
            onClick={() => setConfirmAction(null)}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Cancel
          </button>
          <button
            aria-label="Confirm action"
            className="confirm-danger"
            onClick={() => void executeConfirmedAction()}
            type="button"
          >
            <Check aria-hidden="true" size={14} />
            Confirm
          </button>
        </div>
      )}

      <section className="dashboard-grid">
        <aside className="watchlist-pane" aria-label="Watchlist">
          <div className="pane-heading watchlist-heading">
            <div className="watchlist-title">
              <span>Watchlist</span>
              {authUser && watchlists.length > 0 ? (
                <select
                  aria-label="Active watchlist"
                  className="watchlist-select"
                  onChange={(event) => handleActiveWatchlistChange(event.target.value)}
                  value={activeWatchlistId}
                >
                  {watchlists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong className="watchlist-static-name">
                  {activeWatchlist?.name ?? 'Core'}
                </strong>
              )}
            </div>
            <div className="watchlist-tools">
              <small>{watchlistCountLabel}</small>
              {authUser && (
                <>
                  <button
                    aria-label="Create watchlist"
                    onClick={beginCreateWatchlist}
                    title="Create watchlist"
                    type="button"
                  >
                    <Plus aria-hidden="true" size={14} />
                  </button>
                  <button
                    aria-label="Rename watchlist"
                    disabled={!activeWatchlist}
                    onClick={beginRenameWatchlist}
                    title="Rename watchlist"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} />
                  </button>
                  <button
                    aria-label="Delete watchlist"
                    disabled={!activeWatchlist || watchlists.length <= 1}
                    onClick={handleDeleteWatchlist}
                    title="Delete watchlist"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="watchlist-controls">
            <label>
              <span>Sort</span>
              <select
                aria-label="Sort watchlist"
                onChange={(event) => setWatchlistSort(event.target.value as WatchlistSort)}
                value={watchlistSort}
              >
                <option value="manual">Manual</option>
                <option value="changePercent">% change</option>
                <option value="changeDollar">$ change</option>
                <option value="price">Price</option>
                <option value="symbol">Symbol</option>
              </select>
            </label>
            <label>
              <span>View</span>
              <select
                aria-label="Filter watchlist"
                onChange={(event) => setWatchlistFilter(event.target.value as WatchlistFilter)}
                value={watchlistFilter}
              >
                <option value="all">All</option>
                <option value="gainers">Gainers</option>
                <option value="losers">Losers</option>
              </select>
            </label>
          </div>
          {watchlistEditorMode && (
            <form className="watchlist-editor" onSubmit={submitWatchlistEditor}>
              <input
                aria-label="Watchlist name"
                maxLength={32}
                onChange={(event) => setWatchlistNameDraft(event.target.value)}
                type="text"
                value={watchlistNameDraft}
              />
              <button aria-label="Save watchlist name" title="Save" type="submit">
                <Check aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Cancel watchlist edit"
                onClick={cancelWatchlistEditor}
                title="Cancel"
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </form>
          )}
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleWatchlistDragEnd}
            sensors={watchlistDragSensors}
          >
            <SortableContext
              items={displayedWatchlistSymbols.map((item) => item.symbol)}
              strategy={rectSortingStrategy}
            >
              <div className="watchlist">
            {displayedWatchlistSymbols.length === 0 ? (
              <div className="watchlist-empty">
                {watchlistSymbols.length === 0 ? 'Add a symbol from search.' : 'No symbols match this view.'}
              </div>
            ) : (
              displayedWatchlistSymbols.map((symbol) => (
                <SortableWatchlistRow
                  key={symbol.symbol}
                  symbol={symbol}
                  isSelected={symbol.symbol === selectedSymbol}
                  dragEnabled={isWatchlistReorderEnabled}
                  snapshot={
                    symbol.symbol === selectedSymbol
                      ? (visibleQuote ?? watchlistSnapshots[symbol.symbol] ?? null)
                      : (watchlistSnapshots[symbol.symbol] ?? null)
                  }
                  sparkline={sparklines[symbol.symbol]}
                  onRemove={authUser ? handleRemoveFromWatchlist : undefined}
                  onSelect={setSelectedSymbol}
                />
              ))
            )}
              </div>
            </SortableContext>
          </DndContext>
          {(watchlistError || watchlistUiError) && (
            <div className="watchlist-error">{watchlistError || watchlistUiError}</div>
          )}
        </aside>

        <section className="chart-pane">
          <div className="chart-header">
            <div className="symbol-heading">
              <span>{activeRecord?.exchange ?? 'Market'}</span>
              <h1>{selectedSymbol}</h1>
              <p>{activeRecord?.name ?? 'Selected instrument'}</p>
              {authUser && (
                <button
                  className="add-watchlist-button"
                  disabled={isSelectedInWatchlist}
                  onClick={handleAddSelectedToWatchlist}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                  {isSelectedInWatchlist ? 'In watchlist' : 'Add to watchlist'}
                </button>
              )}
            </div>

            <div className="quote-block">
              <strong>{visibleQuote ? formatPrice(visibleQuote.price) : '--'}</strong>
              <span className={selectedTone ? `tone-${selectedTone}` : undefined}>
                {formatChange(visibleQuote)}
                {' / '}
                {visibleQuote
                  ? `${visibleQuote.changePercent >= 0 ? '+' : ''}${percentFormatter.format(visibleQuote.changePercent)}%`
                  : '0.00%'}
              </span>
            </div>
          </div>

          <div className="toolbar">
            <div className="segmented-control" aria-label="Timeframe">
              {timeframes.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={item === timeframe ? 'is-active' : undefined}
                  onClick={() => setTimeframe(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="feed-state">
              {marketClock && (
                <span className={`market-status ${marketClock.isOpen ? 'is-open' : 'is-closed'}`}>
                  {marketClock.isOpen ? 'Open' : 'Closed'}
                </span>
              )}
              {!marketClock && marketClockError && (
                <span className="market-status is-unavailable" title={marketClockError}>
                  Hours unavailable
                </span>
              )}
              {isSimulatedQuote && (
                <span
                  className="market-status is-simulated"
                  title={selectedQuoteSnapshot.fallbackReason ?? 'Demo feed is driving this quote'}
                >
                  Quote demo
                </span>
              )}
              {!isSimulatedQuote && (
                <span className="delay-badge" title="Data from IEX is delayed ~16 minutes vs real-time">16-min delayed</span>
              )}
              <Wifi aria-hidden="true" size={15} />
              <span className={!isLoading && !error ? `data-age-${getDataAge(lastRefreshTime, now)}` : undefined}>
                {isLoading
                  ? 'Loading'
                  : error
                    ? 'Degraded'
                    : `Updated ${formatTimeAgo(lastRefreshTime, now)}`}
              </span>
            </div>
          </div>

          <div className="chart-frame">
            {isLoading && selectedBars.length === 0 ? (
              <div className="chart-skeleton" aria-label="Loading chart" />
            ) : (
              <MarketChart
                bars={selectedBars}
                averageCost={selectedPortfolioHolding?.averageCost ?? null}
              />
            )}
            {error && <div className="chart-overlay">{error}</div>}
          </div>
        </section>

        <aside className="details-pane" aria-label="Instrument details">
          <div className="pane-heading">
            <span>Details</span>
          </div>
          <div className="metrics-group">
            <span className="metrics-group-label">Market Data</span>
            <div className="metrics-grid">
              <Metric label="Bid" value={selectedQuoteSnapshot ? formatPrice(selectedQuoteSnapshot.bid) : '--'} title="Highest price a buyer is willing to pay" />
              <Metric label="Ask" value={selectedQuoteSnapshot ? formatPrice(selectedQuoteSnapshot.ask) : '--'} title="Lowest price a seller is willing to accept" />
              <Metric label="High" value={dailyHigh ? formatPrice(dailyHigh) : '--'} title="Today's highest traded price" />
              <Metric label="Low" value={dailyLow ? formatPrice(dailyLow) : '--'} title="Today's lowest traded price" />
              <Metric
                label="Volume"
                value={visibleQuote ? compactFormatter.format(visibleQuote.volume) : '--'}
                title="Number of shares traded today"
              />
            </div>
          </div>
          <div className="metrics-group">
            <span className="metrics-group-label">Fundamentals</span>
            <div className="metrics-grid">
              <Metric
                label="Range high"
                value={week52High ? formatPrice(week52High) : '--'}
                title="52-week high price"
              />
              <Metric
                label="Range low"
                value={week52Low ? formatPrice(week52Low) : '--'}
                title="52-week low price"
              />
              <Metric
                label="Sector"
                value={activeRecord?.sector ?? '--'}
                title="Industry sector classification"
              />
              <Metric
                label="Asset"
                value={activeRecord?.assetClass.toUpperCase() ?? '--'}
                title="Asset class type"
              />
            </div>
          </div>
          <div className="metrics-group">
            <span className="metrics-group-label">Status</span>
            <div className="metrics-grid">
              <Metric
                label="Status"
                value={statusMetricValue}
                title="Current market status — live, delayed, or simulated data"
              />
            </div>
          </div>
        </aside>

        <section className="bottom-pane" aria-label="Portfolio and recent movement">
          <div className="bottom-layout">
            <section className="portfolio-panel" aria-label="Portfolio">
              <div className="pane-heading portfolio-heading">
                <span>Portfolio</span>
                {authUser ? (
                  <div className="portfolio-tools">
                    <input
                      accept=".csv,text/csv"
                      className="visually-hidden"
                      onChange={handlePortfolioImport}
                      ref={portfolioImportRef}
                      type="file"
                    />
                    <button
                      aria-label="Import portfolio CSV"
                      onClick={() => portfolioImportRef.current?.click()}
                      title="Import CSV"
                      type="button"
                    >
                      <Upload aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label="Export portfolio CSV"
                      disabled={portfolio.length === 0}
                      onClick={handlePortfolioExport}
                      title="Export CSV"
                      type="button"
                    >
                      <Download aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label="Edit alert thresholds"
                      onClick={toggleAlertEditor}
                      title="Alert thresholds"
                      type="button"
                    >
                      <SlidersHorizontal aria-hidden="true" size={14} />
                    </button>
                    <select
                      aria-label="Sort portfolio"
                      className="portfolio-sort"
                      onChange={(event) => setPortfolioSort(event.target.value as PortfolioSort)}
                      value={portfolioSort}
                    >
                      <option value="value">Value</option>
                      <option value="gainPercent">Gain %</option>
                      <option value="dayChange">Day $</option>
                      <option value="allocation">Allocation</option>
                      <option value="drift">Drift</option>
                      <option value="symbol">Symbol</option>
                    </select>
                    <small>{portfolio.length}</small>
                  </div>
                ) : (
                  <small>Sign in to track holdings</small>
                )}
              </div>
              {authUser ? (
                <>
                  <div className="portfolio-summary">
                    <Metric label="Value" value={formatPrice(portfolioSummary.totalValue)} />
                    <Metric
                      label="Gain"
                      tone={toneFromValue(portfolioSummary.totalGain)}
                      value={`${formatSignedCurrency(portfolioSummary.totalGain)}\n${formatSignedPercent(portfolioSummary.totalGainPercent)}`}
                    />
                    <Metric
                      label="Day"
                      tone={toneFromValue(portfolioSummary.dayChange)}
                      value={`${formatSignedCurrency(portfolioSummary.dayChange)}\n${formatSignedPercent(portfolioSummary.dayChangePercent)}`}
                    />
                    <Metric label="Cost" value={formatPrice(portfolioSummary.totalCost)} />
                    <Metric
                      label="Target"
                      tone={
                        portfolioSummary.targetWeightTotal > 0 &&
                        Math.abs(portfolioSummary.targetGap) > 1
                          ? 'negative'
                          : undefined
                      }
                      value={
                        portfolioSummary.targetWeightTotal > 0
                          ? `${formatPlainPercent(portfolioSummary.targetWeightTotal)} set`
                          : 'No targets'
                      }
                    />
                    {performanceData?.metrics && (
                      <>
                        <Metric label="Return" tone={toneFromValue(performanceData.metrics.totalReturn ?? 0)} value={formatSignedPercent(performanceData.metrics.totalReturn ?? 0)} />
                        <Metric label="YTD" tone={toneFromValue(performanceData.metrics.ytdReturn ?? 0)} value={formatSignedPercent(performanceData.metrics.ytdReturn ?? 0)} />
                        <Metric label="Drawdown" tone={toneFromValue(-(performanceData.metrics.maxDrawdown ?? 0))} value={formatPlainPercent(performanceData.metrics.maxDrawdown ?? 0)} />
                        <Metric label="Volatility" value={formatPlainPercent(performanceData.metrics.annualizedVolatility ?? 0)} />
                      </>
                    )}
                  </div>
                  {performanceData?.snapshots && performanceData.snapshots.length > 1 && (
                    <svg className="perf-sparkline" viewBox="0 0 200 32" preserveAspectRatio="none" width="100%" height="32">
                      {(() => {
                        const vals = performanceData.snapshots.map((s) => s.totalValue)
                        const mn = Math.min(...vals)
                        const mx = Math.max(...vals)
                        const range = mx - mn || 1
                        const w = 200; const h = 32
                        const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / range) * (h - 4) - 2}`).join(' ')
                        return <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" points={points} />
                      })()}
                    </svg>
                  )}
                  {portfolioPositions.length > 0 && (
                    <div className="portfolio-insights">
                      {portfolioInsights.map((insight) => (
                        <div className="portfolio-insight" key={insight.label}>
                          <span>{insight.label}</span>
                          <strong className={insight.tone ? `tone-${insight.tone}` : undefined}>
                            {insight.value}
                          </strong>
                          <small>{insight.detail}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {portfolioAlerts.length > 0 && (
                    <div className="portfolio-alerts" aria-label="Portfolio alerts">
                      {portfolioAlerts.map((alert) => (
                        <div className="portfolio-alert" key={alert.label}>
                          {alert.label === 'Allocation model' || alert.label === 'Target model' ? (
                            <Target aria-hidden="true" size={15} />
                          ) : (
                            <Bell aria-hidden="true" size={15} />
                          )}
                          <span>
                            <small>{alert.label}</small>
                            <strong className={alert.tone ? `tone-${alert.tone}` : undefined}>
                              {alert.value}
                            </strong>
                          </span>
                          <em>{alert.detail}</em>
                        </div>
                      ))}
                    </div>
                  )}
                  {isAlertEditorOpen && (
                    <form className="alert-settings-form" onSubmit={submitAlertSettings}>
                      <label>
                        <span>Drift</span>
                        <input
                          aria-label="Drift alert threshold"
                          max="100"
                          min="0"
                          onChange={(event) =>
                            setAlertDraft((current) => ({
                              ...current,
                              driftPercent: event.target.value,
                            }))
                          }
                          step="0.1"
                          type="number"
                          value={alertDraft.driftPercent}
                        />
                      </label>
                      <label>
                        <span>Concentration</span>
                        <input
                          aria-label="Concentration alert threshold"
                          max="100"
                          min="0"
                          onChange={(event) =>
                            setAlertDraft((current) => ({
                              ...current,
                              concentrationPercent: event.target.value,
                            }))
                          }
                          step="0.1"
                          type="number"
                          value={alertDraft.concentrationPercent}
                        />
                      </label>
                      <label>
                        <span>Day move</span>
                        <input
                          aria-label="Day move alert threshold"
                          max="100"
                          min="0"
                          onChange={(event) =>
                            setAlertDraft((current) => ({
                              ...current,
                              dayMovePercent: event.target.value,
                            }))
                          }
                          step="0.1"
                          type="number"
                          value={alertDraft.dayMovePercent}
                        />
                      </label>
                      <button title="Save alert thresholds" type="submit">
                        <Check aria-hidden="true" size={14} />
                      </button>
                      <button
                        aria-label="Close alert settings"
                        onClick={() => setIsAlertEditorOpen(false)}
                        title="Close"
                        type="button"
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </form>
                  )}
                  <form className="portfolio-form" onSubmit={submitPortfolioHolding}>
                    <input
                      aria-label="Portfolio symbol"
                      autoComplete="off"
                      onChange={(event) =>
                        setPortfolioDraft((current) => ({
                          ...current,
                          symbol: event.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="Symbol"
                      type="text"
                      value={portfolioDraft.symbol}
                    />
                    <input
                      aria-label="Portfolio shares"
                      min="0"
                      onChange={(event) =>
                        setPortfolioDraft((current) => ({
                          ...current,
                          shares: event.target.value,
                        }))
                      }
                      placeholder="Shares"
                      step="any"
                      type="number"
                      value={portfolioDraft.shares}
                    />
                    <input
                      aria-label="Portfolio average cost"
                      min="0"
                      onChange={(event) =>
                        setPortfolioDraft((current) => ({
                          ...current,
                          averageCost: event.target.value,
                        }))
                      }
                      placeholder="Avg cost"
                      step="any"
                      type="number"
                      value={portfolioDraft.averageCost}
                    />
                    <input
                      aria-label="Portfolio target weight"
                      max="100"
                      min="0"
                      onChange={(event) =>
                        setPortfolioDraft((current) => ({
                          ...current,
                          targetWeight: event.target.value,
                        }))
                      }
                      placeholder="Target %"
                      step="any"
                      type="number"
                      value={portfolioDraft.targetWeight}
                    />
                    <input
                      aria-label="Portfolio notes"
                      autoComplete="off"
                      maxLength={180}
                      onChange={(event) =>
                        setPortfolioDraft((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Note"
                      type="text"
                      value={portfolioDraft.notes}
                    />
                    <button title={editingHoldingId ? 'Update holding' : 'Add holding'} type="submit">
                      {editingHoldingId ? (
                        <Check aria-hidden="true" size={14} />
                      ) : (
                        <Plus aria-hidden="true" size={14} />
                      )}
                    </button>
                    <button
                      aria-label="Use selected symbol"
                      onClick={beginSelectedHolding}
                      title="Use selected symbol"
                      type="button"
                    >
                      <CornerDownLeft aria-hidden="true" size={14} />
                    </button>
                    {editingHoldingId && (
                      <button
                        aria-label="Cancel holding edit"
                        onClick={resetPortfolioDraft}
                        title="Cancel edit"
                        type="button"
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    )}
                  </form>
                  {(portfolioError || portfolioUiError) && (
                    <div className="portfolio-error">{portfolioError || portfolioUiError}</div>
                  )}
                  {portfolioUiMessage && (
                    <div className="portfolio-message">{portfolioUiMessage}</div>
                  )}
                  <div className="portfolio-table">
                    {portfolioPositions.length === 0 ? (
                      <div className="portfolio-empty">Add holdings to track value, gains, and day movement.</div>
                    ) : (
                      portfolioPositions.map((position) => (
                        <div className="portfolio-row" key={position.holding.id}>
                          <button
                            className="portfolio-symbol"
                            onClick={() => setSelectedSymbol(position.holding.symbol)}
                            type="button"
                          >
                            <strong>{position.holding.symbol}</strong>
                            <small>
                              {position.holding.shares} sh @ {formatPrice(position.holding.averageCost)}
                              {position.holding.notes ? ` / ${position.holding.notes}` : ''}
                            </small>
                          </button>
                          <span>
                            <strong>{formatPrice(position.marketValue)}</strong>
                            <small>{formatPlainPercent(position.allocation)} allocation</small>
                          </span>
                          <span>
                            <strong className={`tone-${toneFromValue(position.gain) ?? 'neutral'}`}>
                              {formatSignedCurrency(position.gain)}
                            </strong>
                            <small className={`tone-${toneFromValue(position.gainPercent) ?? 'neutral'}`}>
                              {formatSignedPercent(position.gainPercent)}
                            </small>
                          </span>
                          <span>
                            <strong className={`tone-${toneFromValue(position.dayChange) ?? 'neutral'}`}>
                              {formatSignedCurrency(position.dayChange)}
                            </strong>
                            <small className={position.hasTarget ? `tone-${toneFromValue(position.drift) ?? 'neutral'}` : undefined}>
                              {position.hasTarget ? `Drift ${formatSignedPercent(position.drift)}` : 'No target'}
                            </small>
                          </span>
                          <button
                            aria-label={`Edit ${position.holding.symbol} holding`}
                            onClick={() => beginEditHolding(position.holding)}
                            title="Edit holding"
                            type="button"
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </button>
                          <button
                            aria-label={`Remove ${position.holding.symbol} holding`}
                            onClick={() => handleRemoveHolding(position.holding.id)}
                            title="Remove holding"
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="portfolio-empty">
                  <button className="guest-signin-prompt" onClick={() => setShowAuth(true)} type="button">
                    <User aria-hidden="true" size={16} />
                    Sign in to build and track your portfolio
                  </button>
                </div>
              )}
            </section>

            <section className="intel-panel" aria-label="Market intelligence">
              <div className="pane-heading intel-heading">
                <span>Market Intel</span>
                <div className="intel-tabs" role="tablist" aria-label="Market intelligence views">
                  {(function() {
                    const tabList: InsightTab[] = ['trending', 'news', 'movement', 'options', 'strategy', 'chat', 'screener']
                    const groupMap: Record<string, string> = { trending: 'Markets', news: 'Markets', movement: 'Markets', options: 'Research', strategy: 'Research', chat: '', screener: '' }
                    return tabList.map((tab) => {
                      const group = groupMap[tab]
                      return (
                        <button
                          aria-selected={activeInsightTab === tab}
                          className={`${activeInsightTab === tab ? 'is-active' : ''}${group ? ` tab-group-${group.toLowerCase()}` : ''}`}
                          key={tab}
                          onClick={() => setActiveInsightTab(tab)}
                          role="tab"
                          type="button"
                          data-group={group || undefined}
                        >
                          {tab === 'trending'
                            ? 'Trending'
                            : tab === 'movement'
                              ? 'Movement'
                              : tab === 'options'
                                ? 'Options'
                                : tab === 'strategy'
                                  ? 'Strategy'
                                  : tab === 'chat'
                                    ? 'Chat'
                                    : tab === 'screener'
                                      ? 'Screener'
                                  : 'News'}
                        </button>
                      )
                    })
                  })()}
                </div>
              </div>
              <div className="intel-body">
                {activeInsightTab === 'trending' && (
                  <TrendingPanel
                    onSelectSymbol={(item) => {
                      setSelectedSearchRecord(item)
                      setSelectedSymbol(item.symbol)
                    }}
                  />
                )}
                {activeInsightTab === 'news' && (
                  <NewsFeed symbol={selectedSymbol} compact />
                )}
                {activeInsightTab === 'movement' && (
                  <div className="movement-strip">
                    {recentBars.map((bar) => {
                      const tone = bar.close >= bar.open ? 'positive' : 'negative'
                      return (
                        <div className="movement-cell" key={bar.time}>
                          <span>{new Date(bar.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <strong className={`tone-${tone}`}>{formatPrice(bar.close)}</strong>
                          <small>{compactFormatter.format(bar.volume)}</small>
                        </div>
                      )
                    })}
                  </div>
                )}
                {activeInsightTab === 'options' && (
                  <OptionsPanel
                    assetClass={selectedWatchlistRecord.assetClass}
                    portfolioShares={selectedPortfolioHolding?.shares ?? 0}
                    symbol={selectedSymbol}
                    underlyingPrice={visibleQuote?.price ?? selectedQuoteSnapshot?.price ?? null}
                  />
                )}
                {activeInsightTab === 'strategy' && (
                  <StrategyLab
                    key={selectedSymbol}
                    portfolio={portfolio}
                    selectedSymbol={selectedSymbol}
                    underlyingPrice={visibleQuote?.price ?? selectedQuoteSnapshot?.price ?? null}
                  />
                )}
                {activeInsightTab === 'screener' && (
                  <StockScreener
                    onSelectSymbol={(symbol, name) => {
                      setSelectedSearchRecord({
                        symbol,
                        name,
                        exchange: '',
                        sector: '',
                        assetClass: 'equity',
                      })
                      setSelectedSymbol(symbol)
                    }}
                  />
                )}
                {activeInsightTab === 'chat' && (
                  <TradingChat />
                )}
              </div>
            </section>
          </div>
        </section>
      </section>
      <footer className="app-footer">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </main>
  )
}

export default App
