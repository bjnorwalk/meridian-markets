import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { LoaderCircle, Search, X, Save, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { compactFormatter, formatPrice, formatSignedPercent, toneFromValue } from '../utils/format'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  createColumnHelper, flexRender,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'

interface ScreenerItem {
  symbol: string; price: number; change: number; volume: number;
  rsi: number | null; sma20: number | null; sma50: number | null; sma200: number | null;
  volumeSpike: number | null; gapPct: number | null;
  pctOffHigh52: number | null; pctOffLow52: number | null;
  pctAboveSma20: number | null; pctAboveSma50: number | null; pctAboveSma200: number | null;
  streakUp: number; streakDown: number; crossover: string | null;
  signals: Array<{ type: string; label: string; value?: number }>;
  totalReturn: number; weekReturn: number;
  recentCloses?: number[];
}

interface ScreenerData {
  scanned: number; total?: number; updatedAt: string; scope: string;
  provider: string;
  gainers: ScreenerItem[]; losers: ScreenerItem[]; mostActive: ScreenerItem[];
  oversold: ScreenerItem[]; overbought: ScreenerItem[];
  goldenCrosses: ScreenerItem[]; deathCrosses: ScreenerItem[];
  volumeSpikes: ScreenerItem[]; nearHigh52: ScreenerItem[]; nearLow52: ScreenerItem[];
}

type SectionKey = 'gainers' | 'losers' | 'mostActive' | 'oversold' | 'overbought' | 'goldenCrosses' | 'deathCrosses' | 'volumeSpikes' | 'nearHigh52' | 'nearLow52'

const sections: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'gainers', label: 'Top Gainers', icon: '+' },
  { key: 'losers', label: 'Top Losers', icon: '-' },
  { key: 'mostActive', label: 'Most Active', icon: '~' },
  { key: 'oversold', label: 'Oversold RSI<35', icon: '↓' },
  { key: 'overbought', label: 'Overbought RSI>65', icon: '↑' },
  { key: 'goldenCrosses', label: 'Golden Crosses', icon: '✓' },
  { key: 'deathCrosses', label: 'Death Crosses', icon: '✗' },
  { key: 'volumeSpikes', label: 'Volume Spikes', icon: '⚡' },
  { key: 'nearHigh52', label: 'Near 52W High', icon: '▲' },
  { key: 'nearLow52', label: 'Near 52W Low', icon: '▼' },
]

interface FilterResult {
  symbol: string; name: string; sector: string; industry: string
  price: number; change: number; volume: number
  marketCap: number; avgVolume: number; peRatio: number | null; forwardPe: number | null
  epsGrowth: number | null; revenueGrowth: number | null
  divYield: number | null; beta: number | null
  shortFloatPct: number | null; institutionPct: number | null
  rsi: number | null; volumeSpike: number | null; gapPct: number | null
  pctOffHigh52: number | null; pctOffLow52: number | null
  pctAboveSma20: number | null; pctAboveSma50: number | null; pctAboveSma200: number | null
  streakUp: number; streakDown: number; crossover: string | null
  signals: Array<{ type: string; label: string; value?: number }>
  totalReturn: number; weekReturn: number
  recentCloses?: number[]
}

interface ScreenerFilter {
  scope: string; nameQuery: string
  sectors: string[]; industries: string[]
  marketCapMin: number | null; marketCapMax: number | null
  peMin: number | null; peMax: number | null
  avgVolumeMin: number | null; avgVolumeMax: number | null
  divYieldMin: number | null; divYieldMax: number | null
  betaMin: number | null; betaMax: number | null
  shortFloatPctMin: number | null; shortFloatPctMax: number | null
  institutionPctMin: number | null; institutionPctMax: number | null
  sortKey: string; sortDir: string
}

interface FilterSearchResponse {
  total: number; offset: number; limit: number
  results: FilterResult[]
  sectors: string[]; industries: string[]
}

const DEFAULT_FILTER: ScreenerFilter = {
  scope: 'sp500', nameQuery: '',
  sectors: [], industries: [],
  marketCapMin: null, marketCapMax: null,
  peMin: null, peMax: null,
  avgVolumeMin: null, avgVolumeMax: null,
  divYieldMin: null, divYieldMax: null,
  betaMin: null, betaMax: null,
  shortFloatPctMin: null, shortFloatPctMax: null,
  institutionPctMin: null, institutionPctMax: null,
  sortKey: 'marketCap', sortDir: 'desc',
}

