import { useEffect, useState } from 'react'
import { LoaderCircle, TrendingUp } from 'lucide-react'
import type { TrendingItem, TrendingPeriod, TrendingResponse } from '../types/market'
import {
  compactFormatter,
  formatPrice,
  formatSignedCurrency,
  formatSignedPercent,
  toneFromValue,
} from '../utils/format'

const periods: Array<{ key: TrendingPeriod; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

type TrendingState = {
  period: TrendingPeriod
  status: 'loading' | 'ready' | 'error'
  data: TrendingResponse | null
  error: string | null
}

export function TrendingPanel({
  onSelectSymbol,
}: {
  onSelectSymbol: (item: TrendingItem) => void
}) {
  const [period, setPeriod] = useState<TrendingPeriod>('day')
  const [trendingState, setTrendingState] = useState<TrendingState>(() => ({
    period: 'day',
    status: 'loading',
    data: null,
    error: null,
  }))

  useEffect(() => {
    let isMounted = true

    fetch(`/api/market/trending?period=${period}`, {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error?.message ?? 'Trending data unavailable')
        }
        return payload as TrendingResponse
      })
      .then((payload) => {
        if (!isMounted) return
        setTrendingState({
          period,
          status: 'ready',
          data: payload,
          error: null,
        })
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setTrendingState({
          period,
          status: 'error',
          data: null,
          error: reason instanceof Error ? reason.message : 'Trending data unavailable',
        })
      })

    return () => { isMounted = false }
  }, [period])

  const selectPeriod = (nextPeriod: TrendingPeriod) => {
    if (nextPeriod === period) return
    setPeriod(nextPeriod)
  }

  const isCurrentPeriod = trendingState.period === period
  const data = isCurrentPeriod ? trendingState.data : null
  const error = isCurrentPeriod ? trendingState.error : null
  const isLoading = !isCurrentPeriod || trendingState.status === 'loading'

  return (
    <div className="trending-panel">
      <div className="trending-toolbar">
        <div>
          <strong>Market leaders</strong>
          <small>{data?.source ?? 'Top performers'}</small>
        </div>
        <div className="trending-controls">
          <div className="trending-periods" role="tablist" aria-label="Trending timeframe">
            {periods.map((item) => (
              <button
                aria-selected={period === item.key}
                className={period === item.key ? 'is-active' : undefined}
                key={item.key}
                onClick={() => selectPeriod(item.key)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {data && !isLoading && !error && (
          <small className="trending-updated">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </small>
        )}
      </div>

      {isLoading && (
        <div className="trending-state">
          <LoaderCircle aria-hidden="true" size={15} />
          Loading leaders
        </div>
      )}

      {!isLoading && error && (
        <div className="trending-state">{error}</div>
      )}

      {!isLoading && !error && data?.items.length === 0 && (
        <div className="trending-state">No leaders available yet.</div>
      )}

      {!isLoading && !error && data?.items.length ? (
        <div className="trending-list">
          {data.items.slice(0, 8).map((item) => {
            const tone = toneFromValue(item.changePercent)
            return (
              <button
                className="trending-row"
                key={`${period}-${item.symbol}`}
                onClick={() => onSelectSymbol(item)}
                type="button"
              >
                <span className="trending-rank">
                  <TrendingUp aria-hidden="true" size={13} />
                  {String(item.rank).padStart(2, '0')}
                </span>
                <span className="trending-symbol">
                  <strong>{item.symbol}</strong>
                  <small>{item.name}</small>
                </span>
                <span className="trending-price">
                  <strong>{formatPrice(item.price)}</strong>
                  <small className={tone ? `tone-${tone}` : undefined}>
                    {formatSignedCurrency(item.change)} / {formatSignedPercent(item.changePercent)}
                  </small>
                </span>
                <span className="trending-volume">
                  {item.volume > 0 ? compactFormatter.format(item.volume) : '--'}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
