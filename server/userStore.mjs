import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { isMailerConfigured, sendPasswordResetEmail } from './mailer.mjs'

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), 'data')
const DB_PATH = resolve(DATA_DIR, 'market.db')

let _db = null

export function closeUserDatabase() {
  _db?.close()
  _db = null
}
function getDb() {
  if (!_db) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    _db = new DatabaseSync(DB_PATH)
    _db.exec('PRAGMA journal_mode=WAL')
    _db.exec('PRAGMA busy_timeout=5000')
    _db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      password_hash_json TEXT,
      watchlists_json TEXT DEFAULT '[]',
      active_watchlist_id TEXT,
      portfolio_json TEXT DEFAULT '[]',
      preferences_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      password_reset_json TEXT
    )`)
    try { _db.exec('ALTER TABLE users ADD COLUMN email TEXT DEFAULT \'\'') } catch {}
    _db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`)

    _db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      symbol TEXT DEFAULT '',
      severity TEXT DEFAULT 'info',
      metadata_json TEXT DEFAULT '{}',
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)`)

    _db.exec(`CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total_value REAL NOT NULL,
      cash REAL DEFAULT 0,
      holdings_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON portfolio_snapshots(user_id, date)`)

    _db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      auth TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`)

    migrateFromJson()
  }
  return _db
}

function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    displayName: row.display_name || row.username,
    passwordHash: row.password_hash_json ? JSON.parse(row.password_hash_json) : null,
    watchlists: JSON.parse(row.watchlists_json || '[]'),
    activeWatchlistId: row.active_watchlist_id || undefined,
    portfolio: JSON.parse(row.portfolio_json || '[]'),
    preferences: JSON.parse(row.preferences_json || '{}'),
    createdAt: row.created_at,
    passwordReset: row.password_reset_json ? JSON.parse(row.password_reset_json) : undefined,
  }
}

function userToRow(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    display_name: user.displayName || user.username,
    password_hash_json: user.passwordHash ? JSON.stringify(user.passwordHash) : null,
    watchlists_json: JSON.stringify(user.watchlists || []),
    active_watchlist_id: user.activeWatchlistId || null,
    portfolio_json: JSON.stringify(user.portfolio || []),
    preferences_json: JSON.stringify(user.preferences || '{}'),
    created_at: user.createdAt,
    password_reset_json: user.passwordReset ? JSON.stringify(user.passwordReset) : null,
  }
}