const PRESETS_KEY = 'screener_presets'

const scopes = [
  { value: 'broad', label: 'Broad Market' },
  { value: 'sp500', label: 'S&P 500' },
  { value: 'nasdaq100', label: 'Nasdaq 100' },
  { value: 'etfs', label: 'ETFs' },
  { value: 'watchlist', label: 'My Watchlist' },
  { value: 'portfolio', label: 'My Portfolio' },
]

function Sparkline({ closes, width = 60, height = 20 }: { closes: number[]; width?: number; height?: number }) {
  if (!closes || closes.length < 2) return <span style={{ width, height, display: 'inline-block' }} />
  const mn = Math.min(...closes); const mx = Math.max(...closes)
  const range = mx - mn || 1
  const points = closes.map((v, i) => `${(i / (closes.length - 1)) * width},${height - ((v - mn) / range) * (height - 2) - 1}`).join(' ')
  const color = closes[closes.length - 1] >= closes[0] ? 'var(--positive-text, #22c55e)' : 'var(--negative-text, #ef4444)'
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ flexShrink: 0 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  )
}

function SparkCell({ row: r }: { row: { original: { recentCloses?: number[] } } }) {
  return <Sparkline closes={r.original.recentCloses || []} width={48} height={18} />
}

function SignalCell({ row: r }: { row: { original: { signals: Array<{ label: string }>; change: number } } }) {
  const sigs = r.original.signals || []
  const labels = sigs.slice(0, 2).map(s => s.label)
  return <span className="screener-sigs">{labels.join(', ') || '—'}</span>
}

const ITEM_COL_HELPER = createColumnHelper<ScreenerItem>()
const FILTER_COL_HELPER = createColumnHelper<FilterResult>()

