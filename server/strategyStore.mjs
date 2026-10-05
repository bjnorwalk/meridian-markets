import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), 'data')
const DB_PATH = resolve(DATA_DIR, 'market.db')

let strategyDb = null

export function closeStrategyDatabase() {
  strategyDb?.close()
  strategyDb = null
}

function getDb() {
  if (!strategyDb) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    strategyDb = new DatabaseSync(DB_PATH)
    strategyDb.exec('PRAGMA journal_mode=WAL')
    strategyDb.exec('PRAGMA busy_timeout=5000')
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS strategy_deployments (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS strategy_audit (
      id TEXT PRIMARY KEY,
      deployment_id TEXT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_strategy_audit_created_at ON strategy_audit(created_at)`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_strategy_audit_deployment_id ON strategy_audit(deployment_id)`)
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS strategy_state (
      state_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('long','short')),
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      entry_date TEXT NOT NULL,
      current_price REAL,
      current_value REAL,
      unrealized_pl REAL DEFAULT 0,
      stop_loss REAL,
      take_profit REAL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','closed')),
      closed_at TEXT,
      closed_price REAL,
      realized_pl REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_positions_deployment ON paper_positions(deployment_id)`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_positions_user ON paper_positions(user_id)`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_positions_status ON paper_positions(status)`)
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS paper_trades (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      position_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy','sell','short','cover')),
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      value REAL NOT NULL,
      pl REAL DEFAULT 0,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_trades_deployment ON paper_trades(deployment_id)`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_trades_user ON paper_trades(user_id)`)
    strategyDb.exec(`CREATE TABLE IF NOT EXISTS paper_pl (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total_value REAL NOT NULL,
      cash REAL DEFAULT 0,
      open_value REAL DEFAULT 0,
      realized_pl REAL DEFAULT 0,
      unrealized_pl REAL DEFAULT 0,
      total_pl REAL DEFAULT 0,
      drawdown REAL DEFAULT 0,
      peak_value REAL DEFAULT 0,
      created_at TEXT NOT NULL
    )`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_pl_deployment_date ON paper_pl(deployment_id, date)`)
    strategyDb.exec(`CREATE INDEX IF NOT EXISTS idx_pl_user_date ON paper_pl(user_id, date)`)
  }
  return strategyDb
}

function nowIso() {
  return new Date().toISOString()
}

function id(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '')
  } catch {
    return fallback
  }
}

export function appendStrategyAudit({
  deploymentId = null,
  eventType,
  message,
  payload = {},
}) {
  const db = getDb()
  const createdAt = nowIso()
  const entry = {
    id: id('aud'),
    deploymentId,
    eventType: String(eventType ?? 'event'),
    message: String(message ?? 'Strategy event recorded.'),
    payload,
    createdAt,
  }

  db.prepare(`INSERT INTO strategy_audit (id, deployment_id, event_type, message, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    entry.id,
    entry.deploymentId,
    entry.eventType,
    entry.message,
    JSON.stringify(entry.payload),
    entry.createdAt,
  )

  return entry
}

export function listStrategyAudit(limit = 80) {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM strategy_audit
    ORDER BY created_at DESC
    LIMIT ?`).all(Math.min(200, Math.max(1, Number(limit) || 80)))

  return rows.map((row) => ({
    id: row.id,
    deploymentId: row.deployment_id,
    eventType: row.event_type,
    message: row.message,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  }))
}

export function savePaperDeployment(deployment) {
  const db = getDb()
  const createdAt = deployment.createdAt ?? nowIso()
  const updatedAt = nowIso()
  const payload = {
    ...deployment,
    id: deployment.id ?? id('dep'),
    createdAt,
    updatedAt,
  }

  db.prepare(`INSERT OR REPLACE INTO strategy_deployments (id, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(
    payload.id,
    JSON.stringify(payload),
    createdAt,
    updatedAt,
  )

  return payload
}

export function listPaperDeployments(limit = 30) {
  const db = getDb()
  const rows = db.prepare(`SELECT payload_json FROM strategy_deployments
    ORDER BY updated_at DESC
    LIMIT ?`).all(Math.min(100, Math.max(1, Number(limit) || 30)))

  return rows
    .map((row) => parseJson(row.payload_json, null))
    .filter(Boolean)
}

export function getKillSwitch() {
  const db = getDb()
  const row = db.prepare('SELECT payload_json FROM strategy_state WHERE state_key = ?').get('kill_switch')
  return parseJson(row?.payload_json, {
    enabled: false,
    reason: '',
    updatedAt: null,
  })
}

export function setKillSwitch(enabled, reason = '') {
  const db = getDb()
  const payload = {
    enabled: Boolean(enabled),
    reason: String(reason ?? '').trim().slice(0, 240),
    updatedAt: nowIso(),
  }
  db.prepare(`INSERT OR REPLACE INTO strategy_state (state_key, payload_json, updated_at)
    VALUES (?, ?, ?)`).run('kill_switch', JSON.stringify(payload), payload.updatedAt)
  appendStrategyAudit({
    eventType: payload.enabled ? 'kill_switch_enabled' : 'kill_switch_disabled',
    message: payload.enabled
      ? `Global paper-trading kill switch enabled${payload.reason ? `: ${payload.reason}` : '.'}`
      : 'Global paper-trading kill switch disabled.',
    payload,
  })
  return payload
}

export function getDeploymentPL(deploymentId) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM paper_pl WHERE deployment_id = ? ORDER BY date ASC').all(deploymentId)
  return rows.map((r) => ({
    id: r.id,
    deploymentId: r.deployment_id,
    date: r.date,
    totalValue: r.total_value,
    cash: r.cash,
    openValue: r.open_value,
    realizedPl: r.realized_pl,
    unrealizedPl: r.unrealized_pl,
    totalPl: r.total_pl,
    drawdown: r.drawdown,
    peakValue: r.peak_value,
    createdAt: r.created_at,
  }))
}

export function getDeploymentPositions(deploymentId) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM paper_positions WHERE deployment_id = ? ORDER BY created_at DESC').all(deploymentId)
  return rows.map((r) => ({
    id: r.id,
    deploymentId: r.deployment_id,
    userId: r.user_id,
    symbol: r.symbol,
    direction: r.direction,
    quantity: r.quantity,
    entryPrice: r.entry_price,
    entryDate: r.entry_date,
    currentPrice: r.current_price,
    currentValue: r.current_value,
    unrealizedPl: r.unrealized_pl,
    stopLoss: r.stop_loss,
    takeProfit: r.take_profit,
    status: r.status,
    closedAt: r.closed_at,
    closedPrice: r.closed_price,
    realizedPl: r.realized_pl,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export function getDeploymentTrades(deploymentId) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM paper_trades WHERE deployment_id = ? ORDER BY created_at DESC').all(deploymentId)
  return rows.map((r) => ({
    id: r.id,
    deploymentId: r.deployment_id,
    userId: r.user_id,
    positionId: r.position_id,
    symbol: r.symbol,
    side: r.side,
    quantity: r.quantity,
    price: r.price,
    value: r.value,
    pl: r.pl,
    reason: r.reason,
    createdAt: r.created_at,
  }))
}
