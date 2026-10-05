import { getSnapshot, getBars, getMarketClock, getTrending } from './alpacaClient.mjs'
import { getPortfolio, getWatchlist, getUserFromSession } from './userStore.mjs'

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = (process.env.AI_MODEL ?? 'qwen3:14b').split('/').pop() || 'qwen3:14b'
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const SESSION_COOKIE = 'mm_session'
const useGroq = !!GROQ_API_KEY

function parseCookies(h) {
  if (!h) return {}
  return Object.fromEntries(h.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=')
    return i === -1 ? [s, ''] : [decodeURIComponent(s.slice(0, i)), decodeURIComponent(s.slice(i + 1))]
  }))
}

function sendJson(res, s, p) { res.writeHead(s, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(p)) }
function fmt(n) { return Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPct(n) { return (Number(n ?? 0) > 0 ? '+' : '') + Number(n ?? 0).toFixed(2) + '%' }

function sendSseEvent(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
}

async function withToolEvent(res, tool, label, fn) {
  const start = Date.now()
  sendSseEvent(res, 'tool', { tool, label, status: 'running' })
  try {
    const result = await fn()
    sendSseEvent(res, 'tool', { tool, label, status: 'complete', duration: Date.now() - start })
    return result
  } catch {
    sendSseEvent(res, 'tool', { tool, label, status: 'error', duration: Date.now() - start })
    return ''
  }
}

function computeRSI(bars, period = 14) {
  if (bars.length < period + 1) return null
  const closes = bars.map((b) => b.close).slice(-period - 1)
  let gains = 0, losses = 0
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  const avgGain = gains / period, avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

async function getUser(req) {
  try {
    const cookies = parseCookies(req.headers.cookie)
    return await getUserFromSession(cookies[SESSION_COOKIE])
  } catch { return null }
}

async function buildMarketContext(userId) {
  const parts = []
  try {
    const clock = await getMarketClock()
    parts.push('[Market: ' + (clock.isOpen ? 'OPEN' : 'CLOSED') + ' | nextOpen=' + (clock.nextOpen ? new Date(clock.nextOpen).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?') + ']')
  } catch {}

  if (userId) {
    try {
      const result = await getPortfolio(userId)
      const h = result?.portfolio ?? []
      if (h.length) {
        let tv = 0, tc = 0
        const holdingPrices = []
        for (const p of h) {
          let price = null, changePct = null
          try { const snap = await getSnapshot(p.symbol); if (snap?.snapshot?.price) { price = snap.snapshot.price; changePct = snap.snapshot.changePercent } } catch {}
          const avg = p.averageCost ?? 0; const sh = p.shares ?? 0; const cp = price ?? avg
          tv += sh * cp; tc += sh * avg
          if (price !== null) holdingPrices.push(p.symbol + ': $' + fmt(price) + (changePct !== null ? ' (' + fmtPct(changePct) + ')' : ''))
        }
        const tg = tv - tc
        parts.push('[Portfolio: $' + fmt(tv) + ' | gain=$' + fmt(tg) + ' (' + fmtPct(tc > 0 ? (tg / tc) * 100 : 0) + ') | ' + h.length + ' holdings]')
        if (holdingPrices.length) parts.push('[Holdings: ' + holdingPrices.join(', ') + ']')
      }
    } catch {}
  }
  return parts.length ? '\n' + parts.join('\n') + '\n' : ''
}

async function buildPortfolioContext(userId) {
  const result = await getPortfolio(userId)
  const holdings = result?.portfolio ?? []
  if (!holdings.length) return ''
  const enriched = []; let totalValue = 0, totalCost = 0
  for (const h of holdings) {
    let price = null
    try { const snap = await getSnapshot(h.symbol); if (snap?.snapshot?.price) price = snap.snapshot.price } catch {}
    const avg = h.averageCost ?? 0; const shares = h.shares ?? 0; const curPrice = price ?? avg
    const mv = shares * curPrice; const cb = shares * avg
    totalValue += mv; totalCost += cb
    enriched.push({ ...h, price: curPrice, marketValue: mv, costBasis: cb, gain: mv - cb })
  }
  const totalGain = totalValue - totalCost; const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0
  const lines = ['[PORTFOLIO DETAIL]', 'Total: $' + fmt(totalValue) + ' | Cost: $' + fmt(totalCost) + ' | Gain: $' + fmt(totalGain) + ' (' + fmtPct(totalGainPct) + ')', 'Holdings:']
  for (const p of enriched) {
    const alloc = totalValue > 0 ? ((p.marketValue / totalValue) * 100).toFixed(1) : 0
    const gp = p.costBasis > 0 ? ((p.gain / p.costBasis) * 100).toFixed(2) : 0
    const tgt = p.targetWeight > 0 ? 'target=' + p.targetWeight + '%' : 'no target'
    const drift = p.targetWeight > 0 ? ' drift=' + (Number(alloc) - p.targetWeight).toFixed(1) + '%' : ''
    lines.push('  ' + p.symbol + ': ' + p.shares + ' sh @ $' + fmt(p.averageCost) + ' | $' + fmt(p.price) + ' | val=$' + fmt(p.marketValue) + ' | gain=$' + fmt(p.gain) + ' (' + fmtPct(gp) + ') | alloc=' + alloc + '% | ' + tgt + drift + (p.notes ? ' note="' + p.notes + '"' : ''))

    if (p.targetWeight > 0 && Math.abs(Number(alloc) - p.targetWeight) > 5) lines.push('    >> ALERT: ' + p.symbol + ' drifted ' + (Number(alloc) - p.targetWeight).toFixed(1) + '% from ' + p.targetWeight + '% target')
  }
  return '\n' + lines.join('\n') + '\n'
}

async function buildWatchlistContext(userId) {
  try {
    const wl = await getWatchlist(userId)
    if (!wl?.length) return ''
    const symbols = wl.map((item) => item.symbol).join(', ')
    return '\n[Watchlist: ' + symbols + ']\n'
  } catch { return '' }
}

async function buildTrendingContext() {
  try {
    const data = await getTrending('day')
    if (!data?.items?.length) return ''
    const top5 = data.items.slice(0, 5).map((i) => i.symbol + ' ' + fmtPct(i.changePercent)).join(', ')
    return '\n[Top movers today: ' + top5 + ']\n'
  } catch { return '' }
}

async function buildSymbolContext(symbol) {
  let snapshotData = null
  try {
    const result = await getSnapshot(symbol)
    if (result?.snapshot) snapshotData = { symbol, ...result.snapshot }
  } catch {}
  let rsi = null, bars = null
  try {
    const b = await getBars(symbol, '1D')
    if (b?.bars?.length) { bars = b.bars; rsi = computeRSI(bars) }
  } catch {}

  const parts = []
  if (snapshotData) parts.push('[Market data for ' + symbol + ': $' + fmt(snapshotData.price) + ' | change=$' + fmt(snapshotData.change) + ' (' + fmtPct(snapshotData.changePercent ?? 0) + ') | vol=' + (snapshotData.volume ?? 0).toLocaleString() + ']')
  if (rsi !== null) parts.push('[RSI(14) for ' + symbol + ': ' + rsi.toFixed(1) + (rsi > 70 ? ' (overbought)' : rsi < 30 ? ' (oversold)' : '') + ']')
  if (bars?.length >= 20) {
    const recent = bars.slice(-20)
    const low20 = Math.min(...recent.map((x) => x.low))
    const high20 = Math.max(...recent.map((x) => x.high))
    const sma20 = recent.reduce((s, x) => s + x.close, 0) / recent.length
    parts.push('[TA for ' + symbol + ': support20=$' + fmt(low20) + ' resistance20=$' + fmt(high20) + ' sma20=$' + fmt(sma20.toFixed(2)) + ']')
  }
  if (bars?.length >= 2) {
    const prevClose = bars[bars.length - 2].close
    const change = (snapshotData?.price ?? bars[bars.length - 1].close) - prevClose
    const chgPct = prevClose > 0 ? (change / prevClose) * 100 : 0
    if (!snapshotData) parts.push('[Prev close: $' + fmt(prevClose) + ' | change: $' + fmt(change) + ' (' + fmtPct(chgPct) + ')]')
  }
  return parts.length ? '\n' + parts.join('\n') + '\n' : ''
}

async function buildTechnicalsContext(userId) {
  let symbols = []
  if (userId) {
    try {
      const result = await getPortfolio(userId)
      if (result?.portfolio?.length) symbols = result.portfolio.map((p) => p.symbol)
    } catch {}
  }
  if (!symbols.length) return ''

  const lines = ['[TECHNICAL LEVELS]']
  for (const sym of symbols) {
    try {
      const b = await getBars(sym, '1D')
      if (!b?.bars?.length || b.bars.length < 20) continue
      const bars = b.bars.slice(-20)
      const low20 = Math.min(...bars.map((x) => x.low))
      const high20 = Math.max(...bars.map((x) => x.high))
      const close = bars[bars.length - 1].close
      const sma20 = bars.reduce((s, x) => s + x.close, 0) / bars.length
      const rsi = computeRSI(b.bars)
      lines.push(sym + ': $' + fmt(close) + ' | support20=$' + fmt(low20) + ' resistance20=$' + fmt(high20) + ' sma20=$' + fmt(sma20.toFixed(2)) + (rsi !== null ? ' rsi(14)=' + rsi.toFixed(1) : '') + ' | 20d range: $' + fmt(low20) + '-' + fmt(high20))
    } catch {}
  }
  if (lines.length === 1) return ''
  return '\n' + lines.join('\n') + '\n'
}

const systemPrompt = `You are Meridian, a knowledgeable trading and market advisor with deep expertise in technical analysis, market structure, and portfolio management. You help retail traders understand markets, stocks, ETFs, options, and economic trends.

Your responses must be:
- Direct and data-driven — lead with specific numbers when available
- Formatted with Markdown (**bold** for key figures)
- 3-8 sentences unless asked for deeper analysis
- Friendly, educational, and calibrated for retail traders

How to use injected data:
- [Market: OPEN/CLOSED] — Market status is always injected.
- [Portfolio: total, gain, holdings] — Injected for logged-in users when relevant.
- [Holdings: SYM: $price (+x%) ...] — Real current prices and day change for each holding.
- [PORTFOLIO DETAIL] — Full breakdown with per-holding allocation, gain, target drift.
- [TECHNICAL LEVELS] — Computed 20-day support, resistance, SMA20, RSI(14) for portfolio holdings.
- [Watchlist: ...] — Injected when relevant.
- [Top movers today: ...] — Injected when market context is relevant.
- [Market data for SYM: $price, change, volume] — Current quote for mentioned symbols.
- [RSI(14) for SYM: value] — Computed from daily bars.
- [TA for SYM: support20, resistance20, sma20] — Technical levels for an individually queried symbol.

You CAN and SHOULD answer general stock market questions using your broad knowledge:
- "How did the S&P 500 do today?" → Answer about the index using your general market knowledge
- "What sectors are leading?" → Share what you know about sector performance
- "Explain what the Fed rate decision means" → Use your economic knowledge
- "What's moving in crypto?" → Share general market knowledge
- "How does a recession affect the market?" → Educate from your training
- "Tell me about options trading basics" → Explain concepts clearly
- "What are the most owned stocks?" → Name well-known widely-held stocks
- Always answer general market questions directly. Do NOT pivot to portfolio unless the user specifically asks about their holdings.

CRITICAL RULES:
- When injected data IS available (like [Market data for AAPL]), prefer it over general knowledge for specific numbers
- When injected data is NOT available for a question, use your general knowledge freely — you were trained on market data
- If you don't know a specific number, say so rather than making it up
- Do NOT fabricate technical levels (support/resistance/RSI) — only quote those from injected [TA] blocks

IMPORTANT — Distinguish between the user speaking about themselves vs a stock ticker:
- When the user says "me", "my", "I", "myself" — they are referring to themselves, NOT a stock symbol.
- Common words that look like tickers but are NOT: A, AN, MY, BE, AT, IN, ON, BY, TO, IS, IT, OR, AS, OF, WE, HE, NO, GO, UP, US, ALL, THE, AND, FOR, ARE, HAS, NOT, BUT, CAN, YOU, YOUR, NOW, HOW, WHO, WHY, WAS, HAD, DID, GET, OUT, NEW, OLD, BIG, TOP, SET, RUN, CUT, PUT, BUY, SELL, DAY, WEEK, MONTH, YEAR, SAY, SEE, USE, WAY, SP, S, P, SPX
- If a word is lowercase in the user's message, it is NOT a ticker symbol. Ticker symbols are always ALL CAPS (e.g., "AAPL", "NVDA", "QQQ").

Portfolio advice patterns (only when user asks about their portfolio):
- "Your largest position (QQQ at 78%) is driving returns but creates concentration risk. Consider trimming to 50-60%."
- "ARM is down 11% today — check if the setup is still intact or if it's time to trail stops."
- "Your target drift on NVDA is +8%. You're 8% overallocated vs your target."
- "No targets set yet — I recommend adding target allocations to unlock drift monitoring."

Never give unrealistic promises. Always end with a risk caveat when relevant.`

async function streamGroq(messages, res) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + GROQ_API_KEY },
    body: JSON.stringify({ model: GROQ_MODEL, messages, stream: true, temperature: 0.4, max_tokens: 4096 }),
  })
  if (!r.ok) throw new Error('Groq error (' + r.status + '): ' + (await r.text().catch(() => '')))
  const reader = r.body.getReader(); const decoder = new TextDecoder(); let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t || !t.startsWith('data: ')) continue
      const p = t.slice(6)
      if (p === '[DONE]') return
      try { const c = JSON.parse(p).choices?.[0]?.delta?.content; if (c) res.write('data: ' + JSON.stringify({ content: c }) + '\n\n') } catch {}
    }
  }
}

