import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import { createAuthApiMiddleware } from './authApi.mjs'
import { createMarketApiMiddleware } from './marketApi.mjs'
import { createStrategyApiMiddleware } from './strategyApi.mjs'
import { loadEnv } from './env.mjs'
loadEnv()

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? '5180')
const authApi = createAuthApiMiddleware()
const marketApi = createMarketApiMiddleware()
const strategyApi = createStrategyApiMiddleware()

const vite = await createServer({
  server: {
    middlewareMode: true,
  },
})

const server = createHttpServer(async (req, res) => {
  const handled =
    (await authApi(req, res, () => false)) ||
    (await marketApi(req, res, () => false)) ||
    (await strategyApi(req, res, () => false))
  if (!handled) vite.middlewares(req, res)
})

server.listen(port, host, () => {
  console.log(`Meridian Markets dev server running at http://${host}:${port}/`)
})
