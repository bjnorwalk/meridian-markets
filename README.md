# Meridian Markets

A full-stack market dashboard by William Norwalk, built with React, TypeScript, Node.js, SQLite, and Alpaca market data.

## What it demonstrates

- Stock snapshots, price history, bid/ask data, volume, symbol search, and interactive charts.
- Authenticated user accounts with persistent portfolios and watchlists.
- A server-side market-data adapter that keeps API credentials out of the browser.
- Deployment configuration for Railway and a Docker-based Node service.

## Run locally

Use Node.js 24 (the server uses `node:sqlite`).

```sh
npm ci
npm run dev
```

Open http://localhost:5180. For live market data, copy `.env.example` to `.env` and add your own Alpaca credentials. Some views have fallback/demo data; live-data availability depends on your provider permissions. The database is created locally. No production users or portfolios are included.

```sh
npm run lint
npm run build
npm test
```

The smoke tests start local services; use a disposable local data directory when testing. For a production-style local run, build first, then use `npm start` (default port 4173).

## Architecture

| Area | Responsibility |
|---|---|
| `src/components/` | Charts, watchlists, portfolio and analysis views |
| `src/hooks/useMarketData.ts` | Loading and refresh behavior |
| `src/services/` | API access and demo data providers |
| `server/alpacaClient.mjs` | Market provider integration |
| `server/authApi.mjs`, `server/userStore.mjs` | Accounts and persistence |
| `server/start.mjs` | Production HTTP service |

## Deployment

The repository includes `Dockerfile` and `railway.json`. Configure credentials in the hosting environment, set `PORT` to your service port, and mount persistent storage at the configured `DATA_DIR`. GitHub Pages cannot run this Node/SQLite backend.

## Scope

This is a portfolio snapshot of the application. The source includes additional screener, strategy, and optional AI features beyond the core dashboard. Those features may need additional services and configuration. Market data and analysis are presented for demonstration; no live trading credentials or customer data are distributed.
