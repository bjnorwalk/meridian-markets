import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Filter,
  LoaderCircle,
  RefreshCcw,
  X,
} from 'lucide-react'
import {
  compactFormatter,
  formatPrice,
  formatSignedCurrency,
  formatSignedPercent,
  toneFromValue,
} from '../utils/format'
import type { AssetClass, QuoteSnapshot } from '../types/market'
import './StockScreener.css'

interface UniverseEntry {
  symbol:     string
  name:       string
  exchange:   string
  sector:     string
  assetClass: AssetClass
}

const UNIVERSE: UniverseEntry[] = [
  { symbol: 'AAPL',  name: 'Apple Inc.',              exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',          exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.',             exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',            exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'META',  name: 'Meta Platforms',           exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'AVGO',  name: 'Broadcom Inc.',            exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'AMD',   name: 'Advanced Micro Devices',   exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'INTC',  name: 'Intel Corp.',              exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'QCOM',  name: 'Qualcomm Inc.',            exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'CRM',   name: 'Salesforce Inc.',          exchange: 'NYSE',   sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'ADBE',  name: 'Adobe Inc.',               exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'NOW',   name: 'ServiceNow Inc.',          exchange: 'NYSE',   sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'PLTR',  name: 'Palantir Technologies',    exchange: 'NYSE',   sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'CRWD',  name: 'CrowdStrike Holdings',     exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'PANW',  name: 'Palo Alto Networks',       exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'NET',   name: 'Cloudflare Inc.',          exchange: 'NYSE',   sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'DDOG',  name: 'Datadog Inc.',             exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'SNOW',  name: 'Snowflake Inc.',           exchange: 'NYSE',   sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'MU',    name: 'Micron Technology',        exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'AMAT',  name: 'Applied Materials',        exchange: 'NASDAQ', sector: 'Technology',     assetClass: 'equity' },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',          exchange: 'NASDAQ', sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'TSLA',  name: 'Tesla Inc.',               exchange: 'NASDAQ', sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'HD',    name: 'Home Depot Inc.',          exchange: 'NYSE',   sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'MCD',   name: "McDonald's Corp.",         exchange: 'NYSE',   sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'NKE',   name: 'Nike Inc.',                exchange: 'NYSE',   sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'SBUX',  name: 'Starbucks Corp.',          exchange: 'NASDAQ', sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'UBER',  name: 'Uber Technologies',        exchange: 'NYSE',   sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'ABNB',  name: 'Airbnb Inc.',              exchange: 'NASDAQ', sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'DASH',  name: 'DoorDash Inc.',            exchange: 'NASDAQ', sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'SHOP',  name: 'Shopify Inc.',             exchange: 'NYSE',   sector: 'Consumer',       assetClass: 'equity' },
  { symbol: 'JPM',   name: 'JPMorgan Chase',           exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'V',     name: 'Visa Inc.',                exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'MA',    name: 'Mastercard Inc.',          exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'BAC',   name: 'Bank of America',          exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'GS',    name: 'Goldman Sachs',            exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'MS',    name: 'Morgan Stanley',           exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'AXP',   name: 'American Express',         exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'COF',   name: 'Capital One Financial',    exchange: 'NYSE',   sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'COIN',  name: 'Coinbase Global',          exchange: 'NASDAQ', sector: 'Finance',        assetClass: 'equity' },
  { symbol: 'LLY',   name: 'Eli Lilly and Co.',        exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'JNJ',   name: 'Johnson & Johnson',        exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'UNH',   name: 'UnitedHealth Group',       exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'ABBV',  name: 'AbbVie Inc.',              exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'MRK',   name: 'Merck & Co.',              exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'PFE',   name: 'Pfizer Inc.',              exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'TMO',   name: 'Thermo Fisher Scientific', exchange: 'NYSE',   sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'AMGN',  name: 'Amgen Inc.',               exchange: 'NASDAQ', sector: 'Healthcare',     assetClass: 'equity' },
  { symbol: 'XOM',   name: 'Exxon Mobil Corp.',        exchange: 'NYSE',   sector: 'Energy',         assetClass: 'equity' },
  { symbol: 'CVX',   name: 'Chevron Corp.',            exchange: 'NYSE',   sector: 'Energy',         assetClass: 'equity' },
  { symbol: 'COP',   name: 'ConocoPhillips',           exchange: 'NYSE',   sector: 'Energy',         assetClass: 'equity' },
  { symbol: 'OXY',   name: 'Occidental Petroleum',     exchange: 'NYSE',   sector: 'Energy',         assetClass: 'equity' },
  { symbol: 'COST',  name: 'Costco Wholesale',         exchange: 'NASDAQ', sector: 'Staples',        assetClass: 'equity' },
  { symbol: 'WMT',   name: 'Walmart Inc.',             exchange: 'NYSE',   sector: 'Staples',        assetClass: 'equity' },
  { symbol: 'PG',    name: 'Procter & Gamble',         exchange: 'NYSE',   sector: 'Staples',        assetClass: 'equity' },
  { symbol: 'KO',    name: 'Coca-Cola Co.',            exchange: 'NYSE',   sector: 'Staples',        assetClass: 'equity' },
  { symbol: 'PEP',   name: 'PepsiCo Inc.',             exchange: 'NASDAQ', sector: 'Staples',        assetClass: 'equity' },
  { symbol: 'NFLX',  name: 'Netflix Inc.',             exchange: 'NASDAQ', sector: 'Media',          assetClass: 'equity' },
  { symbol: 'DIS',   name: 'Walt Disney Co.',          exchange: 'NYSE',   sector: 'Media',          assetClass: 'equity' },
  { symbol: 'SPOT',  name: 'Spotify Technology',       exchange: 'NYSE',   sector: 'Media',          assetClass: 'equity' },
  { symbol: 'CMCSA', name: 'Comcast Corp.',            exchange: 'NASDAQ', sector: 'Media',          assetClass: 'equity' },
  { symbol: 'CAT',   name: 'Caterpillar Inc.',         exchange: 'NYSE',   sector: 'Industrial',     assetClass: 'equity' },
  { symbol: 'BA',    name: 'Boeing Co.',               exchange: 'NYSE',   sector: 'Industrial',     assetClass: 'equity' },
  { symbol: 'GE',    name: 'GE Aerospace',             exchange: 'NYSE',   sector: 'Industrial',     assetClass: 'equity' },
  { symbol: 'RTX',   name: 'RTX Corp.',                exchange: 'NYSE',   sector: 'Industrial',     assetClass: 'equity' },
  { symbol: 'DE',    name: 'Deere & Company',          exchange: 'NYSE',   sector: 'Industrial',     assetClass: 'equity' },
  { symbol: 'SPY',   name: 'SPDR S&P 500 ETF',        exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'QQQ',   name: 'Invesco QQQ Trust',        exchange: 'NASDAQ', sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'IWM',   name: 'iShares Russell 2000',     exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'VOO',   name: 'Vanguard S&P 500 ETF',     exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'DIA',   name: 'SPDR Dow Jones ETF',       exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'GLD',   name: 'SPDR Gold Shares',         exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'TLT',   name: 'iShares 20Y Treasury',     exchange: 'NASDAQ', sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'XLF',   name: 'Financial Select SPDR',    exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'XLK',   name: 'Technology Select SPDR',   exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'XLE',   name: 'Energy Select SPDR',       exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'XLV',   name: 'Health Care Select SPDR',  exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
  { symbol: 'ARKK',  name: 'ARK Innovation ETF',       exchange: 'NYSE',   sector: 'ETF',            assetClass: 'etf' },
]

const SECTORS = Array.from(new Set(UNIVERSE.map((e) => e.sector))).sort()
const BATCH_SIZE = 40

type SortKey = 'symbol' | 'price' | 'change' | 'changePercent' | 'volume' | 'spread'
type SortDir = 'asc' | 'desc'
type Preset  = 'all' | 'gainers' | 'losers' | 'movers' | 'highvol' | 'etfs' | 'tech'

interface ScreenerFilters {
  preset:      Preset
  minChange:   number
  maxChange:   number
  minPrice:    number
  maxPrice:    number
  minVolume:   number
  sectors:     Set<string>
  assetClass:  'all' | 'equity' | 'etf'
}

interface ScreenerRow {
  entry:    UniverseEntry
  snapshot: QuoteSnapshot
  spread:   number
}

const DEFAULT_FILTERS: ScreenerFilters = {
  preset:     'all',
  minChange:  -100,
  maxChange:  100,
  minPrice:   0,
  maxPrice:   99999,
  minVolume:  0,
  sectors:    new Set(SECTORS),
  assetClass: 'all',
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'gainers', label: '↑ Gainers' },
  { key: 'losers',  label: '↓ Losers' },
  { key: 'movers',  label: '⚡ Movers' },
  { key: 'highvol', label: '🔊 Vol' },
  { key: 'etfs',    label: 'ETFs' },
  { key: 'tech',    label: 'Tech' },
]

