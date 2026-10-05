import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'meridian-strategy-smoke-'))

process.env.ALPACA_API_KEY = ''
process.env.ALPACA_API_KEY_ID = ''
process.env.ALPACA_SECRET_KEY = ''
process.env.ALPACA_API_SECRET_KEY = ''
process.env.DATA_DIR = dataDir

const { createStrategyApiMiddleware } = await import('../server/strategyApi.mjs')

function makeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(payload = '') {
      this.body = String(payload)
    },
  }
}

async function callStrategy(url, { method = 'GET', body = null, headers = {} } = {}) {
  const middleware = createStrategyApiMiddleware()
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = {}
  req.destroy = () => {}

  const res = makeResponse()
  const pending = middleware(req, res, () => false)
  if (body === null) {
    req.emit('end')
  } else {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  }
  await pending

  return {
    status: res.status,
    headers: res.headers,
    json: res.body ? JSON.parse(res.body) : null,
  }
}

const health = await callStrategy('/api/strategy/health?symbol=MSFT')
assert.equal(health.status, 200)
assert.equal(health.headers['cache-control'], 'no-store')
assert.equal(health.json.options.symbol, 'MSFT')
assert.ok(Array.isArray(health.json.checks))
assert.equal(health.json.killSwitch.enabled, false)

const copilot = await callStrategy('/api/strategy/copilot', {
  method: 'POST',
  body: {
    symbol: 'MSFT',
    prompt: 'Build an options income strategy using cash secured puts after a pullback.',
  },
})
assert.equal(copilot.status, 200)
assert.equal(copilot.json.draft.symbol, 'MSFT')
assert.equal(copilot.json.draft.instrument, 'option')
assert.equal(copilot.json.draft.optionStructure, 'cash_secured_put')

const backtest = await callStrategy('/api/strategy/backtest', {
  method: 'POST',
  body: {
    symbol: 'MSFT',
    strategyType: 'trend_breakout',
    instrument: 'equity',
    startingCapital: 100000,
  },
})
assert.equal(backtest.status, 200)
assert.equal(backtest.json.config.symbol, 'MSFT')
assert.ok(backtest.json.equityCurve.length >= 40)
assert.equal(typeof backtest.json.metrics.totalReturnPercent, 'number')

const optionBacktest = await callStrategy('/api/strategy/backtest', {
  method: 'POST',
  body: {
    symbol: 'NVDA',
    strategyType: 'mean_reversion',
    instrument: 'option',
    optionStructure: 'bull_call_spread',
    maxPositionPercent: 25,
  },
})
assert.equal(optionBacktest.status, 200)
assert.equal(optionBacktest.json.config.instrument, 'option')
assert.ok(optionBacktest.json.equityCurve.length >= 40)

const deployment = await callStrategy('/api/strategy/deploy-paper', {
  method: 'POST',
  body: {
    config: backtest.json.config,
    metrics: backtest.json.metrics,
  },
})
assert.equal(deployment.status, 201)
assert.equal(deployment.json.deployment.status, 'running')
assert.equal(deployment.json.deployment.mode, 'paper')

const enabledKillSwitch = await callStrategy('/api/strategy/kill-switch', {
  method: 'POST',
  body: { enabled: true, reason: 'smoke test' },
})
assert.equal(enabledKillSwitch.status, 200)
assert.equal(enabledKillSwitch.json.killSwitch.enabled, true)

const blockedBacktest = await callStrategy('/api/strategy/backtest', {
  method: 'POST',
  body: {
    symbol: 'MSFT',
    strategyType: 'trend_breakout',
    instrument: 'equity',
  },
})
assert.equal(blockedBacktest.status, 200)
assert.equal(blockedBacktest.json.trades.length, 0)
assert.equal(blockedBacktest.json.audit[0].eventType, 'risk_block')

const disabledKillSwitch = await callStrategy('/api/strategy/kill-switch', {
  method: 'POST',
  body: { enabled: false },
})
assert.equal(disabledKillSwitch.status, 200)
assert.equal(disabledKillSwitch.json.killSwitch.enabled, false)

const monitor = await callStrategy('/api/strategy/monitor')
assert.equal(monitor.status, 200)
assert.ok(monitor.json.deployments.length >= 1)
assert.ok(monitor.json.audit.length >= 1)

const { closeStrategyDatabase } = await import('../server/strategyStore.mjs')
const { closeUserDatabase } = await import('../server/userStore.mjs')
closeStrategyDatabase()
closeUserDatabase()
rmSync(dataDir, { recursive: true, force: true })
console.log('strategy-smoke ok')
