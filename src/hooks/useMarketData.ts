import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultWatchlist } from '../data/symbols'
import {
  apiMarketProvider,
  getApiMarketStatus,
  labelFromStatus,
} from '../services/apiMarketProvider'
import { demoMarketProvider } from '../services/demoMarketProvider'
import {
  addUserPortfolioHolding,
  addUserWatchlistItem,
  createUserWatchlist,
  deleteUserWatchlist,
  getUserPreferences,
  getUserPortfolio,
  getUserWatchlists,
  renameUserWatchlist,
  removeUserPortfolioHolding,
  removeUserWatchlistItem,
  reorderUserWatchlistItems,
  setActiveUserWatchlist,
  updateUserAlertSettings,
  updateUserPortfolioHolding,
} from '../services/userApi'
import type {
  AlertSettings,
  Bar,
  MarketDataProvider,
  PortfolioHolding,
  PortfolioHoldingInput,
  QuoteSnapshot,
  SymbolRecord,
  Timeframe,
  WatchlistRecord,
} from '../types/market'

const defaultAlertSettings: AlertSettings = {
  driftPercent: 5,
  concentrationPercent: 35,
  dayMovePercent: 2,
}

export function useMarketData(isAuthenticated: boolean) {
  const [provider, setProvider] = useState<MarketDataProvider>(demoMarketProvider)
  const [providerLabel, setProviderLabel] = useState(demoMarketProvider.label)
  const [symbols, setSymbols] = useState<SymbolRecord[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState(defaultWatchlist[0])
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [requestId, setRequestId] = useState(0)
  const [bars, setBars] = useState<Bar[]>([])
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null)
  const [watchlists, setWatchlists] = useState<WatchlistRecord[]>([])
  const [activeWatchlistId, setActiveWatchlistId] = useState('')
  const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([])
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(defaultAlertSettings)
  const [watchlistSnapshots, setWatchlistSnapshots] = useState<Record<string, QuoteSnapshot>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const selectedSymbolRef = useRef(selectedSymbol)

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol
  }, [selectedSymbol])

  const applyWatchlistsPayload = useCallback((payload: {
    watchlists: WatchlistRecord[]
    activeWatchlistId: string
  }) => {
    setWatchlists(payload.watchlists)
    setActiveWatchlistId(payload.activeWatchlistId)
  }, [])

  useEffect(() => {
    let isMounted = true

    getApiMarketStatus()
      .then((status) => {
        if (!isMounted) return
        setProviderLabel(labelFromStatus(status))
        if (status.configured) {
          setProvider(apiMarketProvider)
          setIsLoading(true)
        }
      })
      .catch(() => {
        if (isMounted) setProviderLabel(demoMarketProvider.label)
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    provider
      .listSymbols()
      .then((items) => {
        if (isMounted) setSymbols(items)
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : 'Symbol list failed')
        }
      })

    return () => {
      isMounted = false
    }
  }, [provider])

  useEffect(() => {
    let isMounted = true

    if (!isAuthenticated) {
      return () => {
        isMounted = false
      }
    }

    getUserWatchlists()
      .then((payload) => {
        if (isMounted) applyWatchlistsPayload(payload)
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setWatchlistError(
          reason instanceof Error ? reason.message : 'Watchlist failed',
        )
      })

    getUserPortfolio()
      .then((payload) => {
        if (isMounted) setPortfolio(payload.portfolio)
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setPortfolioError(
          reason instanceof Error ? reason.message : 'Portfolio failed',
        )
      })

    getUserPreferences()
      .then((payload) => {
        if (isMounted) setAlertSettings(payload.preferences.alerts)
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setPortfolioError(
          reason instanceof Error ? reason.message : 'Preferences failed',
        )
      })

    return () => {
      isMounted = false
    }
  }, [applyWatchlistsPayload, isAuthenticated])

  const activeWatchlist = useMemo(
    () =>
      watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ??
      watchlists[0] ??
      null,
    [activeWatchlistId, watchlists],
  )
  const watchlist = useMemo(() => activeWatchlist?.items ?? [], [activeWatchlist])

  useEffect(() => {
    let isMounted = true
    const activeSymbols = [...watchlist.map((item) => item.symbol), ...portfolio.map((item) => item.symbol)]
    const snapshotSymbols =
      activeSymbols.length > 0 ? Array.from(new Set(activeSymbols)) : defaultWatchlist

    Promise.allSettled(
      snapshotSymbols.map((symbol) => provider.getSnapshot(symbol, '1D')),
    ).then((results) => {
      if (!isMounted) return
      const snapshots = results
        .filter((result): result is PromiseFulfilledResult<QuoteSnapshot> => result.status === 'fulfilled')
        .map((result) => result.value)

      setWatchlistSnapshots(
        (current) => ({
          ...current,
          ...Object.fromEntries(snapshots.map((item) => [item.symbol, item])),
        }),
      )
    })

    return () => {
      isMounted = false
    }
  }, [portfolio, provider, requestId, watchlist])

  useEffect(() => {
    let isMounted = true

    Promise.all([
      provider.getBars(selectedSymbol, timeframe),
      provider.getSnapshot(selectedSymbol, timeframe),
    ])
      .then(([nextBars, nextSnapshot]) => {
        if (!isMounted) return
        setBars(nextBars)
        setSnapshot(nextSnapshot)
        setWatchlistSnapshots((current) => ({
          ...current,
          [nextSnapshot.symbol]: nextSnapshot,
        }))
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : 'Market data failed')
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [provider, requestId, selectedSymbol, timeframe])

  useEffect(() => {
    const unsubscribe = provider.subscribe(selectedSymbol, timeframe, (tick) => {
      if (tick.snapshot.symbol !== selectedSymbolRef.current) return
      setSnapshot(tick.snapshot)
      setWatchlistSnapshots((current) => ({
        ...current,
        [tick.snapshot.symbol]: tick.snapshot,
      }))
      setBars((current) => {
        if (current.length === 0) return [tick.lastBar]
        const next = current.slice()
        next[next.length - 1] = tick.lastBar
        return next
      })
    })

    return unsubscribe
  }, [provider, selectedSymbol, timeframe])

  const selectedRecord = useMemo(
    () =>
      symbols.find((item) => item.symbol === selectedSymbol) ??
      watchlist.find((item) => item.symbol === selectedSymbol) ??
      null,
    [selectedSymbol, symbols, watchlist],
  )

  const selectSymbol = (symbol: string) => {
    if (symbol === selectedSymbol) return
    setError(null)
    setIsLoading(true)
    setBars([])
    setSnapshot(null)
    setSelectedSymbol(symbol)
  }

  const selectTimeframe = (nextTimeframe: Timeframe) => {
    if (nextTimeframe === timeframe) return
    setError(null)
    setIsLoading(true)
    setBars([])
    setTimeframe(nextTimeframe)
  }

  const refresh = () => {
    setError(null)
    setIsLoading(true)
    setRequestId((current) => current + 1)
  }

  const addToWatchlist = async (record: SymbolRecord) => {
    setWatchlistError(null)
    if (!activeWatchlist) return
    const payload = await addUserWatchlistItem(activeWatchlist.id, record)
    applyWatchlistsPayload(payload)
  }

  const removeFromWatchlist = async (symbol: string) => {
    setWatchlistError(null)
    if (!activeWatchlist) return
    const payload = await removeUserWatchlistItem(activeWatchlist.id, symbol)
    applyWatchlistsPayload(payload)
  }

  const setActiveWatchlist = async (watchlistId: string) => {
    setWatchlistError(null)
    const payload = await setActiveUserWatchlist(watchlistId)
    applyWatchlistsPayload(payload)
  }

  const createWatchlist = async (name: string) => {
    setWatchlistError(null)
    const payload = await createUserWatchlist(name)
    applyWatchlistsPayload(payload)
  }

  const renameWatchlist = async (watchlistId: string, name: string) => {
    setWatchlistError(null)
    const payload = await renameUserWatchlist(watchlistId, name)
    applyWatchlistsPayload(payload)
  }

  const deleteWatchlist = async (watchlistId: string) => {
    setWatchlistError(null)
    const payload = await deleteUserWatchlist(watchlistId)
    applyWatchlistsPayload(payload)
  }

  const reorderWatchlistItems = async (symbols: string[]) => {
    setWatchlistError(null)
    if (!activeWatchlist) return
    const previousWatchlists = watchlists
    setWatchlists((current) =>
      current.map((watchlist) =>
        watchlist.id === activeWatchlist.id
          ? {
              ...watchlist,
              items: symbols
                .map((symbol) => watchlist.items.find((item) => item.symbol === symbol))
                .filter((item): item is SymbolRecord => Boolean(item)),
            }
          : watchlist,
      ),
    )
    try {
      const payload = await reorderUserWatchlistItems(activeWatchlist.id, symbols)
      applyWatchlistsPayload(payload)
    } catch (reason) {
      setWatchlists(previousWatchlists)
      setWatchlistError(reason instanceof Error ? reason.message : 'Watchlist reorder failed')
      throw reason
    }
  }

  const addPortfolioHolding = async (holding: PortfolioHoldingInput) => {
    setPortfolioError(null)
    const payload = await addUserPortfolioHolding(holding)
    setPortfolio(payload.portfolio)
  }

  const updatePortfolioHolding = async (
    holdingId: string,
    holding: PortfolioHoldingInput,
  ) => {
    setPortfolioError(null)
    const payload = await updateUserPortfolioHolding(holdingId, holding)
    setPortfolio(payload.portfolio)
  }

  const removePortfolioHolding = async (holdingId: string) => {
    setPortfolioError(null)
    const payload = await removeUserPortfolioHolding(holdingId)
    setPortfolio(payload.portfolio)
  }

  const updateAlertSettings = async (alerts: AlertSettings) => {
    setPortfolioError(null)
    const payload = await updateUserAlertSettings(alerts)
    setAlertSettings(payload.preferences.alerts)
  }

  return {
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
    setSelectedSymbol: selectSymbol,
    timeframe,
    setTimeframe: selectTimeframe,
    bars,
    snapshot,
    watchlistSnapshots,
    isLoading,
    error,
    watchlistError,
    portfolioError,
    refresh,
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
    searchSymbols: provider.searchSymbols,
  }
}
