import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import type { QuoteSnapshot, SymbolRecord } from '../types/market'
import { Sparkline } from './Sparkline'
import { formatPrice, formatSignedCurrency, percentFormatter } from '../utils/format'

function SortableWatchlistRow({
  symbol,
  isSelected,
  snapshot,
  sparkline,
  dragEnabled,
  onSelect,
  onRemove,
}: {
  symbol: SymbolRecord
  isSelected: boolean
  snapshot: QuoteSnapshot | null
  sparkline?: { t: string; c: number }[]
  dragEnabled: boolean
  onSelect: (symbol: string) => void
  onRemove?: (symbol: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: symbol.symbol, disabled: !dragEnabled })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const tone =
    snapshot && snapshot.changePercent < 0
      ? 'negative'
      : snapshot && snapshot.changePercent > 0
        ? 'positive'
        : undefined
  const sparklineData =
    sparkline && sparkline.length > 1
      ? sparkline
      : snapshot
        ? [
            { t: 'previous', c: snapshot.previousClose },
            { t: 'latest', c: snapshot.price },
          ]
        : []

  return (
    <div
      className={`watch-row-wrap ${isSelected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      ref={setNodeRef}
      style={style}
    >
      {dragEnabled && (
        <button
          aria-label={`Reorder ${symbol.symbol}`}
          className="watch-drag"
          title="Drag to reorder"
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" size={14} />
        </button>
      )}
      <button
        className="watch-row"
        onClick={() => onSelect(symbol.symbol)}
        type="button"
      >
        <span className="watch-symbol-col">
          <strong>{symbol.symbol}</strong>
          <small>{symbol.name}</small>
        </span>
        <span className="watch-spark-col">
          <Sparkline data={sparklineData} width={36} height={20} />
        </span>
        <span className="watch-price">
          <strong>{snapshot ? formatPrice(snapshot.price) : '--'}</strong>
          <small className={tone ? `tone-${tone}` : undefined}>
            {snapshot
              ? `${formatSignedCurrency(snapshot.change)} / ${snapshot.changePercent >= 0 ? '+' : ''}${percentFormatter.format(snapshot.changePercent)}%`
              : '--'}
          </small>
        </span>
      </button>
      {onRemove && (
        <button
          aria-label={`Remove ${symbol.symbol} from watchlist`}
          className="watch-remove"
          onClick={() => onRemove(symbol.symbol)}
          title="Remove"
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  )
}

export { SortableWatchlistRow }