function MultiSelect({ label, options, selected, onChange, placeholder }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])
  const filtered = useMemo(() => options.filter(o => !selected.includes(o)), [options, selected])
  return (
    <div className="screener-multi" ref={ref} style={{ position: 'relative' }}>
      <label className="screener-filter-label">{label}</label>
      <div className="screener-multi-trigger" onClick={() => setOpen(!open)}>
        {selected.length === 0 ? (placeholder || 'Any') : `${selected.length} selected`}
      </div>
      {open && (
        <div className="screener-multi-dropdown">
          {selected.length > 0 && (
            <div className="screener-multi-selected">
              {selected.map(s => (
                <span key={s} className="screener-chip" onClick={() => onChange(selected.filter(x => x !== s))}>
                  {s} <X size={10} />
                </span>
              ))}
            </div>
          )}
          <div className="screener-multi-options">
            {filtered.slice(0, 100).map(o => (
              <div key={o} className="screener-multi-option" onClick={() => onChange([...selected, o])}>{o}</div>
            ))}
            {filtered.length === 0 && <div className="screener-multi-empty">All selected</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function RangeInput({ label, min, max, onMinChange, onMaxChange, presets }: {
  label: string; min: number | null; max: number | null
  onMinChange: (v: number | null) => void; onMaxChange: (v: number | null) => void
  presets?: Array<{ label: string; min: number | null; max: number | null }>
}) {
  return (
    <div className="screener-range">
      <label className="screener-filter-label">{label}</label>
      <div className="screener-range-inputs">
        <input type="number" className="screener-range-input" placeholder="Min" value={min ?? ''} onChange={e => onMinChange(e.target.value ? Number(e.target.value) : null)} />
        <span className="screener-range-sep">to</span>
        <input type="number" className="screener-range-input" placeholder="Max" value={max ?? ''} onChange={e => onMaxChange(e.target.value ? Number(e.target.value) : null)} />
      </div>
      {presets && (
        <div className="screener-preset-btns">
          {presets.map(p => (
            <button key={p.label} className="screener-preset-btn" onClick={() => { onMinChange(p.min); onMaxChange(p.max) }}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TableHeader({ header }: { header: any }) {
  const handler = header.column.getToggleSortingHandler()
  return (
    <th className="screener-sort-th" onClick={handler}>
      {flexRender(header.column.columnDef.header, header.getContext())}
      {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
    </th>
  )
}

export function ScreenerPanel({ onSelectSymbol, userSymbols = [] }: { onSelectSymbol: (item: any) => void; userSymbols?: string[] }) {
  // Category (old) mode
  const [activeSection, setActiveSection] = useState<SectionKey>('gainers')
  const [catData, setCatData] = useState<ScreenerData | null>(null)
  const [catStatus, setCatStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [catError, setCatError] = useState<string | null>(null)
  const [scope, setScope] = useState('sp500')
  const [scopeProgress, setScopeProgress] = useState<{ scanned: number; total: number } | null>(null)

  // Filter (new) mode
  const [filter, setFilter] = useState<ScreenerFilter>(() => {
    try { return { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem('screener_filter') || '{}') } } catch { return DEFAULT_FILTER }
  })
  const [fResults, setFResults] = useState<FilterSearchResponse | null>(null)
  const [fLoading, setFLoading] = useState(false)
  const [fError, setFError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [allSectors, setAllSectors] = useState<string[]>([])
  const [allIndustries, setAllIndustries] = useState<string[]>([])
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<Record<string, ScreenerFilter>>(() => {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}') } catch { return {} }
  })
  const [showFilters, setShowFilters] = useState(true)

  // Mode toggle
  const [mode, setMode] = useState<'categories' | 'filters'>(() => {
    return (localStorage.getItem('screener_mode') as 'categories' | 'filters') || 'categories'
  })

  const userSymbolSet = useMemo(() => new Set(userSymbols.map(s => s.toUpperCase())), [userSymbols])
  const pageSize = 50

  // Persist mode + filter
  useEffect(() => { localStorage.setItem('screener_mode', mode) }, [mode])
  useEffect(() => { localStorage.setItem('screener_filter', JSON.stringify(filter)) }, [filter])
  useEffect(() => { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)) }, [presets])

  // --- Categories mode ---
  useEffect(() => {
    if (mode !== 'categories') return
    let mounted = true; let pollTimer: ReturnType<typeof setTimeout> | null = null
    const fetchCat = (force = false) => {
      const params = new URLSearchParams({ scope })
      if (force) params.set('force', 'true')
      fetch(`/api/market/screener?${params}`, { headers: { accept: 'application/json' } })
        .then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message ?? 'Screener unavailable'); return p })
        .then(payload => {
          if (!mounted) return
          if (payload.partial || payload.status === 'scanning') {
            setCatData(null); setCatStatus('loading')
            setScopeProgress({ scanned: payload.scanned ?? 0, total: payload.total ?? 0 })
            if (pollTimer === null) pollTimer = setTimeout(() => fetchCat(true), 3000)
            return
          }
          setCatData(payload); setCatStatus('ready'); setScopeProgress(null)
        })
        .catch((err: unknown) => { if (!mounted) return; setCatStatus('error'); setCatError(err instanceof Error ? err.message : 'Screener unavailable') })
    }
    fetchCat()
    const interval = setInterval(() => fetchCat(), 30000)
    return () => { mounted = false; clearInterval(interval); if (pollTimer) clearTimeout(pollTimer) }
  }, [mode, scope])

  // --- Filters mode ---
  useEffect(() => {
    fetch('/api/screener/sectors').then(r => r.json()).then(setAllSectors).catch(() => {})
    fetch('/api/screener/industries').then(r => r.json()).then(setAllIndustries).catch(() => {})
  }, [])

  const runSearch = useCallback(async (pageNum = 0) => {
    setFLoading(true); setFError(null)
    try {
      const payload = { ...filter, limit: pageSize, offset: pageNum * pageSize }
      const res = await fetch('/api/screener/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Search failed') }
      const data: FilterSearchResponse = await res.json()
      setFResults(data)
      if (data.sectors && allSectors.length === 0) setAllSectors(data.sectors)
      if (data.industries && allIndustries.length === 0) setAllIndustries(data.industries)
    } catch (err: unknown) {
      setFError(err instanceof Error ? err.message : 'Search failed')
    } finally { setFLoading(false) }
  }, [filter])

  useEffect(() => { if (mode === 'filters') { runSearch(0); setPage(0) } }, [mode, runSearch])

  const updateFilter = (partial: Partial<ScreenerFilter>) => setFilter(f => ({ ...f, ...partial }))
  const applyPreset = (name: string) => { const p = presets[name]; if (p) { setFilter(p); setPage(0) } }
  const savePreset = () => {
    const name = presetName.trim() || `Preset ${Object.keys(presets).length + 1}`
    setPresets(p => ({ ...p, [name]: { ...filter } })); setPresetName('')
  }

  // --- TanStack Table setup ---
  const catSortingState = useState<SortingState>([])
  const [catSorting, setCatSorting] = catSortingState

  const catItems = useMemo(() => {
    if (!catData) return []
    const items = catData[activeSection] ?? []
    return items.map(item => ({ ...item, signals: item.signals || [] }))
  }, [catData, activeSection])

  const catColumns = useMemo(() => [
    ITEM_COL_HELPER.display({ id: 'spark', header: '', cell: SparkCell, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('symbol', { header: 'Symbol', cell: ({ getValue }) => {
      const held = userSymbolSet.has(getValue())
      return <span className="screener-sym">{getValue()}{held && <span className="screener-badge-held">●</span>}</span>
    }, meta: { className: '' } }),
    ITEM_COL_HELPER.display({ id: 'signals', header: 'Signals', cell: SignalCell, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('change', { header: 'Chg', cell: ({ getValue }) => {
      const v = getValue()
      return <span className={`screener-num ${toneFromValue(v)}`}>{formatSignedPercent(v)}</span>
    }, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('price', { header: 'Price', cell: ({ getValue }) => <span className="screener-num">{formatPrice(getValue())}</span>, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('volume', { header: 'Volume', cell: ({ getValue }) => <span className="screener-num">{compactFormatter.format(getValue())}</span>, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('volumeSpike', { header: 'Vol/Avg', cell: ({ getValue }) => <span className="screener-num">{getValue() ? `${getValue()?.toFixed(1)}x` : '—'}</span>, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('rsi', { header: 'RSI', cell: ({ getValue }) => <span className="screener-num">{getValue() !== null ? `${getValue()}` : '—'}</span>, meta: { className: '' } }),
    ITEM_COL_HELPER.accessor('totalReturn', { header: 'Return', cell: ({ getValue }) => {
      const v = getValue()
      return <span className={`screener-num ${toneFromValue(v)}`}>{formatSignedPercent(v)}</span>
    }, meta: { className: '' } }),
  ], [userSymbolSet])

  const catTable = useReactTable({
    data: catItems, columns: catColumns as any,
    state: { sorting: catSorting },
    onSortingChange: setCatSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const fSortingState = useState<SortingState>([])
  const [fSorting, setFSorting] = fSortingState

  const fItems = useMemo(() => (fResults?.results || []).map(item => ({ ...item, signals: item.signals || [] })), [fResults])

  const fColumns = useMemo(() => [
    FILTER_COL_HELPER.display({ id: 'spark', header: '', cell: SparkCell }),
    FILTER_COL_HELPER.accessor('symbol', { header: 'Symbol', cell: ({ getValue }) => {
      const held = userSymbolSet.has(getValue())
      return <span className="screener-sym">{getValue()}{held && <span className="screener-badge-held">●</span>}</span>
    } }),
    FILTER_COL_HELPER.accessor('name', { header: 'Name', cell: ({ getValue }) => <span className="screener-cell-name">{getValue() || '—'}</span> }),
    FILTER_COL_HELPER.accessor('sector', { header: 'Sector', cell: ({ getValue }) => <span className="screener-cell-sector">{getValue() || '—'}</span> }),
    FILTER_COL_HELPER.accessor('change', { header: 'Chg', cell: ({ getValue }) => {
      const v = getValue()
      return <span className={`screener-num ${toneFromValue(v)}`}>{formatSignedPercent(v)}</span>
    } }),
    FILTER_COL_HELPER.accessor('price', { header: 'Price', cell: ({ getValue }) => <span className="screener-num">{formatPrice(getValue())}</span> }),
    FILTER_COL_HELPER.accessor('marketCap', { header: 'Mkt Cap', cell: ({ getValue }) => <span className="screener-num">{getValue() ? compactFormatter.format(getValue()) : '—'}</span> }),
    FILTER_COL_HELPER.accessor('peRatio', { header: 'P/E', cell: ({ getValue }) => <span className="screener-num">{getValue() !== null ? getValue()!.toFixed(1) : '—'}</span> }),
    FILTER_COL_HELPER.accessor('volume', { header: 'Volume', cell: ({ getValue }) => <span className="screener-num">{getValue() ? compactFormatter.format(getValue()) : '—'}</span> }),
    FILTER_COL_HELPER.accessor('volumeSpike', { header: 'Vol/Avg', cell: ({ getValue }) => <span className="screener-num">{getValue() ? `${getValue()?.toFixed(1)}x` : '—'}</span> }),
    FILTER_COL_HELPER.accessor('rsi', { header: 'RSI', cell: ({ getValue }) => <span className="screener-num">{getValue() !== null ? `${getValue()}` : '—'}</span> }),
    FILTER_COL_HELPER.accessor('totalReturn', { header: 'Ret', cell: ({ getValue }) => {
      const v = getValue()
      return <span className={`screener-num ${toneFromValue(v)}`}>{formatSignedPercent(v)}</span>
    } }),
    FILTER_COL_HELPER.accessor('divYield', { header: 'Div', cell: ({ getValue }) => <span className="screener-num">{getValue() !== null ? `${getValue()!.toFixed(2)}%` : '—'}</span> }),
    FILTER_COL_HELPER.accessor('beta', { header: 'Beta', cell: ({ getValue }) => <span className="screener-num">{getValue() !== null ? getValue()!.toFixed(2) : '—'}</span> }),
  ], [userSymbolSet])

  const fTable = useReactTable({
    data: fItems, columns: fColumns as any,
    state: { sorting: fSorting },
    onSortingChange: setFSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const totalPages = fResults ? Math.ceil(fResults.total / pageSize) : 0

  function renderTHead(table: { getHeaderGroups: () => Array<{ id: string; headers: any[] }> }) {
    return (
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
            {hg.headers.map((h: any) => (
              <TableHeader key={h.id} header={h} />
            ))}
          </tr>
        ))}
      </thead>
    )
  }

  function renderTBody(rows: Array<{ id: string; original: any; getVisibleCells: () => any[] }>) {
    return (
      <tbody>
        {rows.map(row => (
          <tr key={row.id} className="screener-row" onClick={() => onSelectSymbol(row.original)}>
            {row.getVisibleCells().map((cell: any) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    )
  }

  return (
    <div className="screener-panel-new">
      {/* Toolbar */}
      <div className="screener-toolbar">
        <select className="screener-scope-select" value={mode === 'categories' ? scope : filter.scope}
          onChange={e => { const v = e.target.value; if (mode === 'categories') setScope(v); else updateFilter({ scope: v }) }}>
          {scopes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="screener-mode-toggle">
          <button className={`screener-mode-btn ${mode === 'categories' ? 'active' : ''}`} onClick={() => setMode('categories')}>Categories</button>
          <button className={`screener-mode-btn ${mode === 'filters' ? 'active' : ''}`} onClick={() => setMode('filters')}>Filters</button>
        </div>

        {mode === 'filters' && (
          <>
            <div className="screener-search-wrap">
              <Search size={12} />
              <input className="screener-search-input" placeholder="Symbol or name..." value={filter.nameQuery} onChange={e => updateFilter({ nameQuery: e.target.value })} />
            </div>
            <button className="screener-toggle-filters" onClick={() => setShowFilters(!showFilters)} title="Toggle filters">
              <SlidersHorizontal size={12} /> Filters
            </button>
            <div className="screener-preset-controls">
              <input className="screener-preset-input" placeholder="Preset name..." value={presetName} onChange={e => setPresetName(e.target.value)} />
              <button className="screener-preset-save" onClick={savePreset} title="Save filters as preset"><Save size={12} /></button>
              {Object.keys(presets).length > 0 && (
                <select className="screener-preset-load" value="" onChange={e => { if (e.target.value) applyPreset(e.target.value) }}>
                  <option value="">Load preset...</option>
                  {Object.keys(presets).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
            </div>
          </>
        )}
      </div>

      {/* Categories mode */}
      {mode === 'categories' && (
        <div className="screener-body-cat">
          <div className="screener-cat-tabs">
            {sections.map(s => (
              <button key={s.key} className={`screener-cat-tab ${activeSection === s.key ? 'active' : ''}`} onClick={() => setActiveSection(s.key)}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>

          <div className="screener-content">
            {catStatus === 'loading' && !catData && (
              <div className="screener-loading">
                <LoaderCircle className="spin" size={16} />
                {scopeProgress ? `Scanning ${scopeProgress.scanned} / ${scopeProgress.total} symbols...` : `Scanning ${scopes.find(s => s.value === scope)?.label || scope}...`}
              </div>
            )}
            {catStatus === 'error' && <div className="screener-error">{catError || 'Screener unavailable'}</div>}
            {catStatus === 'ready' && catData && catItems.length === 0 && (
              <div className="screener-empty">No results for this section.</div>
            )}
            {catItems.length > 0 && (
              <div className="screener-table-wrap">
                <table className="screener-table">
                  {renderTHead(catTable)}
                  {renderTBody(catTable.getRowModel().rows)}
                </table>
              </div>
            )}
            {catData && (
              <div className="screener-footer">
                Scanned {catData.scanned}{catData.total && catData.total !== catData.scanned ? ` / ${catData.total}` : ''} symbols ({scopes.find(s => s.value === catData.scope)?.label || catData.scope})
                {' · '}Updated {catData.updatedAt ? new Date(catData.updatedAt).toLocaleTimeString() : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters mode */}
      {mode === 'filters' && (
        <div className="screener-body">
          {showFilters && (
            <div className="screener-sidebar">
              <MultiSelect label="Sectors" options={allSectors} selected={filter.sectors} onChange={v => updateFilter({ sectors: v })} placeholder="All sectors" />
              <MultiSelect label="Industries" options={allIndustries} selected={filter.industries} onChange={v => updateFilter({ industries: v })} placeholder="All industries" />
              <RangeInput label="Market Cap" min={filter.marketCapMin} max={filter.marketCapMax}
                onMinChange={v => updateFilter({ marketCapMin: v })} onMaxChange={v => updateFilter({ marketCapMax: v })}
                presets={[
                  { label: 'Large', min: 10_000_000_000, max: null },
                  { label: 'Mid', min: 2_000_000_000, max: 10_000_000_000 },
                  { label: 'Small', min: 300_000_000, max: 2_000_000_000 },
                  { label: 'Micro', min: null, max: 300_000_000 },
                ]} />
              <RangeInput label="P/E Ratio" min={filter.peMin} max={filter.peMax}
                onMinChange={v => updateFilter({ peMin: v })} onMaxChange={v => updateFilter({ peMax: v })} />
              <RangeInput label="Avg Volume" min={filter.avgVolumeMin} max={filter.avgVolumeMax}
                onMinChange={v => updateFilter({ avgVolumeMin: v })} onMaxChange={v => updateFilter({ avgVolumeMax: v })} />
              <RangeInput label="Div Yield %" min={filter.divYieldMin} max={filter.divYieldMax}
                onMinChange={v => updateFilter({ divYieldMin: v })} onMaxChange={v => updateFilter({ divYieldMax: v })} />
              <RangeInput label="Beta" min={filter.betaMin} max={filter.betaMax}
                onMinChange={v => updateFilter({ betaMin: v })} onMaxChange={v => updateFilter({ betaMax: v })} />
              <RangeInput label="Short Float %" min={filter.shortFloatPctMin} max={filter.shortFloatPctMax}
                onMinChange={v => updateFilter({ shortFloatPctMin: v })} onMaxChange={v => updateFilter({ shortFloatPctMax: v })} />
              <RangeInput label="Institution %" min={filter.institutionPctMin} max={filter.institutionPctMax}
                onMinChange={v => updateFilter({ institutionPctMin: v })} onMaxChange={v => updateFilter({ institutionPctMax: v })} />
            </div>
          )}

          <div className="screener-content">
            {fLoading && (
              <div className="screener-loading">
                <LoaderCircle className="spin" size={16} />
                Searching {fResults ? `${fResults.total} symbols` : '...'}
              </div>
            )}
            {fError && <div className="screener-error">{fError}</div>}
            {!fLoading && fResults && fResults.results.length === 0 && (
              <div className="screener-empty">No symbols match filters. Try widening your criteria.</div>
            )}
            {fResults && fResults.results.length > 0 && (
              <div className="screener-table-wrap">
                <table className="screener-table">
                  {renderTHead(fTable)}
                  {renderTBody(fTable.getRowModel().rows)}
                </table>
              </div>
            )}
            {fResults && fResults.total > pageSize && (
              <div className="screener-pagination">
                <button className="screener-page-btn" disabled={page === 0} onClick={() => { setPage(p => p - 1); runSearch(page - 1) }}>
                  <ChevronLeft size={12} /> Prev
                </button>
                <span className="screener-page-info">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, fResults.total)} of {fResults.total}</span>
                <button className="screener-page-btn" disabled={page >= totalPages - 1} onClick={() => { setPage(p => p + 1); runSearch(page + 1) }}>
                  Next <ChevronRight size={12} />
                </button>
              </div>
            )}
            {fResults && (
              <div className="screener-footer">
                {fResults.total} symbols found · Page {page + 1} of {totalPages || 1}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
