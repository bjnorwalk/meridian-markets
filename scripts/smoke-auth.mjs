import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'

const dataDir = mkdtempSync(resolve(tmpdir(), 'meridian-auth-smoke-'))

process.env.DATA_DIR = dataDir
process.env.RESEND_API_KEY = ''
process.env.ADMIN_USERNAME = 'admin'
process.env.ADMIN_PASSWORD = 'test-admin-password'
delete process.env.ALLOW_MARKET_DEBUG
delete process.env.RAILWAY_ENVIRONMENT

const {
  createUser,
  requestPasswordReset,
  resetUserPassword,
} = await import('../server/userStore.mjs')
const { createAuthApiMiddleware } = await import('../server/authApi.mjs')
const { createMarketApiMiddleware } = await import('../server/marketApi.mjs')

function bodyStream(body) {
  if (body === undefined) return Readable.from([])
  if (Buffer.isBuffer(body) || typeof body === 'string') return Readable.from([body])
  return Readable.from([Buffer.from(JSON.stringify(body))])
}

async function callMiddleware(middleware, {
  method = 'GET',
  url,
  body,
  headers = {},
} = {}) {
  const req = Object.assign(bodyStream(body), {
    method,
    url,
    headers,
    socket: {},
  })
  const result = {
    status: 0,
    headers: {},
    body: '',
  }
  const res = {
    writeHead(status, nextHeaders = {}) {
      result.status = status
      result.headers = nextHeaders
    },
    end(payload = '') {
      result.body = String(payload)
    },
  }

  await middleware(req, res, () => false)
  result.json = result.body ? JSON.parse(result.body) : null
  return result
}

function cookieHeader(setCookie) {
  return String(setCookie ?? '').split(';')[0]
}

try {
  await createUser('fixtureuser', 'password123', 'fixture@example.com')

  const missingReset = await requestPasswordReset('missinguser')
  assert.equal(missingReset.resetCode, null)
  assert.equal(missingReset.emailed, false)

  const reset = await requestPasswordReset('fixtureuser')
  assert.match(reset.resetCode, /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/)

  const db = new DatabaseSync(resolve(dataDir, 'market.db'))
  const row = db
    .prepare('SELECT password_reset_json FROM users WHERE username = ?')
    .get('fixtureuser')
  const expiredReset = {
    ...JSON.parse(row.password_reset_json),
    expiresAt: Date.now() - 1000,
  }
  db
    .prepare('UPDATE users SET password_reset_json = ? WHERE username = ?')
    .run(JSON.stringify(expiredReset), 'fixtureuser')

  await assert.rejects(
    () => resetUserPassword('fixtureuser', reset.resetCode, 'newpassword123'),
    /Invalid or expired reset code/,
  )
  db.close()

  const authApi = createAuthApiMiddleware()
  const crossSiteLogin = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      host: 'meridian.test',
      origin: 'https://attacker.test',
    },
    body: { username: 'fixtureuser', password: 'password123' },
  })
  assert.equal(crossSiteLogin.status, 403)
  assert.equal(crossSiteLogin.json.error.code, 'CSRF_BLOCKED')

  const oversizedRegister = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/register',
    headers: {
      'content-length': String(70 * 1024),
    },
    body: { username: 'largebody', password: 'password123' },
  })
  assert.equal(oversizedRegister.status, 413)
  assert.equal(oversizedRegister.json.error.code, 'REQUEST_BODY_TOO_LARGE')

  const invalidJson = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: '{"username"',
  })
  assert.equal(invalidJson.status, 400)
  assert.equal(invalidJson.json.error.code, 'INVALID_JSON')

  const register = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-forwarded-proto': 'https' },
    body: { username: 'cookieuser', password: 'password123' },
  })
  assert.equal(register.status, 201)
  assert.equal(register.headers['x-content-type-options'], 'nosniff')
  assert.equal(register.headers['x-frame-options'], 'DENY')
  assert.match(register.headers['strict-transport-security'], /max-age=31536000/)
  const sessionCookie = register.headers['set-cookie']
  assert.match(sessionCookie, /HttpOnly/)
  assert.match(sessionCookie, /SameSite=Lax/)
  assert.match(sessionCookie, /Secure/)

  const me = await callMiddleware(authApi, {
    url: '/api/auth/me',
    headers: { cookie: cookieHeader(sessionCookie) },
  })
  assert.equal(me.status, 200)
  assert.equal(me.json.user.username, 'cookieuser')

  const logout = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: cookieHeader(sessionCookie), 'x-forwarded-proto': 'https' },
  })
  assert.equal(logout.status, 200)
  assert.match(logout.headers['set-cookie'], /Max-Age=0/)
  assert.match(logout.headers['set-cookie'], /Secure/)

  const afterLogout = await callMiddleware(authApi, {
    url: '/api/auth/me',
    headers: { cookie: cookieHeader(sessionCookie) },
  })
  assert.equal(afterLogout.status, 200)
  assert.equal(afterLogout.json.user, null)

  const marketApi = createMarketApiMiddleware()
  const restrictedDebug = await callMiddleware(marketApi, {
    url: '/api/market/debug',
  })
  assert.equal(restrictedDebug.status, 403)
  assert.equal(restrictedDebug.json.error.code, 'FORBIDDEN')

  const adminLogin = await callMiddleware(authApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'admin', password: 'test-admin-password' },
  })
  assert.equal(adminLogin.status, 200)

  const adminDebug = await callMiddleware(marketApi, {
    url: '/api/market/debug',
    headers: { cookie: cookieHeader(adminLogin.headers['set-cookie']) },
  })
  assert.equal(adminDebug.status, 200)
  assert.equal(typeof adminDebug.json.configured, 'boolean')
  assert.equal(typeof adminDebug.json.feed, 'string')

  console.log('auth-smoke ok')
} finally {
  const { closeUserDatabase } = await import('../server/userStore.mjs')
  closeUserDatabase()
  rmSync(dataDir, { recursive: true, force: true })
}
