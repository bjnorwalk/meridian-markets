import { getBars, getSnapshot, getMarketClock } from './alpacaClient.mjs'
import { sendAlertEmail } from './mailer.mjs'
import { createNotification, getUserEmail } from './userStore.mjs'
import {
  appendStrategyAudit,
  getKillSwitch,
  listPaperDeployments,
  savePaperDeployment,
  setKillSwitch,
} from './strategyStore.mjs'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), 'data')
const DB_PATH = resolve(DATA_DIR, 'market.db')

let _db = null
function getDb() {
  if (!_db) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    _db = new DatabaseSync(DB_PATH)
    _db.exec('PRAGMA journal_mode=WAL')
    _db.exec('PRAGMA busy_timeout=5000')
  }
  return _db
}

function nowIso() { return new Date().toISOString() }
function id(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}` }
function round(v, d = 2) { if (!Number.isFinite(v)) return 0; const f = 10 ** d; return Math.round(v * f) / f }

function average(values) { if (!values.length) return 0; return values.reduce((a, b) => a + b, 0) / values.length }
function stdev(values) { if (values.length < 2) return 0; const m = average(values); return Math.sqrt(average(values.map((v) => (v - m) ** 2))) }
function highest(values) { return values.reduce((b, v) => Math.max(b, v), -Infinity) }
function lowest(values) { return values.reduce((b, v) => Math.min(b, v), Infinity) }

function shouldEnter(strategyType, bars, index) {
  if (index < 25) return false
  const close = bars[index].close
  const previous = bars.slice(Math.max(0, index - 20), index)
  const closes = previous.map((b) => b.close)

  if (strategyType === 'trend_breakout') {
    const prevHigh = highest(previous.slice(-10).map((b) => b.high))
    return close > prevHigh
  }
  if (strategyType === 'mean_reversion') {
    const m = average(closes)
    const band = stdev(closes) * 1.15
    return close < m - band
  }
  const fast = average(closes.slice(-6))
  const slow = average(closes)
  const priorFast = average(bars.slice(index - 7, index - 1).map((b) => b.close))
  const priorSlow = average(bars.slice(index - 21, index - 1).map((b) => b.close))
  return fast > slow && priorFast <= priorSlow
}

function shouldExit(strategyType, bars, index, position, stopLossPct) {
  const close = bars[index].close
  const stopPrice = position.entry_price * (1 - stopLossPct / 100)
  if (close <= stopPrice) return { exit: true, reason: 'stop_loss' }

  const previous = bars.slice(Math.max(0, index - 20), index)
  const closes = previous.map((b) => b.close)

  if (strategyType === 'trend_breakout') {
    const trail = lowest(previous.slice(-8).map((b) => b.low))
    return { exit: close < trail, reason: 'trend_failed' }
  }
  if (strategyType === 'mean_reversion') {
    const m = average(closes)
    return { exit: close >= m, reason: 'mean_reversion_complete' }
  }
  const fast = average(closes.slice(-6))
  const slow = average(closes)
  return { exit: fast < slow, reason: 'moving_average_cross_down' }
}

function loadOpenPositions(deploymentId) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM paper_positions WHERE deployment_id = ? AND status = ?').all(deploymentId, 'open')
  return rows
}

function savePosition(position) {
  const db = getDb()
  db.prepare(`INSERT OR REPLACE INTO paper_positions
    (id, deployment_id, user_id, symbol, direction, quantity, entry_price, entry_date, current_price, current_value, unrealized_pl, stop_loss, take_profit, status, closed_at, closed_price, realized_pl, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    position.id, position.deployment_id, position.user_id, position.symbol,
    position.direction, position.quantity, position.entry_price, position.entry_date,
    position.current_price, position.current_value, position.unrealized_pl,
    position.stop_loss, position.take_profit, position.status,
    position.closed_at, position.closed_price, position.realized_pl,
    position.created_at, position.updated_at,
  )
}

