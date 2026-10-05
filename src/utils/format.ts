import type { Bar, PortfolioHolding, QuoteSnapshot } from '../types/market'

const portfolioCsvColumns = [
  'symbol',
  'name',
  'exchange',
  'sector',
  'assetClass',
  'shares',
  'averageCost',
  'targetWeight',
  'notes',
] as const

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

export const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

export function escapeCsvValue(value: string | number) {
  const text = String(value ?? '')
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let isQuoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"' && isQuoted && nextChar === '"') {
      cell += '"'
      index += 1
      continue
    }

    if (char === '"') {
      isQuoted = !isQuoted
      continue
    }

    if (char === ',' && !isQuoted) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !isQuoted) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function normalizeCsvHeader(header: string) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function getCsvValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeCsvHeader(alias)]
    if (value !== undefined) return value.trim()
  }
  return ''
}

export function parseCsvNumber(value: string) {
  const text = value.trim()
  if (!text) return Number.NaN

  const isNegative = /^\(.*\)$/.test(text) || text.startsWith('-')
  const normalized = text
    .replace(/[()]/g, '')
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/^\+/, '')

  const number = Number(normalized)
  if (!Number.isFinite(number)) return Number.NaN
  return isNegative ? -Math.abs(number) : number
}

export function buildPortfolioCsv(holdings: PortfolioHolding[]) {
  const rows = holdings.map((holding) =>
    portfolioCsvColumns.map((column) => escapeCsvValue(holding[column])),
  )
  return [
    portfolioCsvColumns.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n')
}

export function parsePortfolioCsv(text: string) {
  const rows = parseCsvRows(text)
  if (rows.length < 2) {
    throw new Error('CSV needs a header row and at least one holding.')
  }

  const headers = rows[0].map(normalizeCsvHeader)
  return rows.slice(1).map((values, index) => {
    const row = headers.reduce<Record<string, string>>((record, header, columnIndex) => {
      record[header] = values[columnIndex] ?? ''
      return record
    }, {})

    return {
      line: index + 2,
      symbol: getCsvValue(row, ['symbol', 'ticker']),
      name: getCsvValue(row, ['name', 'company']),
      exchange: getCsvValue(row, ['exchange']),
      sector: getCsvValue(row, ['sector']),
      assetClass: getCsvValue(row, ['assetClass', 'asset class', 'security type', 'type']),
      shares: getCsvValue(row, ['shares', 'quantity', 'qty', 'units']),
      averageCost: getCsvValue(row, [
        'averageCost',
        'average cost',
        'avg cost',
        'avg price',
        'average price',
        'cost',
        'cost basis per share',
      ]),
      targetWeight: getCsvValue(row, [
        'targetWeight',
        'target weight',
        'target',
        'target %',
        'target percent',
        'allocation',
        'allocation %',
      ]),
      notes: getCsvValue(row, ['notes', 'note', 'thesis']),
    }
  })
}

export function formatPrice(value: number) {
  if (value >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  return currencyFormatter.format(value)
}

export function formatChange(snapshot: QuoteSnapshot | null) {
  if (!snapshot) return '$0.00'
  const sign = snapshot.change > 0 ? '+' : ''
  return `${sign}${currencyFormatter.format(snapshot.change)}`
}

export function formatSignedCurrency(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${currencyFormatter.format(value)}`
}

export function formatSignedPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${percentFormatter.format(value)}%`
}

export function formatPlainPercent(value: number) {
  return `${percentFormatter.format(value)}%`
}

export function formatTimeAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes === 1) return '1m ago'
  return `${minutes}m ago`
}

export function toneFromValue(value: number): 'positive' | 'negative' | undefined {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return undefined
}

export function buildVisibleRangeQuote(
  snapshot: QuoteSnapshot | null,
  bars: Bar[],
): QuoteSnapshot | null {
  if (bars.length === 0) return snapshot

  const firstBar = bars[0]
  const lastBar = bars[bars.length - 1]
  const baseline = firstBar.open || firstBar.close
  const price = lastBar.close
  const change = price - baseline
  const volume = bars.reduce((total, bar) => total + bar.volume, 0)

  return {
    symbol: snapshot?.symbol ?? '',
    price,
    previousClose: baseline,
    change,
    changePercent: baseline === 0 ? 0 : (change / baseline) * 100,
    bid: snapshot?.bid ?? price,
    ask: snapshot?.ask ?? price,
    volume,
    updatedAt: lastBar.time * 1000,
    marketStatus: snapshot?.marketStatus ?? 'closed',
  }
}
