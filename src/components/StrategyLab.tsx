import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle,
  LoaderCircle,
  Play,
  RefreshCcw,
  Save,
  Shield,
  StopCircle,
} from 'lucide-react'
import type {
  OptionStrategyStructure,
  PaperDeployment,
  PortfolioHolding,
  StrategyBacktestResponse,
  StrategyConfig,
  StrategyCopilotResponse,
  StrategyHealthResponse,
  StrategyInstrument,
  StrategyMonitorResponse,
  StrategyType,
  Timeframe,
} from '../types/market'
import {
  formatPlainPercent,
  formatPrice,
  formatSignedCurrency,
  formatSignedPercent,
  toneFromValue,
} from '../utils/format'

type LoadState = 'idle' | 'loading' | 'error'

const defaultConfig: StrategyConfig = {
  symbol: 'AAPL',
  timeframe: '1M',
  instrument: 'equity',
  strategyType: 'trend_breakout',
  optionStructure: 'long_call',
  startingCapital: 100000,
  riskPerTradePercent: 1,
  maxPositionPercent: 20,
  maxDailyLossPercent: 3,
  maxDrawdownPercent: 12,
  stopLossPercent: 4,
}

const strategyOptions: Array<{ value: StrategyType; label: string }> = [
  { value: 'trend_breakout', label: 'Trend breakout' },
  { value: 'mean_reversion', label: 'Mean reversion' },
  { value: 'moving_average_cross', label: 'MA cross' },
]

const timeframeOptions: Timeframe[] = ['1D', '1W', '1M', '6M', '1Y']

