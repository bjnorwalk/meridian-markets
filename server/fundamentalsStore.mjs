import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS fundamentals (
  symbol TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  sector TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  marketCap REAL,
  avgVolume REAL,
  peRatio REAL,
  forwardPe REAL,
  epsGrowth REAL,
  revenueGrowth REAL,
  divYield REAL,
  beta REAL,
  shortFloatPct REAL,
  institutionPct REAL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fundamentals_sector ON fundamentals(sector);
CREATE INDEX IF NOT EXISTS idx_fundamentals_industry ON fundamentals(industry);
CREATE INDEX IF NOT EXISTS idx_fundamentals_marketCap ON fundamentals(marketCap);
CREATE INDEX IF NOT EXISTS idx_fundamentals_peRatio ON fundamentals(peRatio);
CREATE INDEX IF NOT EXISTS idx_fundamentals_avgVolume ON fundamentals(avgVolume);
`

function ensureSchema() {
  const db = getDb()
  const stmts = SCHEMA_SQL.split(';').filter(s => s.trim())
  for (const stmt of stmts) {
    try { db.exec(stmt.trim() + ';') } catch {}
  }
}

let moduleInitialized = false
function init() {
  if (moduleInitialized) return
  ensureSchema()
  moduleInitialized = true
}

function getSectorList() {
  return [
    'Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical',
    'Consumer Defensive', 'Energy', 'Basic Materials', 'Industrials',
    'Utilities', 'Real Estate', 'Communication Services',
  ]
}

function getIndustryList() {
  return [
    'Software - Infrastructure', 'Software - Application', 'Semiconductors',
    'Semiconductor Equipment & Materials', 'Consumer Electronics',
    'Electronic Components', 'Computer Hardware', 'Information Technology Services',
    'Communication Equipment', 'Scientific & Technical Instruments',
    'Solar', 'Waste Management', 'Pollution & Treatment Controls',
    'Drug Manufacturers - General', 'Drug Manufacturers - Specialty & Generic',
    'Biotechnology', 'Medical Devices', 'Medical Instruments & Supplies',
    'Diagnostics & Research', 'Healthcare Plans', 'Healthcare Information Services',
    'Medical Care Facilities', 'Health Information Services', 'Pharmaceutical Retailers',
    'Banks - Diversified', 'Banks - Regional', 'Capital Markets',
    'Asset Management', 'Insurance - Diversified', 'Insurance - Property & Casualty',
    'Insurance - Life', 'Insurance - Reinsurance', 'Insurance Brokers',
    'Financial Conglomerates', 'Credit Services', 'Mortgage Finance',
    'Shell Companies', 'Financial Data & Stock Exchanges',
    'Auto Manufacturers', 'Auto Parts', 'Autos', 'Recreational Vehicles',
    'Travel Services', 'Lodging', 'Restaurants', 'Gambling', 'Resorts & Casinos',
    'Leisure', 'Entertainment', 'Electronic Gaming & Multimedia',
    'Internet Content & Information', 'Internet Retail', 'Advertising Agencies',
    'Beverages - Non-Alcoholic', 'Beverages - Alcoholic', 'Breweries', 'Wineries & Distilleries',
    'Confectioners', 'Farm Products', 'Household & Personal Products',
    'Packaged Foods', 'Food Distribution', 'Discount Stores', 'Department Stores',
    'Specialty Retail', 'Home Improvement Retail', 'Luxury Goods', 'Footwear & Accessories',
    'Apparel Manufacturing', 'Apparel Retail',
    'Oil & Gas E&P', 'Oil & Gas Integrated', 'Oil & Gas Midstream',
    'Oil & Gas Refining & Marketing', 'Oil & Gas Equipment & Services',
    'Coal', 'Uranium', 'Thermal Coal', 'Coking Coal',
    'Chemicals', 'Specialty Chemicals', 'Agricultural Inputs',
    'Steel', 'Copper', 'Aluminum', 'Other Industrial Metals & Mining',
    'Gold', 'Silver', 'Other Precious Metals & Mining',
    'Building Materials', 'Lumber & Wood Production', 'Paper & Paper Products',
    'Packaging & Containers',
    'Specialty Industrial Machinery', 'Specialty Business Services',
    'Farm & Heavy Construction Machinery', 'Industrial Distribution',
    'Conglomerates', 'Staffing & Employment Services', 'Security & Protection Services',
    'Consulting Services', 'Engineering & Construction', 'Infrastructure Operations',
    'Airports & Air Services', 'Railroads', 'Trucking', 'Marine Shipping',
    'Airlines', 'Integrated Freight & Logistics',
    'Utilities - Regulated Electric', 'Utilities - Regulated Gas',
    'Utilities - Regulated Water', 'Utilities - Renewable', 'Utilities - Independent Power Producers',
    'REIT - Residential', 'REIT - Office', 'REIT - Retail', 'REIT - Healthcare Facilities',
    'REIT - Industrial', 'REIT - Hotel & Motel', 'REIT - Diversified',
    'REIT - Mortgage', 'REIT - Specialty',
    'Telecom Services', 'Wireless Communications',
    'Education & Training Services', 'Personal Services', 'Shell Companies',
  ]
}

async function fetchFundamentals(symbols) {
  if (!symbols || symbols.length === 0) return {}
  init()
  const YahooFinance = (await import('yahoo-finance2')).default
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  const results = {}
  const batchSize = 25
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize)
    const promises = batch.map(async (sym) => {
      try {
        const [quote, summary] = await Promise.all([
          yf.quote(sym),
          yf.quoteSummary(sym, { modules: ['assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] }).catch(() => null),
        ])
        if (!quote) return null

        const assetProfile = summary?.assetProfile || {}
        const summaryDetail = summary?.summaryDetail || {}
        const keyStats = summary?.defaultKeyStatistics || {}
        const finData = summary?.financialData || {}

        return {
          symbol: sym.toUpperCase(),
          name: quote.shortName ?? quote.longName ?? '',
          sector: assetProfile.sector ?? '',
          industry: assetProfile.industry ?? '',
          marketCap: quote.marketCap ?? null,
          avgVolume: quote.averageDailyVolume10Day ?? quote.averageDailyVolume3Month ?? quote.regularMarketVolume ?? null,
          peRatio: quote.trailingPE ?? quote.forwardPE ?? null,
          forwardPe: quote.forwardPE ?? null,
          epsGrowth: finData.earningsGrowth ?? null,
          revenueGrowth: finData.revenueGrowth ?? null,
          divYield: quote.dividendYield ?? null,
          beta: summaryDetail.beta ?? keyStats.beta ?? null,
          shortFloatPct: keyStats.shortPercentOfFloat ?? null,
          institutionPct: keyStats.heldPercentInstitutions ?? null,
        }
      } catch {
        return null
      }
    })
    const batchResults = await Promise.allSettled(promises)
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results[r.value.symbol] = r.value
      }
    }
  }
  return results
}

function upsertFundamentals(records) {
  const db = getDb()
  init()
  const now = new Date().toISOString()
  const insert = db.prepare(`INSERT OR REPLACE INTO fundamentals
    (symbol, name, sector, industry, marketCap, avgVolume, peRatio, forwardPe,
     epsGrowth, revenueGrowth, divYield, beta, shortFloatPct, institutionPct, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const r of records) {
    insert.run(
      r.symbol, r.name ?? '', r.sector ?? '', r.industry ?? '',
      r.marketCap ?? null, r.avgVolume ?? null, r.peRatio ?? null, r.forwardPe ?? null,
      r.epsGrowth ?? null, r.revenueGrowth ?? null, r.divYield ?? null, r.beta ?? null,
      r.shortFloatPct ?? null, r.institutionPct ?? null, now,
    )
  }
}

