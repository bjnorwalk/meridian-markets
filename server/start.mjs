import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { loadEnv } from './env.mjs'
import { createAuthApiMiddleware } from './authApi.mjs'
import { createMarketApiMiddleware } from './marketApi.mjs'
import { createStrategyApiMiddleware } from './strategyApi.mjs'
import { createAiApiMiddleware } from './aiApi.mjs'
import { createNotifyApiMiddleware } from './notifyApi.mjs'
import { createScreenerApiMiddleware } from './screenerApi.mjs'
import { init as initFundamentals, fetchFundamentals, upsertFundamentals, getAllFundamentals } from './fundamentalsStore.mjs'
import { securityHeaders } from './httpSecurity.mjs'
import { recordPortfolioSnapshot, getAllUserIds } from './userStore.mjs'
import { runPaperTickLoop } from './paperTrader.mjs'
import { runScreener } from './screener.mjs'
loadEnv()

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? '4173')
const distDir = resolve(process.cwd(), 'dist')
const authApi = createAuthApiMiddleware()

const PLAUSIBLE_DOMAIN = process.env.PLAUSIBLE_DOMAIN
const SENTRY_DSN = process.env.SENTRY_DSN || process.env.SENTRY_CLIENT_DSN

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

let indexHtml = ''
if (existsSync(join(distDir, 'index.html'))) {
  indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8')
  const tags = []
  if (PLAUSIBLE_DOMAIN) {
    tags.push(`<script defer src="https://plausible.io/js/script.js" data-domain="${escapeHtmlAttribute(PLAUSIBLE_DOMAIN)}"></script>`)
  }
  if (SENTRY_DSN) {
    tags.push(`<script src="https://browser.sentry-cdn.com/8.52.0/bundle.min.js" crossorigin="anonymous" integrity="sha384-1KMdYG/LNBNm9N9V5l4H8uy1DMOpJY1sY+aPjFfkXffYcF0Bm4S4L6gWHhpT2Ew"></script>`)
    tags.push(`<script>Sentry.init(${JSON.stringify({
      dsn: SENTRY_DSN,
      environment: process.env.RAILWAY_ENVIRONMENT || 'production',
    })})</script>`)
  }
  if (tags.length) {
    indexHtml = indexHtml.replace('</head>', tags.join('\n') + '\n</head>')
  }
}
const marketApi = createMarketApiMiddleware()
const strategyApi = createStrategyApiMiddleware()
const aiApi = createAiApiMiddleware()
const notifyApi = createNotifyApiMiddleware()
const screenerApiMiddleware = createScreenerApiMiddleware()

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

function sendStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const decodedPath = decodeURIComponent(url.pathname)
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(distDir, safePath)

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const htmlPath = join(distDir, decodedPath + '.html')
    if (existsSync(htmlPath) && !statSync(htmlPath).isDirectory()) {
      filePath = htmlPath
    } else if (indexHtml) {
      res.writeHead(200, {
        ...securityHeaders(req),
        'content-type': 'text/html; charset=utf-8',
      })
      res.end(indexHtml)
      return
    } else {
      filePath = join(distDir, 'index.html')
    }
  }

  const ext = extname(filePath)
  res.writeHead(200, {
    ...securityHeaders(req),
    'content-type': mimeTypes[ext] ?? 'application/octet-stream',
  })
  createReadStream(filePath).pipe(res)
}

const server = createServer(async (req, res) => {
  if (req.url === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, {
      ...securityHeaders(req),
      'content-type': 'application/json; charset=utf-8',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }))
    return
  }
  const handled =
    (await authApi(req, res, () => false)) ||
    (await marketApi(req, res, () => false)) ||
    (await strategyApi(req, res, () => false)) ||
    (await aiApi(req, res, () => false)) ||
    (await notifyApi(req, res, () => false)) ||
    (await screenerApiMiddleware(req, res, () => false))
  if (!handled) sendStatic(req, res)
})

server.listen(port, host, () => {
  console.log(`Meridian Markets running at http://${host}:${port}/`)
})

const SNAPSHOT_HOUR = 20
const SNAPSHOT_MINUTE = 0

async function runDailySnapshot() {
  const now = new Date()
  if (now.getUTCHours() !== SNAPSHOT_HOUR || now.getUTCMinutes() !== SNAPSHOT_MINUTE) return
  try {
    const userIds = getAllUserIds()
    for (const userId of userIds) {
      await recordPortfolioSnapshot(userId)
    }
    console.log(`[snapshot] Recorded ${userIds.length} portfolio snapshots`)
  } catch (err) {
    console.error('[snapshot] Error:', err.message)
  }
}

const snapshotTicker = () => {
  runDailySnapshot()
  const now = new Date()
  const msUntilNext = (60 - now.getSeconds()) * 1000
  setTimeout(() => {
    runDailySnapshot()
    setInterval(runDailySnapshot, 60000)
  }, msUntilNext)
}
snapshotTicker()

const PAPER_TICK_INTERVAL = 5 * 60 * 1000

async function runPaperTradingTick() {
  try {
    const result = await runPaperTickLoop()
    if (result.evaluated > 0) {
      const halted = result.results.filter((r) => r.halted)
      if (halted.length) {
        console.log(`[paperTrader] ${halted.length} deployment(s) halted on tick`)
      }
    }
  } catch (err) {
    console.error('[paperTrader] Tick error:', err.message)
  }
}

const paperTicker = () => {
  runPaperTradingTick()
  setInterval(runPaperTradingTick, PAPER_TICK_INTERVAL)
}

setTimeout(paperTicker, 10_000)

const FUNDAMENTALS_REFRESH_HOURS = 24
const FUNDAMENTALS_SYMBOLS_BATCH = 50

async function runFundamentalsRefresh() {
  try {
    initFundamentals()
    const existing = getAllFundamentals()
    const existingSymbols = new Set(existing.map(r => r.symbol))
    const { getBroadSymbols } = await import('./screener.mjs')
    const broadSymbols = await getBroadSymbols()
    const missing = broadSymbols.filter(s => !existingSymbols.has(s))
    if (missing.length === 0) return
    console.log(`[fundamentals] Fetching ${missing.length} missing symbols...`)
    for (let i = 0; i < missing.length; i += FUNDAMENTALS_SYMBOLS_BATCH) {
      const batch = missing.slice(i, i + FUNDAMENTALS_SYMBOLS_BATCH)
      const data = await fetchFundamentals(batch)
      const records = Object.values(data).filter(Boolean)
      if (records.length > 0) upsertFundamentals(records)
      console.log(`[fundamentals] ${Math.min(i + FUNDAMENTALS_SYMBOLS_BATCH, missing.length)} / ${missing.length}`)
      if (i + FUNDAMENTALS_SYMBOLS_BATCH < missing.length) await new Promise(r => setTimeout(r, 1000))
    }
    console.log('[fundamentals] Refresh complete')
  } catch (err) {
    console.error('[fundamentals] Error:', err.message)
  }
}

const SCREENER_INTERVAL = 30 * 60 * 1000

async function runScreenerTick() {
  try {
    await runScreener()
    console.log('[screener] Scan complete')
  } catch (err) {
    console.error('[screener] Error:', err.message)
  }
}

const screenerTicker = () => {
  runScreenerTick()
  setInterval(runScreenerTick, SCREENER_INTERVAL)
}

setTimeout(screenerTicker, 30_000)

const fundamentalsTicker = () => {
  runFundamentalsRefresh()
  setInterval(runFundamentalsRefresh, FUNDAMENTALS_REFRESH_HOURS * 60 * 60 * 1000)
}

setTimeout(fundamentalsTicker, 5_000)