const optionStructures: Array<{ value: OptionStrategyStructure; label: string; tone: string }> = [
  { value: 'long_call', label: 'Long call', tone: 'Directional' },
  { value: 'long_put', label: 'Long put', tone: 'Hedge' },
  { value: 'covered_call', label: 'Covered call', tone: 'Income' },
  { value: 'cash_secured_put', label: 'Cash-secured put', tone: 'Income' },
  { value: 'bull_call_spread', label: 'Bull call spread', tone: 'Defined risk' },
  { value: 'bear_put_spread', label: 'Bear put spread', tone: 'Defined risk' },
  { value: 'iron_condor', label: 'Iron condor', tone: 'Range' },
]

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatDateTime(value: string | number | null | undefined) {
  if (!value) return '--'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPercent(value: number | null | undefined) {
  return isFiniteNumber(value) ? formatPlainPercent(value) : '--'
}

function buildEquityPath(points: StrategyBacktestResponse['equityCurve']) {
  if (points.length < 2) return null
  const width = 520
  const height = 160
  const padding = 16
  const min = Math.min(...points.map((point) => point.equity))
  const max = Math.max(...points.map((point) => point.equity))
  const range = max - min || 1
  const step = (width - padding * 2) / (points.length - 1)
  const path = points.map((point, index) => {
    const x = padding + index * step
    const y = height - padding - ((point.equity - min) / range) * (height - padding * 2)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return {
    width,
    height,
    path,
    min,
    max,
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')
  if (init?.body) headers.set('content-type', 'application/json')

  const response = await fetch(url, {
    ...init,
    headers,
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'Strategy request failed')
  }
  return payload as T
}

function updateNumber(
  setter: Dispatch<SetStateAction<StrategyConfig>>,
  key: keyof Pick<
    StrategyConfig,
    | 'startingCapital'
    | 'riskPerTradePercent'
    | 'maxPositionPercent'
    | 'maxDailyLossPercent'
    | 'maxDrawdownPercent'
    | 'stopLossPercent'
  >,
  value: string,
) {
  const nextValue = Number(value)
  setter((current) => ({
    ...current,
    [key]: Number.isFinite(nextValue) ? nextValue : current[key],
  }))
}

export function StrategyLab({
  selectedSymbol,
  portfolio,
  underlyingPrice,
}: {
  selectedSymbol: string
  portfolio: PortfolioHolding[]
  underlyingPrice: number | null
}) {
  const [config, setConfig] = useState<StrategyConfig>(() => ({
    ...defaultConfig,
    symbol: selectedSymbol,
  }))
  const [health, setHealth] = useState<StrategyHealthResponse | null>(null)
  const [monitor, setMonitor] = useState<StrategyMonitorResponse | null>(null)
  const [killSwitchState, setKillSwitchState] = useState<StrategyMonitorResponse['killSwitch'] | null>(null)
  const [backtest, setBacktest] = useState<StrategyBacktestResponse | null>(null)
  const [copilot, setCopilot] = useState<StrategyCopilotResponse | null>(null)
  const [copilotPrompt, setCopilotPrompt] = useState('Trend breakout with strict risk controls')
  const [killReason, setKillReason] = useState('')
  const [healthState, setHealthState] = useState<LoadState>('idle')
  const [backtestState, setBacktestState] = useState<LoadState>('idle')
  const [copilotState, setCopilotState] = useState<LoadState>('idle')
  const [deployState, setDeployState] = useState<LoadState>('idle')
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiMessage, setUiMessage] = useState<string | null>(null)

  const selectedHolding = useMemo(
    () => portfolio.find((holding) => holding.symbol === config.symbol) ?? null,
    [config.symbol, portfolio],
  )
  const equityPath = useMemo(
    () => (backtest ? buildEquityPath(backtest.equityCurve) : null),
    [backtest],
  )

  const refreshHealth = async () => {
    setHealthState('loading')
    setUiError(null)
    try {
      const [nextHealth, nextMonitor] = await Promise.all([
        requestJson<StrategyHealthResponse>(`/api/strategy/health?symbol=${encodeURIComponent(config.symbol)}`),
        requestJson<StrategyMonitorResponse>('/api/strategy/monitor'),
      ])
      setHealth(nextHealth)
      setMonitor(nextMonitor)
      setKillSwitchState(nextMonitor.killSwitch ?? nextHealth.killSwitch)
      setHealthState('idle')
    } catch (reason) {
      setHealthState('error')
      setUiError(reason instanceof Error ? reason.message : 'Strategy health unavailable')
    }
  }

  useEffect(() => {
    let isMounted = true
    Promise.all([
      requestJson<StrategyHealthResponse>(`/api/strategy/health?symbol=${encodeURIComponent(config.symbol)}`),
      requestJson<StrategyMonitorResponse>('/api/strategy/monitor'),
    ])
      .then(([nextHealth, nextMonitor]) => {
        if (!isMounted) return
        setHealth(nextHealth)
        setMonitor(nextMonitor)
        setKillSwitchState(nextMonitor.killSwitch ?? nextHealth.killSwitch)
        setHealthState('idle')
      })
      .catch((reason: unknown) => {
        if (!isMounted) return
        setHealthState('error')
        setUiError(reason instanceof Error ? reason.message : 'Strategy health unavailable')
      })
    return () => {
      isMounted = false
    }
  }, [config.symbol])

  const runCopilot = async () => {
    setCopilotState('loading')
    setUiError(null)
    setUiMessage(null)
    try {
      const payload = await requestJson<StrategyCopilotResponse>('/api/strategy/copilot', {
        method: 'POST',
        body: JSON.stringify({
          symbol: config.symbol,
          prompt: copilotPrompt,
        }),
      })
      setCopilot(payload)
      setConfig(payload.draft)
      setCopilotState('idle')
      setUiMessage('Copilot draft loaded.')
    } catch (reason) {
      setCopilotState('error')
      setUiError(reason instanceof Error ? reason.message : 'Copilot draft failed')
    }
  }

  const runBacktest = async () => {
    setBacktestState('loading')
    setUiError(null)
    setUiMessage(null)
    try {
      const payload = await requestJson<StrategyBacktestResponse>('/api/strategy/backtest', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      setBacktest(payload)
      setBacktestState('idle')
      setUiMessage('Backtest generated.')
      void refreshHealth()
    } catch (reason) {
      setBacktestState('error')
      setUiError(reason instanceof Error ? reason.message : 'Backtest failed')
    }
  }

  const deployPaper = async () => {
    if (!backtest) {
      setUiError('Run a backtest before deploying to the paper simulator.')
      return
    }
    setDeployState('loading')
    setUiError(null)
    setUiMessage(null)
    try {
      const payload = await requestJson<{ deployment: PaperDeployment; killSwitch: StrategyMonitorResponse['killSwitch'] }>('/api/strategy/deploy-paper', {
        method: 'POST',
        body: JSON.stringify({
          config: backtest.config,
          metrics: backtest.metrics,
        }),
      })
      setMonitor((current) => ({
        deployments: [payload.deployment, ...(current?.deployments ?? []).filter((item) => item.id !== payload.deployment.id)],
        audit: current?.audit ?? [],
        killSwitch: payload.killSwitch,
        updatedAt: Date.now(),
      }))
      setKillSwitchState(payload.killSwitch)
      setDeployState('idle')
      setUiMessage(payload.deployment.status === 'blocked' ? 'Deployment blocked.' : 'Paper deployment started.')
      void refreshHealth()
    } catch (reason) {
      setDeployState('error')
      setUiError(reason instanceof Error ? reason.message : 'Paper deployment failed')
    }
  }

  const toggleKillSwitch = async () => {
    const enabled = !(killSwitchState?.enabled ?? monitor?.killSwitch.enabled ?? health?.killSwitch.enabled ?? false)
    setUiError(null)
    setUiMessage(null)
    try {
      const payload = await requestJson<{ killSwitch: StrategyMonitorResponse['killSwitch']; monitor: StrategyMonitorResponse }>('/api/strategy/kill-switch', {
        method: 'POST',
        body: JSON.stringify({
          enabled,
          reason: enabled ? killReason : '',
        }),
      })
      setMonitor(payload.monitor)
      setKillSwitchState(payload.killSwitch)
      setHealth((current) => current ? { ...current, killSwitch: payload.killSwitch } : current)
      setUiMessage(payload.killSwitch.enabled ? 'Kill switch enabled.' : 'Kill switch disabled.')
    } catch (reason) {
      setUiError(reason instanceof Error ? reason.message : 'Kill switch update failed')
    }
  }

  const portfolioShares = selectedHolding?.shares ?? 0
  const paperCash = config.startingCapital
  const coveredCalls = Math.floor(portfolioShares / 100)
  const estimatedUnderlying = underlyingPrice && config.symbol === selectedSymbol
    ? underlyingPrice
    : selectedHolding?.averageCost ?? 0
  const cashSecuredContracts = estimatedUnderlying > 0
    ? Math.floor(paperCash / (estimatedUnderlying * 95))
    : 0
  const latestDeployments = (monitor?.deployments ?? []).slice(0, 4)
  const latestAudit = (monitor?.audit ?? []).slice(0, 7)
  const killSwitchEnabled = killSwitchState?.enabled ?? monitor?.killSwitch.enabled ?? health?.killSwitch.enabled ?? false
  const resultTone = toneFromValue(backtest?.metrics.totalReturnPercent ?? 0)

  return (
    <div className="strategy-lab">
      <div className="strategy-toolbar">
        <div>
          <strong>{config.symbol} Strategy Lab</strong>
          <small>
            {health?.provider.provider === 'alpaca' ? 'Alpaca connected' : 'Demo data'} / Paper simulator
          </small>
        </div>
        <div className="strategy-toolbar-actions">
          <button
            aria-label="Refresh strategy health"
            disabled={healthState === 'loading'}
            onClick={() => void refreshHealth()}
            title="Refresh"
            type="button"
          >
            {healthState === 'loading'
              ? <LoaderCircle aria-hidden="true" className="spin-icon" size={14} />
              : <RefreshCcw aria-hidden="true" size={14} />}
          </button>
          <button
            aria-label={killSwitchEnabled ? 'Disable kill switch' : 'Enable kill switch'}
            className={killSwitchEnabled ? 'strategy-danger-button is-active' : 'strategy-danger-button'}
            onClick={() => void toggleKillSwitch()}
            title={killSwitchEnabled ? 'Disable kill switch' : 'Enable kill switch'}
            type="button"
          >
            <StopCircle aria-hidden="true" size={14} />
            {killSwitchEnabled ? 'Enabled' : 'Kill switch'}
          </button>
        </div>
      </div>

      {uiError && <div className="strategy-alert tone-negative">{uiError}</div>}
      {uiMessage && <div className="strategy-alert">{uiMessage}</div>}

      <div className="strategy-health-grid">
        {(health?.checks ?? []).map((check) => (
          <div className={`strategy-health-card status-${check.status}`} key={check.key}>
            {check.status === 'ok'
              ? <CheckCircle aria-hidden="true" size={15} />
              : <AlertTriangle aria-hidden="true" size={15} />}
            <span>
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="strategy-workbench">
        <section className="strategy-builder">
          <div className="strategy-section-heading">
            <span>Copilot</span>
            <strong>{copilot?.title ?? 'Strategy draft'}</strong>
          </div>
          <textarea
            aria-label="Strategy copilot prompt"
            maxLength={400}
            onChange={(event) => setCopilotPrompt(event.target.value)}
            value={copilotPrompt}
          />
          <div className="strategy-builder-actions">
            <button
              disabled={copilotState === 'loading'}
              onClick={() => void runCopilot()}
              type="button"
            >
              {copilotState === 'loading'
                ? <LoaderCircle aria-hidden="true" className="spin-icon" size={14} />
                : <Bot aria-hidden="true" size={14} />}
              Draft
            </button>
            {copilot && (
              <small>
                {copilot.draft.instrument === 'option'
                  ? optionStructures.find((item) => item.value === copilot.draft.optionStructure)?.label
                  : strategyOptions.find((item) => item.value === copilot.draft.strategyType)?.label}
              </small>
            )}
          </div>
        </section>

        <section className="strategy-controls-panel">
          <div className="strategy-controls-grid">
            <label>
              <span>Symbol</span>
              <input
                aria-label="Strategy symbol"
                maxLength={12}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))
                }
                type="text"
                value={config.symbol}
              />
            </label>
            <label>
              <span>Frame</span>
              <select
                aria-label="Backtest timeframe"
                onChange={(event) => setConfig((current) => ({ ...current, timeframe: event.target.value as Timeframe }))}
                value={config.timeframe}
              >
                {timeframeOptions.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>{timeframe}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Signal</span>
              <select
                aria-label="Strategy signal"
                onChange={(event) => setConfig((current) => ({ ...current, strategyType: event.target.value as StrategyType }))}
                value={config.strategyType}
              >
                {strategyOptions.map((strategy) => (
                  <option key={strategy.value} value={strategy.value}>{strategy.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Capital</span>
              <input
                aria-label="Starting capital"
                min="1000"
                onChange={(event) => updateNumber(setConfig, 'startingCapital', event.target.value)}
                step="1000"
                type="number"
                value={config.startingCapital}
              />
            </label>
            <label>
              <span>Risk</span>
              <input
                aria-label="Risk per trade"
                min="0.1"
                onChange={(event) => updateNumber(setConfig, 'riskPerTradePercent', event.target.value)}
                step="0.1"
                type="number"
                value={config.riskPerTradePercent}
              />
            </label>
            <label>
              <span>Max pos</span>
              <input
                aria-label="Maximum position percent"
                min="1"
                onChange={(event) => updateNumber(setConfig, 'maxPositionPercent', event.target.value)}
                step="1"
                type="number"
                value={config.maxPositionPercent}
              />
            </label>
            <label>
              <span>Stop</span>
              <input
                aria-label="Stop loss percent"
                min="0.5"
                onChange={(event) => updateNumber(setConfig, 'stopLossPercent', event.target.value)}
                step="0.5"
                type="number"
                value={config.stopLossPercent}
              />
            </label>
            <label>
              <span>Drawdown</span>
              <input
                aria-label="Maximum drawdown percent"
                min="1"
                onChange={(event) => updateNumber(setConfig, 'maxDrawdownPercent', event.target.value)}
                step="1"
                type="number"
                value={config.maxDrawdownPercent}
              />
            </label>
          </div>

          <div className="strategy-segmented" aria-label="Instrument type">
            {(['equity', 'option'] as StrategyInstrument[]).map((instrument) => (
              <button
                aria-pressed={config.instrument === instrument}
                className={config.instrument === instrument ? 'is-active' : undefined}
                key={instrument}
                onClick={() => setConfig((current) => ({ ...current, instrument }))}
                type="button"
              >
                {instrument === 'equity' ? 'Equity' : 'Options'}
              </button>
            ))}
          </div>

          <label className="strategy-kill-reason">
            <span>Kill reason</span>
            <input
              aria-label="Kill switch reason"
              maxLength={180}
              onChange={(event) => setKillReason(event.target.value)}
              placeholder="Risk event"
              type="text"
              value={killReason}
            />
          </label>
        </section>
      </div>

      <div className="strategy-options-grid">
        {optionStructures.map((structure) => {
          const isCoveredCall = structure.value === 'covered_call'
          const isCashSecuredPut = structure.value === 'cash_secured_put'
          const checkLabel = isCoveredCall
            ? `${coveredCalls} covered`
            : isCashSecuredPut
              ? `${cashSecuredContracts} secured`
              : structure.tone
          const isReady = !isCoveredCall || coveredCalls > 0
          return (
            <button
              aria-pressed={config.optionStructure === structure.value}
              className={config.optionStructure === structure.value ? 'strategy-option-card is-active' : 'strategy-option-card'}
              key={structure.value}
              onClick={() => setConfig((current) => ({
                ...current,
                instrument: 'option',
                optionStructure: structure.value,
              }))}
              type="button"
            >
              <span>
                <strong>{structure.label}</strong>
                <small className={isReady ? undefined : 'tone-negative'}>{checkLabel}</small>
              </span>
              <Shield aria-hidden="true" size={14} />
            </button>
          )
        })}
      </div>

      <div className="strategy-actions-row">
        <button
          disabled={backtestState === 'loading'}
          onClick={() => void runBacktest()}
          type="button"
        >
          {backtestState === 'loading'
            ? <LoaderCircle aria-hidden="true" className="spin-icon" size={14} />
            : <Play aria-hidden="true" size={14} />}
          Backtest
        </button>
        <button
          disabled={!backtest || deployState === 'loading'}
          onClick={() => void deployPaper()}
          type="button"
        >
          {deployState === 'loading'
            ? <LoaderCircle aria-hidden="true" className="spin-icon" size={14} />
            : <Save aria-hidden="true" size={14} />}
          Deploy paper
        </button>
      </div>

      {backtest && (
        <section className="strategy-results" aria-label="Backtest results">
          <div className="strategy-metrics-grid">
            <div>
              <span>Return</span>
              <strong className={resultTone ? `tone-${resultTone}` : undefined}>
                {formatSignedPercent(backtest.metrics.totalReturnPercent)}
              </strong>
            </div>
            <div>
              <span>Ending</span>
              <strong>{formatPrice(backtest.metrics.endingCapital)}</strong>
            </div>
            <div>
              <span>Drawdown</span>
              <strong className={backtest.metrics.maxDrawdownPercent > config.maxDrawdownPercent ? 'tone-negative' : undefined}>
                {formatPercent(backtest.metrics.maxDrawdownPercent)}
              </strong>
            </div>
            <div>
              <span>Win rate</span>
              <strong>{formatPercent(backtest.metrics.winRatePercent)}</strong>
            </div>
            <div>
              <span>Trades</span>
              <strong>{backtest.metrics.tradeCount}</strong>
            </div>
            <div>
              <span>Avg trade</span>
              <strong className={toneFromValue(backtest.metrics.averageTrade) ? `tone-${toneFromValue(backtest.metrics.averageTrade)}` : undefined}>
                {formatSignedCurrency(backtest.metrics.averageTrade)}
              </strong>
            </div>
          </div>

          <div className="strategy-chart-row">
            <div className="strategy-equity-chart">
              <div className="strategy-section-heading">
                <span>Equity curve</span>
                <strong>{backtest.data.source}</strong>
              </div>
              {equityPath && (
                <>
                  <svg aria-hidden="true" viewBox={`0 0 ${equityPath.width} ${equityPath.height}`}>
                    <path d={equityPath.path} />
                  </svg>
                  <div className="strategy-chart-labels">
                    <span>{formatPrice(equityPath.min)}</span>
                    <span>{formatPrice(equityPath.max)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="strategy-trades">
              <div className="strategy-section-heading">
                <span>Recent trades</span>
                <strong>{backtest.trades.length}</strong>
              </div>
              {backtest.trades.slice(-5).reverse().map((trade) => (
                <div className="strategy-trade-row" key={trade.id}>
                  <span>
                    <strong>{formatDateTime(trade.exitTime)}</strong>
                    <small>{trade.reason.replaceAll('_', ' ')}</small>
                  </span>
                  <span>
                    <strong className={toneFromValue(trade.profit) ? `tone-${toneFromValue(trade.profit)}` : undefined}>
                      {formatSignedCurrency(trade.profit)}
                    </strong>
                    <small>{trade.contracts ? `${trade.contracts} contracts` : `${trade.quantity} shares`}</small>
                  </span>
                </div>
              ))}
              {backtest.trades.length === 0 && (
                <div className="strategy-empty-row">No completed trades.</div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="strategy-monitor" aria-label="Strategy monitor">
        <div className="strategy-monitor-column">
          <div className="strategy-section-heading">
            <span>Deployments</span>
            <strong>{latestDeployments.length}</strong>
          </div>
          {latestDeployments.map((deployment) => (
            <div className="strategy-deployment-row" key={deployment.id}>
              <Activity aria-hidden="true" size={14} />
              <span>
                <strong>{deployment.config.symbol} / {deployment.config.instrument}</strong>
                <small>{deployment.status} / {formatDateTime(deployment.nextReviewAt)}</small>
              </span>
              <em>{deployment.riskState.status}</em>
            </div>
          ))}
          {latestDeployments.length === 0 && (
            <div className="strategy-empty-row">No paper deployments.</div>
          )}
        </div>

        <div className="strategy-monitor-column">
          <div className="strategy-section-heading">
            <span>Audit log</span>
            <strong>{latestAudit.length}</strong>
          </div>
          {latestAudit.map((entry) => (
            <div className="strategy-audit-row" key={entry.id ?? `${entry.createdAt}-${entry.message}`}>
              <small>{formatDateTime(entry.createdAt)}</small>
              <span>{entry.message}</span>
            </div>
          ))}
          {latestAudit.length === 0 && (
            <div className="strategy-empty-row">No audit events.</div>
          )}
        </div>
      </section>
    </div>
  )
}
