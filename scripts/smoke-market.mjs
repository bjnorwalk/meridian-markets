import assert from 'node:assert/strict'

process.env.ALPACA_API_KEY = ''
process.env.ALPACA_API_KEY_ID = ''
process.env.ALPACA_SECRET_KEY = ''
process.env.ALPACA_API_SECRET_KEY = ''

const { createMarketApiMiddleware } = await import('../server/marketApi.mjs')

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

async function callMarket(url, { method = 'GET', headers = {} } = {}) {
  const middleware = createMarketApiMiddleware()
  const req = {
    method,
    url,
    headers,
    socket: {},
  }
  const res = makeResponse()
  await middleware(req, res, () => false)
  return {
    status: res.status,
    headers: res.headers,
    json: res.body ? JSON.parse(res.body) : null,
  }
}

function symbols(count) {
  return Array.from({ length: count }, (_, index) => `T${index}`).join(',')
}

const status = await callMarket('/api/market/status')
assert.equal(status.status, 200)
assert.equal(status.headers['x-content-type-options'], 'nosniff')
assert.equal(status.headers['cache-control'], 'no-store')
assert.equal(typeof status.json.configured, 'boolean')

const blankSearch = await callMarket('/api/market/search?query=%20%20')
assert.equal(blankSearch.status, 200)
assert.deepEqual(blankSearch.json.symbols, [])

const blankSnapshot = await callMarket('/api/market/snapshot?symbol=%20%20')
assert.equal(blankSnapshot.status, 400)
assert.equal(blankSnapshot.json.error.code, 'SYMBOL_REQUIRED')

const tooManySnapshots = await callMarket(`/api/market/snapshots?symbols=${symbols(51)}`)
assert.equal(tooManySnapshots.status, 400)
assert.equal(tooManySnapshots.json.error.code, 'TOO_MANY_SYMBOLS')

const tooManySparklines = await callMarket(`/api/market/sparklines?symbols=${symbols(51)}`)
assert.equal(tooManySparklines.status, 400)
assert.equal(tooManySparklines.json.error.code, 'TOO_MANY_SYMBOLS')

const blankOptions = await callMarket('/api/options/chain?symbol=%20%20')
assert.equal(blankOptions.status, 400)
assert.equal(blankOptions.json.error.code, 'SYMBOL_REQUIRED')

const invalidOptionType = await callMarket('/api/options/chain?symbol=AAPL&type=straddle')
assert.equal(invalidOptionType.status, 400)
assert.equal(invalidOptionType.json.error.code, 'INVALID_OPTION_TYPE')

const optionsChain = await callMarket('/api/options/chain?symbol=AAPL&limit=6')
assert.equal(optionsChain.status, 200)
assert.equal(optionsChain.headers['cache-control'], 'no-store')
assert.equal(optionsChain.json.symbol, 'AAPL')
assert.equal(optionsChain.json.source, 'Demo fallback - live options unavailable')
assert.ok(optionsChain.json.expirations.length > 0)
assert.ok(optionsChain.json.contracts.length > 0)
assert.ok(optionsChain.json.contracts.length <= 6)
assert.ok(['call', 'put'].includes(optionsChain.json.contracts[0].type))

const nonAppleOptionsChain = await callMarket('/api/options/chain?symbol=MSFT&limit=4&type=put')
assert.equal(nonAppleOptionsChain.status, 200)
assert.equal(nonAppleOptionsChain.json.symbol, 'MSFT')
assert.ok(nonAppleOptionsChain.json.contracts.length > 0)
assert.ok(nonAppleOptionsChain.json.contracts.every((contract) => contract.underlying === 'MSFT'))
assert.ok(nonAppleOptionsChain.json.contracts.every((contract) => contract.type === 'put'))

console.log('market-smoke ok')
