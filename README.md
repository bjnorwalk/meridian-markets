# Meridian Markets

A market dashboard built with React, TypeScript, Node.js, SQLite, and Alpaca data.
It brings price history, stock snapshots, bid/ask data, symbol search, and charts
into one workspace. Accounts keep portfolios and watchlists in a local database.

Market requests go through a server-side adapter so provider credentials stay
out of the browser. Some views fall back to demo data when live data is not
available. Provider permissions determine which feeds can be used.

Fundamentals also use Yahoo Finance endpoints. Some responses currently fail
schema validation, which the server logs. Those fields may remain missing even
when the local app and tests run successfully.

## Run locally

Use Node.js 24; the server uses `node:sqlite`.

```sh
npm ci
npm run dev
```

Open [localhost:5180](http://localhost:5180). For live data, copy `.env.example`
to `.env` and add your own Alpaca credentials. The database is created locally;
the repository does not include user accounts or portfolios.

## Checks

```sh
npm run check
```

This runs lint, smoke tests, and the production build. GitHub Actions runs the same
checks on pushes and pull requests. Each command can also be run separately.

Smoke tests cover authentication, market endpoints, and strategy behavior. They
use local test data. For a production-style local run, build first and run
`npm start`, which defaults to port 4173 unless `PORT` is set.

## Implementation

| Location                                     | Responsibility                                    |
| -------------------------------------------- | ------------------------------------------------- |
| `src/components/`                            | Charts, watchlists, portfolio, and analysis views |
| `src/hooks/useMarketData.ts`                 | Loading and refresh behavior                      |
| `src/services/`                              | API clients and demo data providers               |
| `server/alpacaClient.mjs`                    | Market provider requests                          |
| `server/authApi.mjs`, `server/userStore.mjs` | Accounts and SQLite storage                       |
| `server/start.mjs`                           | Production HTTP server                            |

The source also includes screeners, strategy tools, and an optional market chat.
Chat uses Ollama or Groq and needs its own service configuration. Email and
notifications also need separate configuration. These are application features,
not requirements for running the core dashboard.

## Deployment

`Dockerfile` and `railway.json` describe the Node deployment. Set credentials in
the hosting environment, set `PORT` for the service, and point `DATA_DIR` at
persistent storage. GitHub Pages cannot run the Node/SQLite backend.

This is a demonstration application. Data may be delayed or synthetic, and the
repository does not include live trading credentials or customer data.
