import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Save, Shield, Target, Trash2 } from 'lucide-react'
import type { AssetClass, OptionChainResponse, OptionContract, OptionType } from '../types/market'
import {
  compactFormatter,
  formatPlainPercent,
  formatPrice,
} from '../utils/format'

type ChainStatus = 'loading' | 'ready' | 'error'
type OptionSideFilter = 'all' | OptionType
type StrikeFilter = 'all' | 'near' | 'itm' | 'otm'
type ChainState = {
  symbol: string
  status: Exclude<ChainStatus, 'loading'>
  data: OptionChainResponse | null
  error: string | null
}
type StrategyPreview = {
  label: string
  premium: number
  maxLoss: number
  breakeven: number
  maxProfit: number | null
}
type PaperIdea = {
  id: string
  symbol: string
  contractSymbol: string
  strategy: string
  type: OptionType
  strike: number
  expirationDate: string
  premium: number
  breakeven: number
  maxLoss: number
  maxProfit: number | null
  createdAt: string
}

const paperIdeasStorageKey = 'meridian-paper-option-ideas-v1'
const paperCashStorageKey = 'meridian-paper-options-cash-v1'

const sideFilters: Array<{ key: OptionSideFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'put', label: 'Puts' },
]

const strikeFilters: Array<{ key: StrikeFilter; label: string }> = [
  { key: 'all', label: 'All strikes' },
  { key: 'near', label: 'Near money' },
  { key: 'itm', label: 'ITM' },
  { key: 'otm', label: 'OTM' },
]

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteOptionValue(...values: Array<number | null | undefined>) {
  return values.find(isFiniteNumber) ?? null
}

function formatOptionPrice(value: number | null | undefined) {
  return isFiniteNumber(value) ? formatPrice(value) : '--'
}

function formatOptionPercent(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '--'
  const normalized = Math.abs(value) <= 1.5 ? value * 100 : value
  return formatPlainPercent(normalized)
}

function formatGreek(value: number | null | undefined) {
  return isFiniteNumber(value) ? value.toFixed(2) : '--'
}

function formatCount(value: number | null | undefined) {
  return isFiniteNumber(value) ? compactFormatter.format(value) : '--'
}

function formatExpiration(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

function readStoredPaperIdeas(): PaperIdea[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(paperIdeasStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PaperIdea => Boolean(item?.id && item?.contractSymbol))
  } catch {
    return []
  }
}

function readStoredCash() {
  if (typeof window === 'undefined') return ''
  return window.localStorage?.getItem(paperCashStorageKey) ?? ''
}

function buildStrategyPreview(contract: OptionContract | null) {
  if (!contract) return null
  const premium = finiteOptionValue(contract.ask, contract.mid, contract.last, contract.bid)
  if (premium === null) return null

  const maxLoss = premium * 100
  const breakeven = contract.type === 'call'
    ? contract.strike + premium
    : contract.strike - premium
  const maxProfit = contract.type === 'call'
    ? null
    : Math.max((contract.strike - premium) * 100, 0)

  return {
    label: contract.type === 'call' ? 'Long call' : 'Long put',
    premium,
    maxLoss,
    breakeven,
    maxProfit,
  }
}

function isOptionSupported(assetClass?: AssetClass) {
  return assetClass !== 'crypto'
}

function getOptionMoneyness(contract: OptionContract, underlyingPrice: number | null) {
  if (!isFiniteNumber(underlyingPrice)) return null
  const isInTheMoney = contract.type === 'call'
    ? contract.strike < underlyingPrice
    : contract.strike > underlyingPrice
  const distancePercent = Math.abs(contract.strike - underlyingPrice) / underlyingPrice
  return { isInTheMoney, distancePercent }
}

