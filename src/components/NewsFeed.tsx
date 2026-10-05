import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { NewsItem } from '../types/market'

type NewsFeedState = {
  symbol: string
  status: 'loading' | 'ready' | 'error'
  news: NewsItem[]
  error: string | null
}

export function NewsFeed({ symbol, compact }: { symbol: string; compact?: boolean }) {
  const [feedState, setFeedState] = useState<NewsFeedState>(() => ({
    symbol,
    status: 'loading',
    news: [],
    error: null,
  }))

  useEffect(() => {
    let isMounted = true

    fetch(`/api/market/news?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`News API error (${r.status})`)
        return r.json()
      })
      .then((data) => {
        if (!isMounted) return
        setFeedState({
          symbol,
          status: 'ready',
          news: data.news ?? [],
          error: null,
        })
      })
      .catch((err) => {
        if (!isMounted) return
        setFeedState({
          symbol,
          status: 'error',
          news: [],
          error: err instanceof Error ? err.message : 'News unavailable',
        })
      })
    return () => { isMounted = false }
  }, [symbol])

  const isCurrentSymbol = feedState.symbol === symbol
  const news = isCurrentSymbol ? feedState.news : []
  const error = isCurrentSymbol ? feedState.error : null
  const isLoading = !isCurrentSymbol || feedState.status === 'loading'

  if (error) return <div className="news-feed-compact"><small className="tone-negative">{error}</small></div>
  if (isLoading) return <div className="news-feed-compact"><small className="feed-state">Loading news…</small></div>
  if (news.length === 0) return <div className="news-feed-compact"><small className="feed-state">No recent news</small></div>

  if (compact) {
    return (
      <div className="news-feed-compact">
        {news.slice(0, 6).map((item) => (
          <a
            key={item.id}
            className="news-link"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{item.headline}</span>
            <small>{item.source}</small>
          </a>
        ))}
      </div>
    )
  }

  return (
    <div className="news-feed">
      <div className="pane-heading">
        <span>News</span>
      </div>
      <div className="news-strip">
        {news.slice(0, 8).map((item) => (
          <a
            key={item.id}
            className="news-card"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>{item.headline}</strong>
            <small>
              {item.source}
              <ExternalLink aria-hidden="true" size={12} />
            </small>
          </a>
        ))}
      </div>
    </div>
  )
}
