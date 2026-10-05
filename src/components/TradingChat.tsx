import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Send, User, WifiOff, Copy, RefreshCw, Trash2, Check } from 'lucide-react'
import DOMPurify from 'dompurify'

const STORAGE_KEY = 'kh_chat_messages'

interface ToolEvent {
  tool: string
  label: string
  status: 'running' | 'complete' | 'error'
  duration?: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderMarkdown(text: string): string {
  const html = escapeHtml(text)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\*\*(.+)\*\*/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li value="$1">$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/(<li value="\d+">.*<\/li>\n?)+/g, (m) => '<ol start="' + m.match(/value="(\d+)"/)?.[1] + '">' + m.replace(/ value="\d+"/g, '') + '</ol>')

  const parts = html.split(/\n\n+/)
  return DOMPurify.sanitize(parts.map((p) => {
    const t = p.trim()
    if (!t) return ''
    if (t.startsWith('<h') || t.startsWith('<blockquote') || t.startsWith('<ul') || t.startsWith('<ol') || t.startsWith('<li')) return t
    return '<p>' + t.replace(/\n/g, '<br>') + '</p>'
  }).join('\n'))
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveMessages(messages: Message[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100)))
  } catch { /* best-effort persistence */ }
}

function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    snapshot: 'Snapshot',
    market: 'Market data',
    portfolio: 'Portfolio',
    watchlist: 'Watchlist',
    trending: 'Trending',
  }
  return labels[tool] || tool
}

function getFollowups(lastAssistant: string, covered: Set<string>): string[] {
  const last = lastAssistant.toLowerCase()
  const s: string[] = []

  // Dig deeper: the last response mentioned a specific topic → offer a natural next question
  if (/\b(support level|resist|floor|ceiling|price level)\b/.test(last) && !covered.has('stops'))
    s.push('Where should I set stop losses for these levels?')

  if (/\b(rsi|oversold|overbought|indicator)\b/.test(last) && !covered.has('other_indicators'))
    s.push('What does the MACD say?')

  if (/\b(concentration|overweight|drift|allocat)\b/.test(last) && !covered.has('targets'))
    s.push('What target allocations should I set?')

  if (/\b(dca|dollar.cost|all.in|lump.sum|entry)\b/.test(last) && !covered.has('dca'))
    s.push('Should I DCA or go all-in?')

  if (/\b(stop.loss|hedge|protect|downside)\b/.test(last) && !covered.has('hedge'))
    s.push('What puts should I buy to hedge?')

  if (/\b(volatility|vix|beta|variance)\b/.test(last) && !covered.has('vol_strategy'))
    s.push('How should I size positions in this environment?')

  if (/\b(momentum|breakout|trend|moving.avg)\b/.test(last) && !covered.has('momentum'))
    s.push('Which sectors have the strongest momentum?')

  if (/\b(option|call|put|strike|premium|iv|implied)\b/i.test(last) && !covered.has('options'))
    s.push('What is the options market pricing?')

  // Pivot: the last response mentioned a ticker → offer ticker-specific actions
  const tickerHit = last.match(/\b(VTI|QQQ|NVDA|ARM|SPY|IWM|AAPL|AMZN|GOOGL|MSFT|TSLA)\b/i)
  if (tickerHit && !covered.has(tickerHit[0].toUpperCase() + '_chain'))
    s.push('Options chain for ' + tickerHit[0].toUpperCase())

  if (tickerHit && !covered.has(tickerHit[0].toUpperCase() + '_earnings'))
    s.push('When does ' + tickerHit[0].toUpperCase() + ' report earnings?')

  // Fallback: nothing matched, suggest genuinely new starter topics
  if (s.length === 0) {
    if (!covered.has('portfolio')) s.push('Analyze my portfolio')
    if (!covered.has('trending')) s.push("What's moving today?")
    if (!covered.has('rsi_aapl')) s.push('What is the RSI for AAPL?')
    if (s.length === 0) {
      s.push('Check my watchlist', 'Compare QQQ vs VTI')
    }
  }

  return s.slice(0, 3)
}

function extractTopics(content: string, covered: Set<string>) {
  const lower = content.toLowerCase()
  if (/\b(support level|resist|floor|ceiling|price level|stop loss|stops?)\b/.test(lower)) covered.add('stops')
  if (/\b(rsi|oversold|overbought|indicator|technical|macd|bollinger)\b/.test(lower)) covered.add('other_indicators')
  if (/\b(concentration|overweight|drift|allocat|target|rebalance|trim)\b/.test(lower)) covered.add('targets')
  if (/\b(dca|dollar.cost|all.in|lump.sum|entry)\b/.test(lower)) covered.add('dca')
  if (/\b(hedge|protect|downside|puts?|risk)\b/.test(lower)) covered.add('hedge')
  if (/\b(volatility|vix|beta|variance)\b/.test(lower)) covered.add('vol_strategy')
  if (/\b(momentum|breakout|trend|moving avg|sma)\b/.test(lower)) covered.add('momentum')
  if (/\b(option|call|put|strike|premium|iv|implied)\b/.test(lower)) covered.add('options')
  if (/\b(portfolio|holdings?|position)\b/.test(lower)) covered.add('portfolio')
  if (/\b(moving|trending|gainers|movers?|hot)\b/.test(lower)) covered.add('trending')
  const tickerHit = lower.match(/\b(VTI|QQQ|NVDA|ARM|SPY|IWM|AAPL|AMZN|GOOGL|MSFT|TSLA)\b/i)
  if (tickerHit) covered.add(tickerHit[0].toUpperCase() + '_chain')
  if (tickerHit) covered.add(tickerHit[0].toUpperCase() + '_earnings')
  if (lower.includes('aapl') && lower.includes('rsi')) covered.add('rsi_aapl')
}