function migrateFromJson() {
  const jsonPath = resolve(process.cwd(), '.data/users.json')
  if (!existsSync(jsonPath)) return

  console.log('Migrating legacy JSON data to SQLite...')

  let contents
  try {
    contents = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch {
    return
  }
  const { users: legacyUsers = [], sessions: legacySessions = {} } = contents

  const db = _db
  for (const user of legacyUsers) {
    const row = userToRow({
      ...user,
      displayName: user.displayName || user.username,
      watchlists: user.watchlists || [],
      activeWatchlistId: user.activeWatchlistId,
      portfolio: user.portfolio || [],
      preferences: user.preferences || {},
      passwordReset: user.passwordReset,
    })
    try {
      db.prepare(`INSERT OR IGNORE INTO users (id, username, email, display_name, password_hash_json, watchlists_json, active_watchlist_id, portfolio_json, preferences_json, created_at, password_reset_json)
        VALUES (@id, @username, @email, @display_name, @password_hash_json, @watchlists_json, @active_watchlist_id, @portfolio_json, @preferences_json, @created_at, @password_reset_json)`).run(row)
    } catch { /* skip duplicates */ }
  }

  for (const [token, session] of Object.entries(legacySessions)) {
    try {
      db.prepare(`INSERT OR IGNORE INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
        token, session.userId, session.expiresAt, session.createdAt
      )
    } catch { /* skip duplicates */ }
  }

  try { unlinkSync(jsonPath) } catch {}
  try { rmdirSync(resolve(process.cwd(), '.data'), { recursive: true }) } catch {}
  console.log('Migration complete.')
}

const passwordIterations = 210000
const sessionTtlMs = 14 * 24 * 60 * 60 * 1000
const resetCodeTtlMs = 15 * 60 * 1000
const defaultAlertSettings = {
  driftPercent: 5,
  concentrationPercent: 35,
  dayMovePercent: 2,
}

const defaultWatchlist = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology', assetClass: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', sector: 'Technology', assetClass: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ', sector: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE Arca', sector: 'ETF', assetClass: 'etf' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', sector: 'ETF', assetClass: 'etf' },
  { symbol: 'BTC-USD', name: 'Bitcoin', exchange: 'Crypto', sector: 'Digital Assets', assetClass: 'crypto' },
]

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase()
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email || '' }
}

function userError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function validateUsername(username) {
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    throw userError(400, 'INVALID_USERNAME', 'Use 3-32 letters, numbers, dots, dashes, or underscores.')
  }
}

function validatePassword(password) {
  if (String(password ?? '').length < 8) {
    throw userError(400, 'INVALID_PASSWORD', 'Password must be at least 8 characters.')
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, passwordIterations, 32, 'sha256').toString('hex')
  return { salt, hash, iterations: passwordIterations, digest: 'sha256' }
}

function verifyPassword(password, passwordHash) {
  const hash = pbkdf2Sync(password, passwordHash.salt, passwordHash.iterations, 32, passwordHash.digest)
  const expected = Buffer.from(passwordHash.hash, 'hex')
  return expected.length === hash.length && timingSafeEqual(expected, hash)
}

function createResetCode() {
  return randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-')
}

function genericResetResponse(username) {
  return {
    username,
    resetCode: null,
    expiresAt: new Date(Date.now() + resetCodeTtlMs).toISOString(),
    emailed: isMailerConfigured(),
  }
}

function normalizeResetCode(resetCode) {
  return String(resetCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function hashResetCode(resetCode) {
  return createHash('sha256').update(normalizeResetCode(resetCode)).digest('hex')
}

function cleanSessions() {
  const db = getDb()
  const now = Date.now()
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
}

function normalizeWatchlistItem(item) {
  const symbol = String(item?.symbol ?? '').trim().toUpperCase()
  if (!symbol) throw userError(400, 'INVALID_SYMBOL', 'Missing symbol.')
  return {
    symbol,
    name: String(item?.name ?? symbol),
    exchange: String(item?.exchange ?? 'Market'),
    sector: String(item?.sector ?? 'US Equity'),
    assetClass: item?.assetClass === 'crypto' ? 'crypto' : item?.assetClass === 'etf' ? 'etf' : 'equity',
  }
}

function normalizeWatchlistName(name) {
  const normalizedName = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (normalizedName.length < 1 || normalizedName.length > 32) {
    throw userError(400, 'INVALID_WATCHLIST_NAME', 'Use 1-32 characters for the list name.')
  }
  return normalizedName
}

function cloneWatchlistItems(items, fallbackItems = defaultWatchlist) {
  return (Array.isArray(items) ? items : fallbackItems).map(normalizeWatchlistItem)
}

function createWatchlistRecord(name = 'Core', items = defaultWatchlist) {
  const now = new Date().toISOString()
  return {
    id: randomBytes(8).toString('hex'),
    name: normalizeWatchlistName(name),
    items: cloneWatchlistItems(items),
    createdAt: now,
    updatedAt: now,
  }
}

function ensureUserWatchlists(user) {
  const existingWatchlists = Array.isArray(user.watchlists) ? user.watchlists.filter(Boolean) : []
  if (existingWatchlists.length === 0) {
    const migratedItems = Array.isArray(user.watchlist) ? user.watchlist : defaultWatchlist
    const watchlist = createWatchlistRecord('Core', migratedItems)
    user.watchlists = [watchlist]
    user.activeWatchlistId = watchlist.id
    delete user.watchlist
    return user.watchlists
  }
  user.watchlists = existingWatchlists.map((watchlist, index) => {
    const now = new Date().toISOString()
    const id = String(watchlist.id ?? randomBytes(8).toString('hex'))
    return {
      id,
      name: normalizeWatchlistName(watchlist.name ?? (index === 0 ? 'Core' : `List ${index + 1}`)),
      items: cloneWatchlistItems(watchlist.items),
      createdAt: watchlist.createdAt ?? now,
      updatedAt: watchlist.updatedAt ?? now,
    }
  })
  if (!user.watchlists.some((w) => w.id === user.activeWatchlistId)) {
    user.activeWatchlistId = user.watchlists[0].id
  }
  delete user.watchlist
  return user.watchlists
}

function findUser(userId) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!row) throw userError(401, 'UNAUTHORIZED', 'Sign in first.')
  const user = rowToUser(row)
  ensureUserWatchlists(user)
  ensureUserPortfolio(user)
  ensureUserPreferences(user)
  return user
}

function saveUser(user) {
  const db = getDb()
  const row = userToRow(user)
  db.prepare(`INSERT OR REPLACE INTO users (id, username, email, display_name, password_hash_json, watchlists_json, active_watchlist_id, portfolio_json, preferences_json, created_at, password_reset_json)
    VALUES (@id, @username, @email, @display_name, @password_hash_json, @watchlists_json, @active_watchlist_id, @portfolio_json, @preferences_json, @created_at, @password_reset_json)`).run(row)
}

function activeWatchlist(user) {
  ensureUserWatchlists(user)
  return user.watchlists.find((w) => w.id === user.activeWatchlistId) ?? user.watchlists[0]
}

function findWatchlist(user, watchlistId) {
  ensureUserWatchlists(user)
  const watchlist = user.watchlists.find((entry) => entry.id === watchlistId)
  if (!watchlist) throw userError(404, 'WATCHLIST_NOT_FOUND', 'Watchlist not found.')
  return watchlist
}

function watchlistsPayload(user) {
  ensureUserWatchlists(user)
  return { watchlists: user.watchlists, activeWatchlistId: user.activeWatchlistId }
}

function normalizePositiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw userError(400, 'INVALID_PORTFOLIO_VALUE', `${label} must be greater than 0.`)
  return Number(number.toFixed(6))
}

function normalizeTargetWeight(value) {
  if (value === undefined || value === null || value === '') return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100) throw userError(400, 'INVALID_PORTFOLIO_VALUE', 'Target weight must be between 0 and 100.')
  return Number(number.toFixed(4))
}

function normalizeHoldingNotes(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 180)
}

function normalizePortfolioHolding(input) {
  const symbolRecord = normalizeWatchlistItem(input)
  return {
    ...symbolRecord,
    shares: normalizePositiveNumber(input?.shares, 'Shares'),
    averageCost: normalizePositiveNumber(input?.averageCost, 'Average cost'),
    targetWeight: normalizeTargetWeight(input?.targetWeight),
    notes: normalizeHoldingNotes(input?.notes),
  }
}

function ensureUserPortfolio(user) {
  user.portfolio = Array.isArray(user.portfolio)
    ? user.portfolio.filter(Boolean).map((holding) => {
        const now = new Date().toISOString()
        return { id: String(holding.id ?? randomBytes(8).toString('hex')), ...normalizePortfolioHolding(holding), createdAt: holding.createdAt ?? now, updatedAt: holding.updatedAt ?? now }
      })
    : []
  return user.portfolio
}

function portfolioPayload(user) {
  return { portfolio: ensureUserPortfolio(user) }
}

function normalizeAlertThreshold(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100) throw userError(400, 'INVALID_ALERT_SETTINGS', `${label} must be between 0 and 100.`)
  return Number(number.toFixed(2))
}

function normalizeAlertSettings(input = {}) {
  return {
    driftPercent: normalizeAlertThreshold(input.driftPercent, defaultAlertSettings.driftPercent, 'Drift alert'),
    concentrationPercent: normalizeAlertThreshold(input.concentrationPercent, defaultAlertSettings.concentrationPercent, 'Concentration alert'),
    dayMovePercent: normalizeAlertThreshold(input.dayMovePercent, defaultAlertSettings.dayMovePercent, 'Day move alert'),
    emailAlerts: input.emailAlerts === true,
    emailDrift: input.emailDrift === true,
    emailConcentration: input.emailConcentration === true,
    emailDayMove: input.emailDayMove === true,
  }
}

function ensureUserPreferences(user) {
  const existingPreferences = user.preferences && typeof user.preferences === 'object' ? user.preferences : {}
  user.preferences = { ...existingPreferences, alerts: normalizeAlertSettings(existingPreferences.alerts) }
  return user.preferences
}

function preferencesPayload(user) {
  return { preferences: ensureUserPreferences(user) }
}

export async function createUser(usernameInput, password, emailInput) {
  const username = normalizeUsername(usernameInput)
  validateUsername(username)
  validatePassword(password)
  const email = String(emailInput || '').trim().toLowerCase()

  cleanSessions()

  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) throw userError(409, 'USERNAME_TAKEN', 'That username is already taken.')

  const user = {
    id: crypto.randomUUID(),
    username,
    email,
    passwordHash: hashPassword(password),
    watchlists: [],
    portfolio: [],
    preferences: { alerts: defaultAlertSettings },
    createdAt: new Date().toISOString(),
  }
  ensureUserWatchlists(user)
  saveUser(user)
  return publicUser(user)
}

export async function authenticateUser(usernameInput, password) {
  const username = normalizeUsername(usernameInput)

  const envUser = process.env.ADMIN_USERNAME
  const envPass = process.env.ADMIN_PASSWORD
  if (envUser && envPass && username === normalizeUsername(envUser) && password === envPass) {
    const db = getDb()
    let row = db.prepare('SELECT * FROM users WHERE id = ?').get('env-admin')
    if (!row) {
      const user = {
        id: 'env-admin',
        username: normalizeUsername(envUser),
        passwordHash: null,
        watchlists: [{ id: 'default', name: 'Watchlist', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
        activeWatchlistId: 'default',
        portfolio: [],
        preferences: { alerts: { driftPercent: 5, concentrationPercent: 35, dayMovePercent: 2 } },
        createdAt: new Date().toISOString(),
      }
      saveUser(user)
      return publicUser(user)
    }
    const user = rowToUser(row)
    ensureUserWatchlists(user)
    ensureUserPortfolio(user)
    ensureUserPreferences(user)
    return publicUser(user)
  }

  cleanSessions()

  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row || !row.password_hash_json || !verifyPassword(password, JSON.parse(row.password_hash_json))) {
    throw userError(401, 'INVALID_LOGIN', 'Invalid username or password.')
  }

  return publicUser(rowToUser(row))
}

export async function createSession(userId) {
  cleanSessions()
  const db = getDb()
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token, userId, Date.now() + sessionTtlMs, Date.now()
  )
  return { token, maxAge: sessionTtlMs / 1000 }
}

export async function deleteSession(token) {
  if (!token) return
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export async function refreshSession(token) {
  if (!token) return null
  const db = getDb()
  cleanSessions()
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!session) return null
  const newExpiry = Date.now() + sessionTtlMs
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(newExpiry, token)
  return { token, maxAge: sessionTtlMs / 1000, expiresAt: newExpiry }
}

export async function getUserFromSession(token) {
  if (!token) return null

  const db = getDb()
  cleanSessions()
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!session) return null

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id)
  return row ? publicUser(rowToUser(row)) : null
}

export async function requestPasswordReset(usernameInput) {
  const username = normalizeUsername(usernameInput)
  validateUsername(username)

  cleanSessions()
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row) return genericResetResponse(username)

  const user = rowToUser(row)
  const resetCode = createResetCode()
  const expiresAt = Date.now() + resetCodeTtlMs
  user.passwordReset = { tokenHash: hashResetCode(resetCode), expiresAt, createdAt: Date.now() }
  saveUser(user)

  if (isMailerConfigured()) {
    if (user.email) {
      await sendPasswordResetEmail(user.email, resetCode).catch(() => {})
    }
    return { username: user.username, resetCode: null, expiresAt: new Date(expiresAt).toISOString(), emailed: true }
  }

  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
    return { username: user.username, resetCode: null, expiresAt: new Date(expiresAt).toISOString(), emailed: false }
  }

  return { username: user.username, resetCode, expiresAt: new Date(expiresAt).toISOString() }
}

export async function resetUserPassword(usernameInput, resetCodeInput, password) {
  const username = normalizeUsername(usernameInput)
  validateUsername(username)
  validatePassword(password)

  const normalizedResetCode = normalizeResetCode(resetCodeInput)
  if (!normalizedResetCode) throw userError(400, 'INVALID_RESET_CODE', 'Enter the reset code.')

  cleanSessions()
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row || !row.password_reset_json) throw userError(400, 'INVALID_RESET_CODE', 'Invalid or expired reset code.')

  const user = rowToUser(row)
  if (!user.passwordReset?.expiresAt || user.passwordReset.expiresAt <= Date.now()) {
    delete user.passwordReset
    saveUser(user)
    throw userError(400, 'INVALID_RESET_CODE', 'Invalid or expired reset code.')
  }

  const submitted = Buffer.from(hashResetCode(normalizedResetCode), 'hex')
  const expected = Buffer.from(user.passwordReset.tokenHash, 'hex')
  const isValidResetCode = submitted.length === expected.length && timingSafeEqual(submitted, expected)
  if (!isValidResetCode) throw userError(400, 'INVALID_RESET_CODE', 'Invalid or expired reset code.')

  user.passwordHash = hashPassword(password)
  delete user.passwordReset
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  saveUser(user)
  return publicUser(user)
}

export async function getWatchlist(userId) {
  const user = findUser(userId)
  return activeWatchlist(user).items
}

export async function getWatchlistSymbols(userId) {
  const user = findUser(userId)
  return activeWatchlist(user).items.map(item => item.symbol)
}

export async function getPortfolioSymbols(userId) {
  const user = findUser(userId)
  return (user.portfolio || []).map(h => h.symbol)
}

export async function getWatchlists(userId) {
  const user = findUser(userId)
  return watchlistsPayload(user)
}

export async function createNamedWatchlist(userId, name) {
  const user = findUser(userId)
  const watchlist = createWatchlistRecord(name, [])
  user.watchlists.push(watchlist)
  user.activeWatchlistId = watchlist.id
  saveUser(user)
  return watchlistsPayload(user)
}

export async function updateWatchlist(userId, watchlistId, values) {
  const user = findUser(userId)
  const watchlist = findWatchlist(user, watchlistId)
  if (Object.hasOwn(values ?? {}, 'name')) {
    watchlist.name = normalizeWatchlistName(values.name)
  }
  watchlist.updatedAt = new Date().toISOString()
  saveUser(user)
  return watchlistsPayload(user)
}

export async function deleteWatchlist(userId, watchlistId) {
  const user = findUser(userId)
  findWatchlist(user, watchlistId)
  if (user.watchlists.length <= 1) throw userError(400, 'LAST_WATCHLIST', 'Keep at least one watchlist.')
  user.watchlists = user.watchlists.filter((w) => w.id !== watchlistId)
  if (user.activeWatchlistId === watchlistId) {
    user.activeWatchlistId = user.watchlists[0].id
  }
  saveUser(user)
  return watchlistsPayload(user)
}

export async function setActiveWatchlist(userId, watchlistId) {
  const user = findUser(userId)
  findWatchlist(user, watchlistId)
  user.activeWatchlistId = watchlistId
  saveUser(user)
  return watchlistsPayload(user)
}

export async function addWatchlistItem(userId, watchlistId, item) {
  const user = findUser(userId)
  const watchlist = watchlistId ? findWatchlist(user, watchlistId) : activeWatchlist(user)
  const normalizedItem = normalizeWatchlistItem(item)
  const current = Array.isArray(watchlist.items) ? watchlist.items : []
  watchlist.items = [normalizedItem, ...current.filter((entry) => entry.symbol !== normalizedItem.symbol)]
  watchlist.updatedAt = new Date().toISOString()
  saveUser(user)
  return watchlistsPayload(user)
}

export async function addActiveWatchlistItem(userId, item) {
  const payload = await addWatchlistItem(userId, null, item)
  const watchlist = payload.watchlists.find((entry) => entry.id === payload.activeWatchlistId)
  return watchlist?.items ?? []
}

export async function removeWatchlistItem(userId, watchlistId, symbolInput) {
  const symbol = String(symbolInput ?? '').trim().toUpperCase()
  const user = findUser(userId)
  const watchlist = watchlistId ? findWatchlist(user, watchlistId) : activeWatchlist(user)
  watchlist.items = (Array.isArray(watchlist.items) ? watchlist.items : []).filter((entry) => entry.symbol !== symbol)
  watchlist.updatedAt = new Date().toISOString()
  saveUser(user)
  return watchlistsPayload(user)
}

export async function removeActiveWatchlistItem(userId, symbol) {
  const payload = await removeWatchlistItem(userId, null, symbol)
  const watchlist = payload.watchlists.find((entry) => entry.id === payload.activeWatchlistId)
  return watchlist?.items ?? []
}

export async function reorderWatchlistItems(userId, watchlistId, symbolOrder) {
  const user = findUser(userId)
  const watchlist = findWatchlist(user, watchlistId)
  const normalizedSymbols = Array.from(new Set((Array.isArray(symbolOrder) ? symbolOrder : []).map((s) => String(s).trim().toUpperCase()))).filter(Boolean)
  const currentItems = Array.isArray(watchlist.items) ? watchlist.items : []
  const itemsBySymbol = new Map(currentItems.map((item) => [item.symbol, item]))
  const orderedItems = normalizedSymbols.map((symbol) => itemsBySymbol.get(symbol)).filter(Boolean)
  const missingItems = currentItems.filter((item) => !normalizedSymbols.includes(item.symbol))
  watchlist.items = [...orderedItems, ...missingItems]
  watchlist.updatedAt = new Date().toISOString()
  saveUser(user)
  return watchlistsPayload(user)
}

export async function getPortfolio(userId) {
  const user = findUser(userId)
  return portfolioPayload(user)
}

export async function addPortfolioHolding(userId, holdingInput) {
  const user = findUser(userId)
  const normalizedHolding = normalizePortfolioHolding(holdingInput)
  const now = new Date().toISOString()
  const current = ensureUserPortfolio(user)
  const existing = current.find((holding) => holding.symbol === normalizedHolding.symbol)
  if (existing) {
    Object.assign(existing, normalizedHolding, { updatedAt: now })
  } else {
    current.push({ id: randomBytes(8).toString('hex'), ...normalizedHolding, createdAt: now, updatedAt: now })
  }
  user.portfolio = current
  saveUser(user)
  return portfolioPayload(user)
}

export async function updatePortfolioHolding(userId, holdingId, holdingInput) {
  const user = findUser(userId)
  const portfolio = ensureUserPortfolio(user)
  const holding = portfolio.find((entry) => entry.id === holdingId)
  if (!holding) throw userError(404, 'HOLDING_NOT_FOUND', 'Portfolio holding not found.')
  Object.assign(holding, normalizePortfolioHolding({ ...holding, ...holdingInput }), { id: holding.id, createdAt: holding.createdAt, updatedAt: new Date().toISOString() })
  saveUser(user)
  return portfolioPayload(user)
}

export async function removePortfolioHolding(userId, holdingId) {
  const user = findUser(userId)
  user.portfolio = ensureUserPortfolio(user).filter((holding) => holding.id !== holdingId)
  saveUser(user)
  return portfolioPayload(user)
}

export async function getPreferences(userId) {
  const user = findUser(userId)
  return preferencesPayload(user)
}

export async function updateAlertSettings(userId, values) {
  const user = findUser(userId)
  const preferences = ensureUserPreferences(user)
  preferences.alerts = normalizeAlertSettings({ ...preferences.alerts, ...values })
  saveUser(user)
  return preferencesPayload(user)
}

export async function updatePreferences(userId, preferencesBlob) {
  const user = findUser(userId)
  const current = ensureUserPreferences(user)
  if (preferencesBlob && typeof preferencesBlob === 'object') {
    for (const [key, value] of Object.entries(preferencesBlob)) {
      if (key === 'alerts') {
        current.alerts = normalizeAlertSettings({ ...current.alerts, ...value })
      } else {
        current[key] = value
      }
    }
  }
  user.preferences = current
  saveUser(user)
  return preferencesPayload(user)
}

export async function recordPortfolioSnapshot(userId, marketSnapshots = {}) {
  const db = getDb()
  const user = findUser(userId)
  if (!user) return null
  const holdings = user.portfolio || []
  let totalValue = 0
  let cashHolding = 0
  const holdingsData = []
  for (const h of holdings) {
    const sh = h.shares ?? 0
    const avg = h.averageCost ?? 0
    const snapshot = marketSnapshots[h.symbol]
    const price = snapshot?.price ?? snapshot?.close ?? avg
    const mv = sh * price
    totalValue += mv
    cashHolding += 0
    holdingsData.push({ symbol: h.symbol, shares: sh, avgCost: avg, marketValue: mv })
  }
  const today = new Date().toISOString().slice(0, 10)
  const existing = db.prepare('SELECT id FROM portfolio_snapshots WHERE user_id = ? AND date = ?').get(userId, today)
  if (existing) return { date: today, totalValue, snapshotId: existing.id }
  const id = randomBytes(8).toString('hex')
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO portfolio_snapshots (id, user_id, date, total_value, cash, holdings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, userId, today, totalValue, cashHolding, JSON.stringify(holdingsData), now,
  )
  return { date: today, totalValue, snapshotId: id }
}

export function getPortfolioPerformance(userId, options = {}) {
  const db = getDb()
  const days = options.days || 365
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const rows = db.prepare('SELECT * FROM portfolio_snapshots WHERE user_id = ? AND date >= ? ORDER BY date ASC').all(userId, since)

  const snapshots = rows.map((r) => ({
    date: r.date,
    totalValue: r.total_value,
    cash: r.cash,
    holdings: JSON.parse(r.holdings_json || '[]'),
  }))

  const user = findUser(userId)
  const currentHoldings = user?.portfolio || []
  const currentTotalValue = currentHoldings.reduce((t, h) => t + (h.shares ?? 0) * ((options.currentPrices?.[h.symbol]?.price ?? options.currentPrices?.[h.symbol]?.close ?? h.averageCost ?? 0)), 0)
  const currentTotalCost = currentHoldings.reduce((t, h) => t + (h.shares ?? 0) * (h.averageCost ?? 0), 0)

  if (!snapshots.length) {
    const currentTotalReturn = currentTotalCost > 0 ? ((currentTotalValue - currentTotalCost) / currentTotalCost) * 100 : 0
    return {
      snapshots: [],
      metrics: {
        totalReturn: Math.round(currentTotalReturn * 100) / 100,
        dayReturn: 0,
        weekReturn: 0,
        monthReturn: 0,
        ytdReturn: Math.round(currentTotalReturn * 100) / 100,
        maxDrawdown: 0,
        annualizedVolatility: 0,
        cagr: 0,
        sharpeRatio: 0,
        totalDays: 0,
        firstValue: currentTotalCost || currentTotalValue,
        lastValue: currentTotalValue,
      },
    }
  }

  const first = snapshots[0].totalValue
  const last = snapshots[snapshots.length - 1].totalValue
  const snapReturn = first > 0 ? ((last - first) / first) * 100 : 0
  const currentTotalReturn = currentTotalCost > 0 ? ((currentTotalValue - currentTotalCost) / currentTotalCost) * 100 : 0
  const totalReturn = snapshots.length > 1 ? snapReturn : currentTotalReturn

  const values = [...snapshots.map((s) => s.totalValue), currentTotalValue]
  const peak = Math.max(...values)
  const trough = Math.min(...values)
  const maxDrawdown = peak > 0 ? ((peak - trough) / peak) * 100 : 0

  const dailyReturns = []
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].totalValue
    if (prev > 0) dailyReturns.push((snapshots[i].totalValue - prev) / prev)
  }
  const mean = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length
  const dailyVolatility = Math.sqrt(variance)
  const annualizedVolatility = dailyVolatility * Math.sqrt(252)

  const totalDays = snapshots.length
  const years = Math.max(totalDays / 365, 1 / 365)
  const cagr = first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0

  const annualizedReturn = first > 0 ? (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100 : 0
  const riskFreeRate = 4.5
  const excessReturn = annualizedReturn - riskFreeRate
  const sharpeRatio = annualizedVolatility > 0 ? excessReturn / annualizedVolatility : 0

  const tradingDays = snapshots.length - 1
  const dayReturn = tradingDays > 0 && tradingDays <= 5 ? totalReturn : 0
  const weekReturn = tradingDays > 0 ? totalReturn * (5 / Math.max(tradingDays, 1)) : 0
  const monthReturn = tradingDays > 0 ? totalReturn * (21 / Math.max(tradingDays, 1)) : 0
  const ytdStart = new Date().getFullYear()
  const ytdSnapshots = snapshots.filter((s) => s.date >= `${ytdStart}-01-01`)
  const ytdReturn = ytdSnapshots.length > 1 ? ((ytdSnapshots[ytdSnapshots.length - 1].totalValue - ytdSnapshots[0].totalValue) / ytdSnapshots[0].totalValue) * 100 : currentTotalReturn

  return {
    snapshots,
    metrics: {
      totalReturn: Math.round(totalReturn * 100) / 100,
      dayReturn: Math.round(dayReturn * 100) / 100,
      weekReturn: Math.round(weekReturn * 100) / 100,
      monthReturn: Math.round(monthReturn * 100) / 100,
      ytdReturn: Math.round(ytdReturn * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      annualizedVolatility: Math.round(annualizedVolatility * 100) / 100,
      cagr: Math.round(cagr * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      totalDays: snapshots.length || 1,
      firstValue: first || currentTotalCost,
      lastValue: last || currentTotalValue,
    },
  }
}

export function createNotification(userId, type, title, body = '', options = {}) {
  const db = getDb()
  const id = randomBytes(8).toString('hex')
  const now = new Date().toISOString()
  const key = options.key || ''
  if (key) {
    const recent = db.prepare("SELECT id FROM notifications WHERE user_id = ? AND json_extract(metadata_json, '$.key') = ? AND read = 0").get(userId, key)
    if (recent) return null
  }
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body, symbol, severity, metadata_json, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
    id, userId, type, title, body,
    options.symbol || '',
    options.severity || 'info',
    JSON.stringify(options.metadata || {}),
    now,
  )
  return id
}

export function getNotifications(userId, limit = 50, offset = 0) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset)
  const unreadRow = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(userId)
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      body: r.body,
      symbol: r.symbol,
      severity: r.severity,
      metadata: JSON.parse(r.metadata_json || '{}'),
      read: !!r.read,
      createdAt: r.created_at,
    })),
    unreadCount: unreadRow?.count ?? 0,
  }
}

export function markNotificationRead(userId, notificationId) {
  const db = getDb()
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId)
}

export function markAllNotificationsRead(userId) {
  const db = getDb()
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId)
}

export function getUnreadNotificationCount(userId) {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(userId)
  return row?.count ?? 0
}

export function getAlertKeys(userId) {
  const db = getDb()
  const rows = db.prepare("SELECT json_extract(metadata_json, '$.key') as k FROM notifications WHERE user_id = ? AND read = 0").all(userId)
  return new Set(rows.map((r) => r.k).filter(Boolean))
}

export function getUserEmail(userId) {
  const db = getDb()
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId)
  return row?.email || null
}

export function getAllUserIds() {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM users').all()
  return rows.map((r) => r.id)
}

export function savePushSubscription(userId, subscription) {
  const db = getDb()
  const id = randomBytes(8).toString('hex')
  const now = new Date().toISOString()
  db.prepare(`INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, auth, p256dh, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, userId, subscription.endpoint, subscription.keys?.auth || '', subscription.keys?.p256dh || '', now,
  )
  return id
}

export function getPushSubscriptions(userId) {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    endpoint: r.endpoint,
    keys: { auth: r.auth, p256dh: r.p256dh },
    createdAt: r.created_at,
  }))
}

export function removePushSubscription(userId, endpoint) {
  const db = getDb()
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint)
}

export function getAllPushSubscriptions() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM push_subscriptions').all()
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    endpoint: r.endpoint,
    keys: { auth: r.auth, p256dh: r.p256dh },
  }))
}

export async function dispatchPushNotifications(userId, title, body, tag, url) {
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return

  const subs = getPushSubscriptions(userId)
  if (!subs.length) return

  let webPush
  try {
    webPush = (await import('web-push')).default
    webPush.setVapidDetails('mailto:alerts@meridianmarkets.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  } catch {
    return
  }

  const payload = JSON.stringify({ title, body, tag, url })
  for (const sub of subs) {
    try {
      await webPush.sendNotification(sub, payload)
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        removePushSubscription(userId, sub.endpoint)
      }
    }
  }
}