function matchesStrikeFilter(
  contract: OptionContract,
  strikeFilter: StrikeFilter,
  underlyingPrice: number | null,
) {
  if (strikeFilter === 'all') return true
  const moneyness = getOptionMoneyness(contract, underlyingPrice)
  if (!moneyness) return true
  if (strikeFilter === 'near') return moneyness.distancePercent <= 0.05
  if (strikeFilter === 'itm') return moneyness.isInTheMoney
  return !moneyness.isInTheMoney
}

function calculatePayoffPoints(
  contract: OptionContract,
  strategyPreview: StrategyPreview,
  underlyingPrice: number | null,
) {
  const anchor = isFiniteNumber(underlyingPrice) ? underlyingPrice : contract.strike
  const low = Math.max(0.01, Math.min(contract.strike, anchor) * 0.72)
  const high = Math.max(contract.strike, anchor) * 1.28
  return Array.from({ length: 31 }, (_, index) => {
    const price = low + ((high - low) * index) / 30
    const intrinsic = contract.type === 'call'
      ? Math.max(price - contract.strike, 0)
      : Math.max(contract.strike - price, 0)
    return {
      price,
      payoff: (intrinsic - strategyPreview.premium) * 100,
    }
  })
}

function buildPayoffPath(points: Array<{ price: number; payoff: number }>) {
  const width = 320
  const height = 120
  const padding = 16
  const prices = points.map((point) => point.price)
  const payoffs = points.map((point) => point.payoff)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const minPayoff = Math.min(...payoffs, 0)
  const maxPayoff = Math.max(...payoffs, 0)
  const payoffRange = maxPayoff - minPayoff || 1
  const priceRange = maxPrice - minPrice || 1
  const xForPrice = (price: number) =>
    padding + ((price - minPrice) / priceRange) * (width - padding * 2)
  const yForPayoff = (payoff: number) =>
    height - padding - ((payoff - minPayoff) / payoffRange) * (height - padding * 2)
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xForPrice(point.price).toFixed(1)} ${yForPayoff(point.payoff).toFixed(1)}`)
    .join(' ')
  return {
    width,
    height,
    path,
    zeroY: yForPayoff(0),
    leftLabel: formatPrice(minPrice),
    rightLabel: formatPrice(maxPrice),
  }
}

export function OptionsPanel({
  symbol,
  assetClass,
  portfolioShares,
  underlyingPrice,
}: {
  symbol: string
  assetClass?: AssetClass
  portfolioShares: number
  underlyingPrice: number | null
}) {
  const [sideFilter, setSideFilter] = useState<OptionSideFilter>('all')
  const [strikeFilter, setStrikeFilter] = useState<StrikeFilter>('all')
  const [selectedExpiration, setSelectedExpiration] = useState('')
  const [selectedContractSymbol, setSelectedContractSymbol] = useState<string | null>(null)
  const [paperCash, setPaperCash] = useState(() => readStoredCash())
  const [paperIdeas, setPaperIdeas] = useState<PaperIdea[]>(() => readStoredPaperIdeas())
  const [chainState, setChainState] = useState<ChainState>(() => ({
    symbol: '',
    status: 'ready',
    data: null,
    error: null,
  }))

  useEffect(() => {
    if (!isOptionSupported(assetClass)) {
      return undefined
    }

    const controller = new AbortController()

    fetch(`/api/options/chain?symbol=${encodeURIComponent(symbol)}&limit=120`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error?.message ?? 'Options chain unavailable')
        }
        return payload as OptionChainResponse
      })
      .then((payload) => {
        setChainState({
          symbol,
          status: 'ready',
          data: payload,
          error: null,
        })
        setSelectedContractSymbol(null)
        setSelectedExpiration((current) =>
          current && payload.expirations.includes(current)
            ? current
            : payload.expirations[0] ?? '',
        )
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setChainState({
          symbol,
          status: 'error',
          data: null,
          error: reason instanceof Error ? reason.message : 'Options chain unavailable',
        })
      })

    return () => controller.abort()
  }, [assetClass, symbol])

  useEffect(() => {
    try {
      window.localStorage?.setItem(paperCashStorageKey, paperCash)
    } catch {
      // Paper cash is a local planning aid; losing persistence should not block the panel.
    }
  }, [paperCash])

  useEffect(() => {
    try {
      window.localStorage?.setItem(paperIdeasStorageKey, JSON.stringify(paperIdeas))
    } catch {
      // Saved ideas are optional local notes.
    }
  }, [paperIdeas])

  const isSupported = isOptionSupported(assetClass)
  const data = isSupported && chainState.symbol === symbol ? chainState.data : null
  const status: ChainStatus = isSupported && chainState.symbol === symbol
    ? chainState.status
    : 'loading'
  const error = isSupported && chainState.symbol === symbol ? chainState.error : null

  const filteredContracts = useMemo(() => {
    const contracts = data?.contracts ?? []
    return contracts.filter((contract) => {
      if (selectedExpiration && contract.expirationDate !== selectedExpiration) return false
      if (sideFilter !== 'all' && contract.type !== sideFilter) return false
      if (!matchesStrikeFilter(contract, strikeFilter, underlyingPrice)) return false
      return true
    })
  }, [data, selectedExpiration, sideFilter, strikeFilter, underlyingPrice])

  const selectedContract =
    filteredContracts.find((contract) => contract.symbol === selectedContractSymbol) ??
    filteredContracts[0] ??
    null
  const strategyPreview = useMemo(
    () => buildStrategyPreview(selectedContract),
    [selectedContract],
  )
  const payoffChart = useMemo(() => {
    if (!selectedContract || !strategyPreview) return null
    return buildPayoffPath(
      calculatePayoffPoints(selectedContract, strategyPreview, underlyingPrice),
    )
  }, [selectedContract, strategyPreview, underlyingPrice])
  const intrinsicValue = selectedContract && isFiniteNumber(underlyingPrice)
    ? selectedContract.type === 'call'
      ? Math.max(underlyingPrice - selectedContract.strike, 0)
      : Math.max(selectedContract.strike - underlyingPrice, 0)
    : null
  const displayedContracts = filteredContracts.slice(0, 18)
  const paperCashNumber = Number(paperCash)
  const usablePaperCash = Number.isFinite(paperCashNumber) && paperCashNumber > 0
    ? paperCashNumber
    : 0
  const coveredCallContracts = Math.floor(portfolioShares / 100)
  const putCashRequired = selectedContract?.type === 'put' ? selectedContract.strike * 100 : 0
  const savedForSymbol = paperIdeas
    .filter((idea) => idea.symbol === symbol)
    .slice(0, 5)

  const savePaperIdea = () => {
    if (!selectedContract || !strategyPreview) return
    const idea: PaperIdea = {
      id: `${selectedContract.symbol}-${Date.now()}`,
      symbol,
      contractSymbol: selectedContract.symbol,
      strategy: strategyPreview.label,
      type: selectedContract.type,
      strike: selectedContract.strike,
      expirationDate: selectedContract.expirationDate,
      premium: strategyPreview.premium,
      breakeven: strategyPreview.breakeven,
      maxLoss: strategyPreview.maxLoss,
      maxProfit: strategyPreview.maxProfit,
      createdAt: new Date().toISOString(),
    }
    setPaperIdeas((current) => [
      idea,
      ...current.filter((item) => item.contractSymbol !== idea.contractSymbol).slice(0, 11),
    ])
  }

  const removePaperIdea = (ideaId: string) => {
    setPaperIdeas((current) => current.filter((idea) => idea.id !== ideaId))
  }

  if (!isOptionSupported(assetClass)) {
    return (
      <div className="options-panel">
        <div className="options-state">
          Options unavailable for {symbol}
        </div>
      </div>
    )
  }

  return (
    <div className="options-panel">
      <div className="options-toolbar">
        <div>
          <strong>{symbol} options</strong>
          <small>{data?.source ?? 'Chain snapshot'}</small>
        </div>
        <div className="options-controls">
          <select
            aria-label="Options expiration"
            className="options-expiration"
            disabled={!data?.expirations.length}
            onChange={(event) => setSelectedExpiration(event.target.value)}
            value={selectedExpiration}
          >
            {data?.expirations.length ? (
              data.expirations.map((expiration) => (
                <option key={expiration} value={expiration}>
                  {formatExpiration(expiration)}
                </option>
              ))
            ) : (
              <option value="">Expiration</option>
            )}
          </select>
          <select
            aria-label="Strike filter"
            className="options-expiration options-strike-filter"
            onChange={(event) => setStrikeFilter(event.target.value as StrikeFilter)}
            value={strikeFilter}
          >
            {strikeFilters.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label}
              </option>
            ))}
          </select>
          <div className="trending-periods options-side-filter" role="tablist" aria-label="Option side">
            {sideFilters.map((item) => (
              <button
                aria-selected={sideFilter === item.key}
                className={sideFilter === item.key ? 'is-active' : undefined}
                key={item.key}
                onClick={() => setSideFilter(item.key)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {status === 'loading' && (
        <div className="options-state">
          <LoaderCircle aria-hidden="true" size={15} />
          Loading chain
        </div>
      )}

      {status === 'error' && (
        <div className="options-state tone-negative">{error}</div>
      )}

      {status === 'ready' && filteredContracts.length === 0 && (
        <div className="options-state">No contracts for this view.</div>
      )}

      {status === 'ready' && filteredContracts.length > 0 && (
        <>
          <div className="options-table-scroll">
            <div className="options-chain" aria-label={`${symbol} options chain`}>
              <div className="options-row options-head">
                <span>Side</span>
                <span>Strike</span>
                <span>Bid / Ask</span>
                <span>Mid</span>
                <span>IV / Delta</span>
                <span>Vol / OI</span>
              </div>
              {displayedContracts.map((contract) => (
                <button
                  aria-label={`Select ${contract.symbol}`}
                  aria-pressed={selectedContract?.symbol === contract.symbol}
                  className={`options-row ${selectedContract?.symbol === contract.symbol ? 'is-selected' : ''}`}
                  key={contract.symbol}
                  onClick={() => setSelectedContractSymbol(contract.symbol)}
                  type="button"
                >
                  <span className={`options-type options-${contract.type}`}>
                    {contract.type}
                  </span>
                  <span>{formatPrice(contract.strike)}</span>
                  <span>{formatOptionPrice(contract.bid)} / {formatOptionPrice(contract.ask)}</span>
                  <span>{formatOptionPrice(contract.mid)}</span>
                  <span>{formatOptionPercent(contract.impliedVolatility)} / {formatGreek(contract.delta)}</span>
                  <span>{formatCount(contract.volume)} / {formatCount(contract.openInterest)}</span>
                </button>
              ))}
            </div>
          </div>

          {strategyPreview && selectedContract && (
            <div className="options-preview">
              <div className="options-preview-heading">
                <Target aria-hidden="true" size={15} />
                <span>
                  <strong>{strategyPreview.label}</strong>
                  <small>{selectedContract.symbol}</small>
                </span>
              </div>
              <div className="options-preview-metric">
                <span>Premium</span>
                <strong>{formatPrice(strategyPreview.premium)}</strong>
              </div>
              <div className="options-preview-metric">
                <span>Breakeven</span>
                <strong>{formatPrice(strategyPreview.breakeven)}</strong>
              </div>
              <div className="options-preview-metric">
                <span>Max loss</span>
                <strong className="tone-negative">{formatPrice(strategyPreview.maxLoss)}</strong>
              </div>
              <div className="options-preview-metric">
                <span>Max profit</span>
                <strong>
                  {strategyPreview.maxProfit === null
                    ? 'Unlimited'
                    : formatPrice(strategyPreview.maxProfit)}
                </strong>
              </div>
              <div className="options-preview-metric">
                <span>Intrinsic</span>
                <strong>{formatOptionPrice(intrinsicValue)}</strong>
              </div>
              <div className="options-risk-chip">
                <Shield aria-hidden="true" size={14} />
                Read-only
              </div>
            </div>
          )}

          {strategyPreview && selectedContract && payoffChart && (
            <div className="options-phase-two">
              <section className="options-payoff" aria-label="Strategy payoff">
                <div className="options-section-heading">
                  <span>Payoff</span>
                  <strong>{strategyPreview.label}</strong>
                </div>
                <svg
                  aria-hidden="true"
                  className="options-payoff-chart"
                  viewBox={`0 0 ${payoffChart.width} ${payoffChart.height}`}
                >
                  <line
                    className="options-payoff-zero"
                    x1="12"
                    x2={payoffChart.width - 12}
                    y1={payoffChart.zeroY}
                    y2={payoffChart.zeroY}
                  />
                  <path className="options-payoff-path" d={payoffChart.path} />
                </svg>
                <div className="options-payoff-labels">
                  <span>{payoffChart.leftLabel}</span>
                  <strong>{formatPrice(strategyPreview.breakeven)} breakeven</strong>
                  <span>{payoffChart.rightLabel}</span>
                </div>
              </section>

              <section className="options-checks" aria-label="Portfolio option checks">
                <div className="options-section-heading">
                  <span>Checks</span>
                  <strong>{selectedContract.type === 'call' ? 'Covered call' : 'Cash-secured put'}</strong>
                </div>
                <label className="options-cash-input">
                  <span>Paper cash</span>
                  <input
                    aria-label="Paper cash available"
                    min="0"
                    onChange={(event) => setPaperCash(event.target.value)}
                    placeholder="0"
                    step="100"
                    type="number"
                    value={paperCash}
                  />
                </label>
                {selectedContract.type === 'call' ? (
                  <div className={`options-check ${coveredCallContracts > 0 ? 'is-pass' : 'is-warn'}`}>
                    <strong>{coveredCallContracts > 0 ? 'Covered' : 'Needs shares'}</strong>
                    <span>{portfolioShares} shares / {coveredCallContracts} contracts</span>
                  </div>
                ) : (
                  <div className={`options-check ${usablePaperCash >= putCashRequired ? 'is-pass' : 'is-warn'}`}>
                    <strong>{usablePaperCash >= putCashRequired ? 'Cash secured' : 'Cash gap'}</strong>
                    <span>
                      {formatPrice(usablePaperCash)} / {formatPrice(putCashRequired)}
                    </span>
                  </div>
                )}
              </section>

              <section className="options-ideas" aria-label="Paper option ideas">
                <div className="options-section-heading">
                  <span>Paper Ideas</span>
                  <button
                    disabled={!strategyPreview}
                    onClick={savePaperIdea}
                    type="button"
                  >
                    <Save aria-hidden="true" size={14} />
                    Save
                  </button>
                </div>
                {savedForSymbol.length === 0 ? (
                  <div className="options-empty-note">No saved ideas for {symbol}.</div>
                ) : (
                  savedForSymbol.map((idea) => (
                    <div className="options-idea-row" key={idea.id}>
                      <span>
                        <strong>{idea.strategy}</strong>
                        <small>{formatExpiration(idea.expirationDate)} / {formatPrice(idea.strike)}</small>
                      </span>
                      <span>
                        <strong>{formatPrice(idea.breakeven)}</strong>
                        <small>{formatPrice(idea.maxLoss)} risk</small>
                      </span>
                      <button
                        aria-label={`Remove ${idea.contractSymbol} idea`}
                        onClick={() => removePaperIdea(idea.id)}
                        title="Remove idea"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={13} />
                      </button>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