function applyPreset(preset: Preset): Partial<ScreenerFilters> {
  switch (preset) {
    case 'gainers': return { minChange: 0, maxChange: 100, assetClass: 'all', sectors: new Set(SECTORS) }
    case 'losers':  return { minChange: -100, maxChange: 0, assetClass: 'all', sectors: new Set(SECTORS) }
    case 'movers':  return { minChange: -100, maxChange: 100, assetClass: 'all', sectors: new Set(SECTORS) }
    case 'highvol': return { minVolume: 5_000_000, assetClass: 'all', sectors: new Set(SECTORS) }
    case 'etfs':    return { assetClass: 'etf', sectors: new Set(SECTORS) }
    case 'tech':    return { assetClass: 'equity', sectors: new Set(['Technology']) }
    default:        return { ...DEFAULT_FILTERS }
  }
}

const MIN_VOL_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '500K', value: 500_000 },
  { label: '1M', value: 1_000_000 },
  { label: '5M', value: 5_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '50M', value: 50_000_000 },
]

export function StockScreener({
  onSelectSymbol,
}: {
  onSelectSymbol: (symbol: string, name: string) => void
}) {
  const [snapshots,   setSnapshots]   = useState<Record<string, QuoteSnapshot>>({})
  const [loadStatus,  setLoadStatus]  = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [filters,     setFilters]     = useState<ScreenerFilters>(DEFAULT_FILTERS)
  const [sortKey,     setSortKey]     = useState<SortKey>('changePercent')
  const [sortDir,     setSortDir]     = useState<SortDir>('desc')
  const [filterOpen,  setFilterOpen]  = useState(false)
  const [query,       setQuery]       = useState('')
  const hasFetched = useRef(false)

  const fetchSnapshots = useCallback(async () => {
    setLoadStatus('loading')
    setLoadError(null)
    const all: Record<string, QuoteSnapshot> = {}

    try {
      const symbols = UNIVERSE.map((e) => e.symbol)
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE)
        const res   = await fetch(`/api/market/snapshots?symbols=${batch.join(',')}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { snapshots: Record<string, QuoteSnapshot> }
        Object.assign(all, data.snapshots ?? {})
      }
      setSnapshots(all)
      setLoadStatus('ready')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load market data')
      setLoadStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true
      void fetchSnapshots()
    }
  }, [fetchSnapshots])

  const handlePreset = (preset: Preset) => {
    const extra = applyPreset(preset)
    setFilters((prev) => ({
      ...prev,
      ...DEFAULT_FILTERS,
      ...extra,
      preset,
      minChange: preset === 'movers' ? -100 : extra.minChange ?? DEFAULT_FILTERS.minChange,
      maxChange: preset === 'movers' ? 100  : extra.maxChange ?? DEFAULT_FILTERS.maxChange,
    }))
  }

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'symbol' ? 'asc' : 'desc')
    }
  }

  const toggleSector = (sector: string) => {
    setFilters((prev) => {
      const next = new Set(prev.sectors)
      next.has(sector) ? next.delete(sector) : next.add(sector)
      return { ...prev, sectors: next, preset: 'all' }
    })
  }

  const rows = useMemo<ScreenerRow[]>(() => {
    const result: ScreenerRow[] = []
    const q = query.trim().toLowerCase()

    for (const entry of UNIVERSE) {
      const snap = snapshots[entry.symbol]
      if (!snap) continue

      if (q && !entry.symbol.toLowerCase().includes(q) && !entry.name.toLowerCase().includes(q)) continue

      if (filters.preset === 'movers' && Math.abs(snap.changePercent) < 1.5) continue

      if (snap.changePercent < filters.minChange || snap.changePercent > filters.maxChange) continue
      if (snap.price        < filters.minPrice  || snap.price        > filters.maxPrice)  continue
      if (snap.volume       < filters.minVolume) continue

      if (!filters.sectors.has(entry.sector)) continue

      if (filters.assetClass === 'equity' && entry.assetClass !== 'equity') continue
      if (filters.assetClass === 'etf'    && entry.assetClass !== 'etf')    continue

      const bid    = snap.bid  ?? snap.price
      const ask    = snap.ask  ?? snap.price
      const spread = snap.price > 0 ? ((ask - bid) / snap.price) * 100 : 0

      result.push({ entry, snapshot: snap, spread })
    }

    return result.sort((a, b) => {
      let diff = 0
      switch (sortKey) {
        case 'symbol':        diff = a.entry.symbol.localeCompare(b.entry.symbol); break
        case 'price':         diff = a.snapshot.price         - b.snapshot.price;         break
        case 'change':        diff = a.snapshot.change        - b.snapshot.change;        break
        case 'changePercent': diff = a.snapshot.changePercent - b.snapshot.changePercent; break
        case 'volume':        diff = a.snapshot.volume        - b.snapshot.volume;        break
        case 'spread':        diff = a.spread                 - b.spread;                break
      }
      return sortDir === 'desc' ? -diff : diff
    })
  }, [snapshots, filters, sortKey, sortDir, query])

  const summary = useMemo(() => {
    const gainers   = rows.filter((r) => r.snapshot.changePercent > 0).length
    const losers    = rows.filter((r) => r.snapshot.changePercent < 0).length
    const unchanged = rows.length - gainers - losers
    const avgChange = rows.length
      ? rows.reduce((sum, r) => sum + r.snapshot.changePercent, 0) / rows.length
      : 0
    return { gainers, losers, unchanged, avgChange }
  }, [rows])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return <ArrowDownUp size={11} className="scr-sort-idle" />
    return sortDir === 'desc' ? <ChevronDown size={13} className="scr-sort-active" /> : <ChevronUp size={13} className="scr-sort-active" />
  }

  const colHeader = (label: string, key: SortKey, align: 'left' | 'right' = 'right') => (
    <th className={`scr-th scr-th-${align}`} onClick={() => handleSort(key)}>
      {align === 'left' && <SortIcon col={key} />}
      {label}
      {align === 'right' && <SortIcon col={key} />}
    </th>
  )

  return (
    <div className="scr-root">

      <div className="scr-toolbar">
        <div className="scr-presets" role="group" aria-label="Screener presets">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`scr-preset-btn${filters.preset === key ? ' is-active' : ''}`}
              onClick={() => handlePreset(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="scr-toolbar-right">
          <input
            className="scr-search"
            type="search"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter symbols"
          />
          <button
            type="button"
            className={`scr-icon-btn${filterOpen ? ' is-active' : ''}`}
            onClick={() => setFilterOpen((v) => !v)}
            title="Advanced filters"
            aria-pressed={filterOpen}
          >
            <Filter size={14} />
          </button>
          <button
            type="button"
            className="scr-icon-btn"
            onClick={() => void fetchSnapshots()}
            disabled={loadStatus === 'loading'}
            title="Refresh"
          >
            {loadStatus === 'loading'
              ? <LoaderCircle size={14} className="spin-icon" />
              : <RefreshCcw size={14} />}
          </button>
        </div>
      </div>

      {filterOpen && (
        <div className="scr-filters">
          <div className="scr-filter-group">
            <label className="scr-filter-label">Change %</label>
            <div className="scr-range-inputs">
              <input
                className="scr-num-input"
                type="number"
                value={filters.minChange}
                min={-50} max={0} step={0.5}
                onChange={(e) => setFilters((p) => ({ ...p, minChange: Number(e.target.value), preset: 'all' }))}
                aria-label="Min change percent"
              />
              <span className="scr-range-sep">→</span>
              <input
                className="scr-num-input"
                type="number"
                value={filters.maxChange}
                min={0} max={50} step={0.5}
                onChange={(e) => setFilters((p) => ({ ...p, maxChange: Number(e.target.value), preset: 'all' }))}
                aria-label="Max change percent"
              />
            </div>
          </div>

          <div className="scr-filter-group">
            <label className="scr-filter-label">Price ($)</label>
            <div className="scr-range-inputs">
              <input
                className="scr-num-input"
                type="number"
                value={filters.minPrice === 0 ? '' : filters.minPrice}
                min={0} step={1}
                placeholder="Min"
                onChange={(e) => setFilters((p) => ({ ...p, minPrice: Number(e.target.value) || 0, preset: 'all' }))}
                aria-label="Min price"
              />
              <span className="scr-range-sep">→</span>
              <input
                className="scr-num-input"
                type="number"
                value={filters.maxPrice === 99999 ? '' : filters.maxPrice}
                min={0} step={1}
                placeholder="Max"
                onChange={(e) => setFilters((p) => ({ ...p, maxPrice: Number(e.target.value) || 99999, preset: 'all' }))}
                aria-label="Max price"
              />
            </div>
          </div>

          <div className="scr-filter-group">
            <label className="scr-filter-label">Min Volume</label>
            <select
              className="scr-select"
              value={filters.minVolume}
              onChange={(e) => setFilters((p) => ({ ...p, minVolume: Number(e.target.value), preset: 'all' }))}
              aria-label="Minimum volume"
            >
              {MIN_VOL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="scr-filter-group">
            <label className="scr-filter-label">Asset Class</label>
            <div className="scr-asset-toggle">
              {(['all', 'equity', 'etf'] as const).map((cls) => (
                <button
                  key={cls}
                  type="button"
                  className={`scr-toggle-btn${filters.assetClass === cls ? ' is-active' : ''}`}
                  onClick={() => setFilters((p) => ({ ...p, assetClass: cls, preset: 'all' }))}
                >
                  {cls === 'all' ? 'All' : cls.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="scr-filter-group scr-filter-sectors">
            <label className="scr-filter-label">Sectors</label>
            <div className="scr-sector-chips">
              {SECTORS.map((sector) => (
                <button
                  key={sector}
                  type="button"
                  className={`scr-sector-chip${filters.sectors.has(sector) ? ' is-active' : ''}`}
                  onClick={() => toggleSector(sector)}
                >
                  {sector}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="scr-reset-btn"
            onClick={() => { setFilters(DEFAULT_FILTERS); setQuery('') }}
          >
            <X size={12} /> Reset filters
          </button>
        </div>
      )}

      {loadStatus === 'ready' && rows.length > 0 && (
        <div className="scr-summary">
          <span className="scr-summary-item">
            <span className="scr-summary-count">{rows.length}</span>
            <span className="scr-summary-label">results</span>
          </span>
          <span className="scr-summary-divider" />
          <span className="scr-summary-item tone-positive">
            <span className="scr-summary-count">{summary.gainers}</span>
            <span className="scr-summary-label">↑</span>
          </span>
          <span className="scr-summary-item tone-negative">
            <span className="scr-summary-count">{summary.losers}</span>
            <span className="scr-summary-label">↓</span>
          </span>
          <span className="scr-summary-item">
            <span className="scr-summary-count">{summary.unchanged}</span>
            <span className="scr-summary-label">—</span>
          </span>
          <span className="scr-summary-divider" />
          <span className={`scr-summary-item ${toneFromValue(summary.avgChange) ? `tone-${toneFromValue(summary.avgChange)}` : ''}`}>
            <span className="scr-summary-label">avg</span>
            <span className="scr-summary-count">
              {summary.avgChange >= 0 ? '+' : ''}{summary.avgChange.toFixed(2)}%
            </span>
          </span>
        </div>
      )}

      {loadStatus === 'loading' && (
        <div className="scr-state">
          <LoaderCircle size={18} className="spin-icon" />
          Scanning universe
        </div>
      )}
      {loadStatus === 'error' && (
        <div className="scr-state scr-state-error">
          {loadError}
          <button type="button" className="scr-retry-btn" onClick={() => void fetchSnapshots()}>
            Retry
          </button>
        </div>
      )}
      {loadStatus === 'ready' && rows.length === 0 && (
        <div className="scr-state">No symbols match these criteria.</div>
      )}

      {loadStatus === 'ready' && rows.length > 0 && (
        <div className="scr-table-wrap">
          <table className="scr-table" aria-label="Stock screener results">
            <thead>
              <tr>
                {colHeader('Symbol', 'symbol', 'left')}
                {colHeader('Price',  'price')}
                {colHeader('Chg $',  'change')}
                {colHeader('Chg %',  'changePercent')}
                {colHeader('Volume', 'volume')}
                {colHeader('Spread', 'spread')}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, snapshot, spread }) => {
                const tone = toneFromValue(snapshot.changePercent)
                return (
                  <tr
                    key={entry.symbol}
                    className="scr-row"
                    onClick={() => onSelectSymbol(entry.symbol, entry.name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectSymbol(entry.symbol, entry.name)
                      }
                    }}
                    aria-label={`Select ${entry.symbol}`}
                  >
                    <td className="scr-td scr-td-symbol">
                      <strong>{entry.symbol}</strong>
                      <small>{entry.name}</small>
                    </td>
                    <td className="scr-td scr-td-num">
                      {formatPrice(snapshot.price)}
                    </td>
                    <td className={`scr-td scr-td-num${tone ? ` tone-${tone}` : ''}`}>
                      {formatSignedCurrency(snapshot.change)}
                    </td>
                    <td className={`scr-td scr-td-num scr-td-chg${tone ? ` tone-${tone}` : ''}`}>
                      <span className={`scr-chg-pill${tone ? ` scr-chg-pill-${tone}` : ''}`}>
                        {formatSignedPercent(snapshot.changePercent)}
                      </span>
                    </td>
                    <td className="scr-td scr-td-num scr-td-muted">
                      {snapshot.volume > 0 ? compactFormatter.format(snapshot.volume) : '—'}
                    </td>
                    <td className="scr-td scr-td-num scr-td-muted">
                      {spread > 0 ? `${spread.toFixed(3)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
