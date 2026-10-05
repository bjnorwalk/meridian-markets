import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let didLoad = false

function stripQuotes(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalizeMarketDataBaseUrl(value) {
  return value.replace('data.sandbox.alpaca.markets', 'data.alpaca.markets')
}

export function loadEnv() {
  if (didLoad) return
  didLoad = true

  const envFile = resolve(process.cwd(), '.env')
  if (!existsSync(envFile)) return

  const contents = readFileSync(envFile, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = stripQuotes(trimmed.slice(separatorIndex + 1))
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

export function readAlpacaConfig() {
  loadEnv()

  const keyId =
    process.env.ALPACA_API_KEY ??
    process.env.ALPACA_API_KEY_ID ??
    process.env.ALPACA_CLIENT_ID ??
    ''
  const secretKey =
    process.env.ALPACA_SECRET_KEY ??
    process.env.ALPACA_API_SECRET_KEY ??
    process.env.ALPACA_CLIENT_SECRET ??
    ''
  const feed = process.env.ALPACA_DATA_FEED ?? 'iex'
  const optionsFeed = process.env.ALPACA_OPTIONS_FEED ?? 'indicative'
  const rawBaseUrl =
    process.env.ALPACA_MARKET_DATA_BASE_URL ??
    process.env.ALPACA_API_BASE_URL ??
    'https://data.alpaca.markets'
  const baseUrl = normalizeMarketDataBaseUrl(rawBaseUrl)
  const usesSandbox = rawBaseUrl.includes('sandbox')
  const tradingBaseUrl =
    process.env.ALPACA_TRADING_API_BASE_URL ??
    (usesSandbox
      ? 'https://paper-api.sandbox.alpaca.markets'
      : 'https://paper-api.alpaca.markets')
  const authBaseUrl =
    process.env.ALPACA_AUTHX_BASE_URL ??
    (usesSandbox
      ? 'https://authx.sandbox.alpaca.markets'
      : 'https://authx.alpaca.markets')
  const brokerBaseUrl =
    process.env.ALPACA_BROKER_API_BASE_URL ??
    (tradingBaseUrl.includes('broker-api') ? tradingBaseUrl : undefined) ??
    (usesSandbox
      ? 'https://broker-api.sandbox.alpaca.markets'
      : 'https://broker-api.alpaca.markets')
  const authMode = process.env.ALPACA_AUTH_MODE ?? 'auto'
  const endDelayMinutes = Number(process.env.ALPACA_END_DELAY_MINUTES ?? '16')

  return {
    configured: Boolean(keyId && secretKey),
    keyId,
    secretKey,
    feed,
    optionsFeed,
    baseUrl,
    tradingBaseUrl,
    authBaseUrl,
    brokerBaseUrl,
    authMode,
    endDelayMinutes: Number.isFinite(endDelayMinutes) ? endDelayMinutes : 16,
  }
}