function closePosition(position, exitPrice, reason, realizedPl) {
  const now = nowIso()
  position.status = 'closed'
  position.closed_at = now
  position.closed_price = exitPrice
  position.realized_pl = round(realizedPl)
  position.current_price = exitPrice
  position.current_value = round(position.quantity * exitPrice)
  position.unrealized_pl = 0
  position.updated_at = now
  savePosition(position)
}

function recordTrade(deploymentId, userId, positionId, symbol, side, quantity, price, value, pl, reason) {
  const db = getDb()
  db.prepare(`INSERT INTO paper_trades
    (id, deployment_id, user_id, position_id, symbol, side, quantity, price, value, pl, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id('trd'), deploymentId, userId, positionId, symbol, side, quantity, price, value, round(pl), reason, nowIso(),
  )
}

function recordPlSnapshot(deploymentId, userId, totalValue, cash, openValue, realizedPl, unrealizedPl, peakValue) {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const drawdown = peakValue > 0 ? round(((peakValue - totalValue) / peakValue) * 100) : 0
  db.prepare(`INSERT INTO paper_pl
    (id, deployment_id, user_id, date, total_value, cash, open_value, realized_pl, unrealized_pl, total_pl, drawdown, peak_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id('ppl'), deploymentId, userId, today, round(totalValue), round(cash), round(openValue),
    round(realizedPl), round(unrealizedPl), round(realizedPl + unrealizedPl),
    drawdown, round(peakValue), nowIso(),
  )
}

function getDeploymentPeakValue(deploymentId) {
  const db = getDb()
  const row = db.prepare('SELECT MAX(peak_value) as peak FROM paper_pl WHERE deployment_id = ?').get(deploymentId)
  return row?.peak || 0
}

function getDeploymentTotalPl(deploymentId) {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(SUM(realized_pl), 0) as realized FROM paper_pl WHERE deployment_id = ?').get(deploymentId)
  return row?.realized || 0
}

async function evaluateDeployment(deployment) {
  const config = deployment.config
  const symbol = config.symbol
  const userId = deployment.userId || 'system'
  const deploymentId = deployment.id

  try {
    const barsResult = await getBars(symbol, '1D')
    const bars = barsResult?.bars || []
    if (bars.length < 30) return null

    const openPositions = loadOpenPositions(deploymentId)
    const latestBar = bars[bars.length - 1]
    const secondLatest = bars[bars.length - 2]
    const currentIndex = bars.length - 1
    const prevClose = secondLatest?.close || latestBar.close

    let totalUnrealizedPl = 0
    let totalRealizedPl = getDeploymentTotalPl(deploymentId)
    let openValue = 0
    let cash = config.startingCapital || 100000

    const killSwitch = getKillSwitch()
    if (killSwitch.enabled) {
      for (const pos of openPositions) {
        closePosition(pos, latestBar.close, 'kill_switch', (latestBar.close - pos.entry_price) * pos.quantity)
        recordTrade(deploymentId, userId, pos.id, symbol, pos.direction === 'long' ? 'sell' : 'cover', pos.quantity, latestBar.close, round(pos.quantity * latestBar.close), (latestBar.close - pos.entry_price) * pos.quantity, 'kill_switch')
      }
      return { halted: true, reason: 'Global kill switch active', deploymentId }
    }

    let recentPeak = getDeploymentPeakValue(deploymentId)

    for (const pos of openPositions) {
      const exitSignal = shouldExit(config.strategyType, bars, currentIndex, pos, config.stopLossPercent)
      if (exitSignal.exit) {
        const exitPrice = latestBar.close
        const realizedPl = pos.direction === 'long'
          ? (exitPrice - pos.entry_price) * pos.quantity
          : (pos.entry_price - exitPrice) * pos.quantity
        const side = pos.direction === 'long' ? 'sell' : 'cover'
        closePosition(pos, exitPrice, exitSignal.reason, realizedPl)
        recordTrade(deploymentId, userId, pos.id, symbol, side, pos.quantity, exitPrice, round(pos.quantity * exitPrice), realizedPl, exitSignal.reason)
        cash += pos.quantity * exitPrice
        totalRealizedPl += realizedPl

        appendStrategyAudit({
          deploymentId,
          eventType: 'position_closed',
          message: `${symbol} position closed at $${round(exitPrice)} (${exitSignal.reason}). P/L: $${round(realizedPl)}`,
          payload: { symbol, exitPrice, realizedPl, reason: exitSignal.reason },
        })
      } else {
        pos.current_price = latestBar.close
        pos.current_value = round(pos.quantity * latestBar.close)
        pos.unrealized_pl = round((latestBar.close - pos.entry_price) * pos.quantity)
        pos.updated_at = nowIso()
        savePosition(pos)
        totalUnrealizedPl += pos.unrealized_pl
        openValue += pos.current_value
      }
    }

    const totalValue = cash + openValue
    recentPeak = Math.max(recentPeak, totalValue)
    const drawdownFromPeak = recentPeak > 0 ? ((recentPeak - totalValue) / recentPeak) * 100 : 0

    if (drawdownFromPeak >= config.maxDrawdownPercent) {
      setKillSwitch(true, `${symbol} paper strategy breached ${config.maxDrawdownPercent}% max drawdown (${round(drawdownFromPeak)}%)`)
      appendStrategyAudit({
        deploymentId,
        eventType: 'kill_switch_triggered',
        message: `Auto kill-switch: ${symbol} drawdown of ${round(drawdownFromPeak)}% exceeded ${config.maxDrawdownPercent}% limit.`,
        payload: { symbol, drawdown: round(drawdownFromPeak), limit: config.maxDrawdownPercent },
      })
      return { halted: true, reason: `Drawdown ${round(drawdownFromPeak)}% exceeded limit`, deploymentId }
    }

    if (!killSwitch.enabled && shouldEnter(config.strategyType, bars, currentIndex)) {
      const positionBudget = totalValue * (config.maxPositionPercent / 100)
      const shares = Math.max(0, Math.floor(positionBudget / latestBar.close))
      if (shares > 0) {
        const pos = {
          id: id('ppos'),
          deployment_id: deploymentId,
          user_id: userId,
          symbol,
          direction: 'long',
          quantity: shares,
          entry_price: latestBar.close,
          entry_date: nowIso(),
          current_price: latestBar.close,
          current_value: round(shares * latestBar.close),
          unrealized_pl: 0,
          stop_loss: null,
          take_profit: null,
          status: 'open',
          closed_at: null,
          closed_price: null,
          realized_pl: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        }
        savePosition(pos)
        recordTrade(deploymentId, userId, pos.id, symbol, 'buy', shares, latestBar.close, round(shares * latestBar.close), 0, 'strategy_entry')
        appendStrategyAudit({
          deploymentId,
          eventType: 'position_opened',
          message: `${symbol} paper long opened ${shares} shares at $${round(latestBar.close)}`,
          payload: { symbol, shares, entryPrice: latestBar.close },
        })
      }
    }

    recordPlSnapshot(deploymentId, userId, totalValue, cash, openValue, totalRealizedPl, totalUnrealizedPl, recentPeak)

    return {
      symbol,
      totalValue: round(totalValue),
      cash: round(cash),
      openValue: round(openValue),
      realizedPl: round(totalRealizedPl),
      unrealizedPl: round(totalUnrealizedPl),
      totalPl: round(totalRealizedPl + totalUnrealizedPl),
      drawdown: round(drawdownFromPeak),
      positions: openPositions.length,
      deploymentId,
    }
  } catch (err) {
    console.error(`[paperTrader] Error evaluating ${symbol}:`, err.message)
    return null
  }
}

export async function runPaperTickLoop() {
  const deployments = listPaperDeployments().filter((d) => d.status === 'running' && d.config?.symbol)
  if (!deployments.length) return { evaluated: 0, results: [] }

  const results = []
  for (const deployment of deployments) {
    const result = await evaluateDeployment(deployment)
    if (result) results.push(result)
  }

  return { evaluated: deployments.length, results }
}

export async function runSingleDeploymentTick(deploymentId) {
  const deployments = listPaperDeployments().filter((d) => d.id === deploymentId)
  if (!deployments.length) return null
  return evaluateDeployment(deployments[0])
}