async function streamOllama(messages, res) {
  const r = await fetch(OLLAMA_BASE + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: true, options: { temperature: 0.4, num_predict: 4096 } }),
  })
  if (!r.ok) throw new Error('Ollama error (' + r.status + '): ' + (await r.text().catch(() => '')))
  const reader = r.body.getReader(); const decoder = new TextDecoder(); let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { const c = JSON.parse(line).message?.content; if (c) res.write('data: ' + JSON.stringify({ content: c }) + '\n\n') } catch {}
    }
  }
}

export function createAiApiMiddleware() {
  return async function aiApiMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/ai')) { next?.(); return false }
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/api/ai/chat' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const { message, history } = JSON.parse(body)
      if (!message) { sendJson(res, 400, { error: 'No message provided' }); return true }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })

      try {
        const user = await getUser(req)
        const userId = user?.id

        const commonWords = new Set(['I', 'A', 'AN', 'MY', 'BE', 'AT', 'IN', 'ON', 'BY', 'TO', 'IS', 'IT', 'OR', 'AS', 'OF', 'WE', 'HE', 'NO', 'GO', 'UP', 'US', 'ALL', 'THE', 'AND', 'FOR', 'ARE', 'HAS', 'NOT', 'BUT', 'CAN', 'YOU', 'YOUR', 'NOW', 'HOW', 'WHO', 'WHY', 'WAS', 'HAD', 'DID', 'GET', 'OUT', 'NEW', 'OLD', 'BIG', 'TOP', 'SET', 'RUN', 'CUT', 'PUT', 'BUY', 'SELL', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'SAY', 'SEE', 'USE', 'WAY', 'SP', 'SPX', 'S', 'P', 'NYSE', 'NASDAQ', 'DOW', 'ETF', 'USD', 'GDP', 'CPI', 'PE', 'EPS', 'ATH', 'YTD', 'ROI', 'IRA', 'SMA', 'EMA', 'RSI', 'MACD', 'ATH', 'ALL', 'ANY', 'ARE', 'ASK', 'BID', 'BIG', 'CAP', 'DUE', 'EOD', 'EPS', 'FED', 'FIFO', 'HIT', 'IPO', 'LOT', 'LOW', 'MID', 'NET', 'NON', 'NOT', 'NOW', 'OFF', 'OFT', 'ONE', 'OUT', 'PCT', 'PER', 'PST', 'REF', 'SMA', 'SUM', 'TAM', 'TBA', 'TCP', 'TOP', 'TWO', 'USE', 'VAL', 'VIA', 'VIP', 'WAR', 'WOW', 'YEP', 'ZIP'])

        const isIndexQuestion = /\b(S[&P]?\s*500|S\s*and\s*P\s*500|NASDAQ|DOW\s*Jones|Dow\s*Jones|DOW|RUSSELL)\b/i.test(message)

        let symbolCtx = ''
        if (!isIndexQuestion) {
          const symbolMatch = message.match(/\b[A-Z][A-Z0-9]{0,4}\b/g)
          if (symbolMatch) {
            for (const sym of symbolMatch) {
              if (commonWords.has(sym)) continue
              if (sym.length === 1 && sym !== 'Q') continue
              symbolCtx = await withToolEvent(res, 'snapshot', sym, () => buildSymbolContext(sym))
              if (symbolCtx) break
            }
          }
        }

        const marketCtx = await withToolEvent(res, 'market', 'Market data', () => buildMarketContext(userId))

        const mentionsPortfolio = /\b(portfolio|holdings?|my positions|my account|my portfolio|rebalance|diversif|balance|allocat)\b/i.test(message)
        const mentionsWatchlist = /\b(watchlist|my symbols|tracking)\b/i.test(message)
        const isGeneralMarketQuestion = /\b(market|sector|economy|index|fed|inflation|recession|rate|cpi|gdp|yield|bond|crypto|bitcoin|briefing|summary|outlook|forecast|perform|most owned|popular|widely held)\b/i.test(message) || /\b(what'?s moving|who'?s moving|top gainer|top loser|most active|unusual volume)\b/i.test(message)
        const mentionsTrending = /\b(trending|moving|gainers|movers?|hot|market|sector|briefing|summary|today)\b/i.test(message)
        const mentionsTechnicals = /\b(support|resistance|level|technicals?|indicators?|chart|trend|pattern|breakout|moving average|rsi|macd)\b/i.test(message)

        let extraCtx = ''
        if (mentionsPortfolio && userId) extraCtx += await withToolEvent(res, 'portfolio', 'Portfolio analysis', () => buildPortfolioContext(userId))
        if (mentionsWatchlist && userId) extraCtx += await withToolEvent(res, 'watchlist', 'Watchlist', () => buildWatchlistContext(userId))
        if (mentionsTrending || isGeneralMarketQuestion) extraCtx += await withToolEvent(res, 'trending', 'Market movers', () => buildTrendingContext())
        if (mentionsTechnicals && userId) extraCtx += await withToolEvent(res, 'technicals', 'Technical levels', () => buildTechnicalsContext(userId))

        const userMsg = message + marketCtx + symbolCtx + extraCtx
        const historyMsgs = Array.isArray(history) ? history.slice(-10).map((m) => ({ role: m.role, content: m.content })) : []
        const msgs = [{ role: 'system', content: systemPrompt }, ...historyMsgs, { role: 'user', content: userMsg }]
        if (useGroq) await streamGroq(msgs, res)
        else await streamOllama(msgs, res)
      } catch (err) {
        const tip = useGroq
          ? '\n\n> \u26a0\ufe0f Groq error (' + err.message + '). Check your `GROQ_API_KEY` or model.'
          : '\n\n> \u26a0\ufe0f Ollama unavailable (' + err.message + '). Run `ollama pull ' + OLLAMA_MODEL + '` or set `GROQ_API_KEY`.'
        res.write('data: ' + JSON.stringify({ content: tip }) + '\n\n')
      }

      res.write('data: [DONE]\n\n')
      res.end()
      return true
    }

    if (url.pathname === '/api/ai/status' && req.method === 'GET') {
      if (useGroq) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'authorization': 'Bearer ' + GROQ_API_KEY } })
          sendJson(res, 200, { available: r.ok, provider: 'groq', model: GROQ_MODEL })
        } catch { sendJson(res, 200, { available: false, provider: 'groq', model: GROQ_MODEL, error: 'Groq not reachable' }) }
      } else {
        try {
          const r = await fetch(OLLAMA_BASE + '/api/tags'); const d = await r.json()
          sendJson(res, 200, { available: (d.models ?? []).some((m) => m.name.includes(OLLAMA_MODEL)), provider: 'ollama', model: OLLAMA_MODEL })
        } catch { sendJson(res, 200, { available: false, provider: 'ollama', model: OLLAMA_MODEL, error: 'Ollama not reachable' }) }
      }
      return true
    }

    next?.(); return false
  }
}