export function TradingChat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [aiOnline, setAiOnline] = useState(true)
  const [tools, setTools] = useState<ToolEvent[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastUserMsg = useRef('')
  const coveredTopics = useRef<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/ai/status')
      .then((r) => r.json())
      .then((d) => setAiOnline(d.available))
      .catch(() => setAiOnline(false))
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, tools])

  useEffect(() => { saveMessages(messages) }, [messages])

  const appendContent = useCallback((content: string) => {
    setMessages((prev) => {
      const next = [...prev]
      if (next.length && next[next.length - 1].role === 'assistant') {
        next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + content }
      }
      return next
    })
  }, [])

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || isStreaming) return
    setInput('')
    lastUserMsg.current = msg
    setMessages((prev) => [...prev, { role: 'user', content: msg }])
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    setIsStreaming(true)
    setTools([])

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, history }),
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream')
      const decoder = new TextDecoder()
      let currentEvent = ''
      let assistantContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line === '') { currentEvent = ''; continue }
          if (line.startsWith('event: ')) { currentEvent = line.slice(7); continue }
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            if (payload === '[DONE]') break
            try {
              const data = JSON.parse(payload)
              if (currentEvent === 'tool') {
                setTools((prev) => {
                  if (data.status === 'running') return [...prev, data]
                  return prev.map((t) => t.tool === data.tool && t.label === data.label ? { ...t, ...data } : t)
                })
              } else if (data.content) {
                assistantContent += data.content
                appendContent(data.content)
              }
            } catch { /* best-effort persistence */ }
          }
        }
      }
      extractTopics(assistantContent, coveredTopics.current)
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: 'Error: ' + (err instanceof Error ? err.message : 'Request failed') + '. Make sure the AI backend is running.' }
        return next
      })
    }
    setIsStreaming(false)
  }, [input, isStreaming, messages, appendContent])

  const regenerate = useCallback(() => {
    if (lastUserMsg.current) sendMessage(lastUserMsg.current)
  }, [sendMessage])

  const clearChat = useCallback(() => {
    setMessages([])
    setTools([])
    coveredTopics.current = new Set()
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const copyMessage = useCallback(async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch { /* best-effort persistence */ }
  }, [])

  const followups = !isStreaming && messages.length > 0 ? getFollowups(messages.filter(m => m.role === 'assistant').pop()?.content ?? '', coveredTopics.current) : []

  const hasRealMessages = messages.length > 0

  return (
    <div className="trading-chat">
      <div className="chat-header">
        <span className="chat-header-title">AI Advisor</span>
        <div className="chat-header-actions">
          {hasRealMessages && (
            <button className="chat-header-btn" onClick={clearChat} title="Clear conversation" type="button">
              <Trash2 size={13} />
            </button>
          )}
          {!aiOnline && (
            <span className="chat-status-dot" title="AI offline">
              <WifiOff size={11} />
            </span>
          )}
        </div>
      </div>
      <div className="chat-messages">
        {!aiOnline && (
          <div className="chat-status-bar">
            <WifiOff aria-hidden="true" size={12} />
            AI offline
          </div>
        )}
        {!hasRealMessages && !isStreaming && (
          <div className="chat-empty">
            <Bot size={24} />
            <p>Ask about a stock or portfolio.</p>
            <p className="chat-hints">
              <button className="chat-hint-btn" type="button" onClick={() => { setInput('What is the RSI for AAPL?'); inputRef.current?.focus() }}>RSI for AAPL</button>
              <button className="chat-hint-btn" type="button" onClick={() => { setInput('Analyze my portfolio'); inputRef.current?.focus() }}>Analyze my portfolio</button>
            </p>
          </div>
        )}
        {tools.length > 0 && (
          <div className="chat-tool-feed">
            {tools.map((t, i) => (
              <div key={i} className={'chat-tool-item chat-tool-' + t.status}>
                <span className="chat-tool-label">{toolLabel(t.label || t.tool)}</span>
                <span className="chat-tool-status">
                  {t.status === 'running' ? '…' : t.status === 'complete' ? '\u2713' : '\u2717'}
                </span>
                {t.duration !== undefined && (
                  <span className="chat-tool-duration">{t.duration}ms</span>
                )}
              </div>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={'chat-msg chat-msg-' + msg.role}>
            <div className="chat-avatar">{msg.role === 'user' ? <User size={13} /> : <Bot size={13} />}</div>
            <div className="chat-bubble" dangerouslySetInnerHTML={msg.role === 'assistant' ? { __html: msg.content ? renderMarkdown(msg.content) : (i === messages.length - 1 && isStreaming ? '<span class="chat-cursor">_</span>' : '') } : undefined}>
              {msg.role === 'user' ? msg.content : null}
            </div>
            {msg.role === 'assistant' && msg.content && !isStreaming && (
              <button
                className="chat-msg-action chat-copy-btn"
                onClick={() => copyMessage(msg.content, i)}
                title="Copy"
                type="button"
              >
                {copiedIndex === i ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>
        ))}
        {followups.length > 0 && (
          <div className="chat-followups">
            {followups.map((q, i) => (
              <button key={i} className="chat-followup-btn" onClick={() => sendMessage(q)} type="button">
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {hasRealMessages && !isStreaming && (
        <div className="chat-regenerate-row">
          <button className="chat-regenerate-btn" onClick={regenerate} type="button">
            <RefreshCw size={12} />
            Regenerate
          </button>
        </div>
      )}
      <div className="chat-input-row">
        <input
          className="chat-input"
          disabled={isStreaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="Ask about a stock..."
          ref={inputRef}
          type="text"
          value={input}
        />
        <button className="chat-send-btn" disabled={isStreaming || !input.trim()} onClick={() => sendMessage()} type="button">
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
