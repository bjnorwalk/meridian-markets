import { Check, Plus } from 'lucide-react'
import type { SymbolRecord } from '../types/market'

export function SearchResultRow({
  item,
  resultId,
  isActive,
  isInWatchlist,
  onActive,
  onAddToWatchlist,
  onSelect,
}: {
  item: SymbolRecord
  resultId: string
  isActive: boolean
  isInWatchlist: boolean
  onActive: () => void
  onAddToWatchlist?: (item: SymbolRecord) => void | Promise<void>
  onSelect: (item: SymbolRecord) => void
}) {
  return (
    <div
      aria-selected={isActive}
      className={`search-result ${isActive ? 'is-active' : ''}`}
      id={resultId}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onActive}
      role="option"
    >
      <button
        className="search-result-main"
        onClick={() => onSelect(item)}
        type="button"
      >
        <span className="result-symbol">{item.symbol}</span>
        <span className="result-body">
          <strong>{item.name}</strong>
          <small>{item.sector}</small>
        </span>
        <span className="exchange-pill">{item.exchange}</span>
      </button>
      <button
        aria-label={
          isInWatchlist
            ? `${item.symbol} already in watchlist`
            : `Add ${item.symbol} to watchlist`
        }
        className="search-result-add"
        disabled={isInWatchlist}
        onClick={(event) => {
          event.stopPropagation()
          onAddToWatchlist?.(item)
        }}
        title={isInWatchlist ? 'In watchlist' : 'Add to watchlist'}
        type="button"
      >
        {isInWatchlist ? <Check aria-hidden="true" size={13} /> : <Plus aria-hidden="true" size={13} />}
      </button>
    </div>
  )
}