function getFundamentals(symbols) {
  const db = getDb()
  init()
  if (!symbols || symbols.length === 0) return {}
  const placeholders = symbols.map(() => '?').join(',')
  const stmt = db.prepare(`SELECT * FROM fundamentals WHERE symbol IN (${placeholders})`)
  const rows = stmt.all(...symbols)
  const map = {}
  for (const row of rows) {
    map[row.symbol] = row
  }
  return map
}

function getAllFundamentals() {
  const db = getDb()
  init()
  return db.prepare('SELECT * FROM fundamentals').all()
}

function getSectors() {
  const db = getDb()
  init()
  return db.prepare('SELECT DISTINCT sector FROM fundamentals WHERE sector != \'\' ORDER BY sector').all().map(r => r.sector)
}

function getIndustries() {
  const db = getDb()
  init()
  return db.prepare('SELECT DISTINCT industry FROM fundamentals WHERE industry != \'\' ORDER BY industry').all().map(r => r.industry)
}

function searchFundamentals({ sectors, industries, marketCapMin, marketCapMax, peMin, peMax, avgVolumeMin, avgVolumeMax, divYieldMin, divYieldMax, betaMin, betaMax, shortFloatPctMin, shortFloatPctMax, institutionPctMin, institutionPctMax, nameQuery }) {
  const db = getDb()
  init()
  const clauses = []
  const params = []

  if (sectors && sectors.length > 0) {
    clauses.push(`sector IN (${sectors.map(() => '?').join(',')})`)
    params.push(...sectors)
  }
  if (industries && industries.length > 0) {
    clauses.push(`industry IN (${industries.map(() => '?').join(',')})`)
    params.push(...industries)
  }
  if (marketCapMin !== null && marketCapMin !== undefined) { clauses.push('marketCap >= ?'); params.push(marketCapMin) }
  if (marketCapMax !== null && marketCapMax !== undefined) { clauses.push('marketCap <= ?'); params.push(marketCapMax) }
  if (peMin !== null && peMin !== undefined) { clauses.push('peRatio >= ?'); params.push(peMin) }
  if (peMax !== null && peMax !== undefined) { clauses.push('peRatio <= ?'); params.push(peMax) }
  if (avgVolumeMin !== null && avgVolumeMin !== undefined) { clauses.push('avgVolume >= ?'); params.push(avgVolumeMin) }
  if (avgVolumeMax !== null && avgVolumeMax !== undefined) { clauses.push('avgVolume <= ?'); params.push(avgVolumeMax) }
  if (divYieldMin !== null && divYieldMin !== undefined) { clauses.push('divYield >= ?'); params.push(divYieldMin) }
  if (divYieldMax !== null && divYieldMax !== undefined) { clauses.push('divYield <= ?'); params.push(divYieldMax) }
  if (betaMin !== null && betaMin !== undefined) { clauses.push('beta >= ?'); params.push(betaMin) }
  if (betaMax !== null && betaMax !== undefined) { clauses.push('beta <= ?'); params.push(betaMax) }
  if (shortFloatPctMin !== null && shortFloatPctMin !== undefined) { clauses.push('shortFloatPct >= ?'); params.push(shortFloatPctMin) }
  if (shortFloatPctMax !== null && shortFloatPctMax !== undefined) { clauses.push('shortFloatPct <= ?'); params.push(shortFloatPctMax) }
  if (institutionPctMin !== null && institutionPctMin !== undefined) { clauses.push('institutionPct >= ?'); params.push(institutionPctMin) }
  if (institutionPctMax !== null && institutionPctMax !== undefined) { clauses.push('institutionPct <= ?'); params.push(institutionPctMax) }
  if (nameQuery && nameQuery.trim()) {
    clauses.push('(symbol LIKE ? OR name LIKE ?)')
    const q = `%${nameQuery.trim().toUpperCase()}%`
    params.push(q, q)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM fundamentals ${where} ORDER BY marketCap DESC`).all(...params)
}

export {
  init,
  fetchFundamentals,
  upsertFundamentals,
  getFundamentals,
  getAllFundamentals,
  getSectors,
  getIndustries,
  getSectorList,
  getIndustryList,
  searchFundamentals,
}
