import type {
  AlertSettings,
  PortfolioHolding,
  PortfolioHoldingInput,
  SymbolRecord,
  WatchlistRecord,
} from '../types/market'

export interface AuthUser {
  id: string
  username: string
}

export interface PasswordResetRequest {
  username: string
  resetCode: string | null
  expiresAt: string
  emailed?: boolean
}

export interface UserPreferences {
  alerts: AlertSettings
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json()) as T & ApiErrorPayload

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed with ${response.status}`)
  }

  return payload
}

export async function getCurrentUser() {
  return apiJson<{ user: AuthUser | null }>('/api/auth/me')
}

export async function loginUser(username: string, password: string) {
  return apiJson<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function registerUser(username: string, password: string, email?: string) {
  return apiJson<{ user: AuthUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email: email || undefined }),
  })
}

export async function requestPasswordReset(username: string) {
  return apiJson<{ reset: PasswordResetRequest }>('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export async function confirmPasswordReset(
  username: string,
  resetCode: string,
  password: string,
) {
  return apiJson<{ user: AuthUser }>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ username, resetCode, password }),
  })
}

export async function logoutUser() {
  return apiJson<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
  })
}

export async function getUserPreferences() {
  return apiJson<{ preferences: UserPreferences }>('/api/preferences')
}

export async function updateUserAlertSettings(alerts: AlertSettings) {
  return apiJson<{ preferences: UserPreferences }>('/api/preferences/alerts', {
    method: 'PATCH',
    body: JSON.stringify({ alerts }),
  })
}

export async function getUserPortfolio() {
  return apiJson<{ portfolio: PortfolioHolding[] }>('/api/portfolio')
}

export async function addUserPortfolioHolding(holding: PortfolioHoldingInput) {
  return apiJson<{ portfolio: PortfolioHolding[] }>('/api/portfolio', {
    method: 'POST',
    body: JSON.stringify({ holding }),
  })
}

export async function updateUserPortfolioHolding(
  holdingId: string,
  holding: PortfolioHoldingInput,
) {
  return apiJson<{ portfolio: PortfolioHolding[] }>(
    `/api/portfolio/${encodeURIComponent(holdingId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ holding }),
    },
  )
}

export async function removeUserPortfolioHolding(holdingId: string) {
  return apiJson<{ portfolio: PortfolioHolding[] }>(
    `/api/portfolio/${encodeURIComponent(holdingId)}`,
    { method: 'DELETE' },
  )
}

export async function getUserWatchlist() {
  return apiJson<{ watchlist: SymbolRecord[] }>('/api/watchlist')
}

export async function getUserWatchlists() {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    '/api/watchlists',
  )
}

export async function createUserWatchlist(name: string) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    '/api/watchlists',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
}

export async function renameUserWatchlist(watchlistId: string, name: string) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  )
}

export async function deleteUserWatchlist(watchlistId: string) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}`,
    { method: 'DELETE' },
  )
}

export async function setActiveUserWatchlist(watchlistId: string) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    '/api/watchlists/active',
    {
      method: 'PATCH',
      body: JSON.stringify({ watchlistId }),
    },
  )
}

export async function addUserWatchlistItem(
  watchlistId: string,
  symbol: SymbolRecord,
) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items`,
    {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    },
  )
}

export async function removeUserWatchlistItem(watchlistId: string, symbol: string) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(symbol)}`,
    { method: 'DELETE' },
  )
}

export async function reorderUserWatchlistItems(
  watchlistId: string,
  symbols: string[],
) {
  return apiJson<{ watchlists: WatchlistRecord[]; activeWatchlistId: string }>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items/reorder`,
    {
      method: 'PATCH',
      body: JSON.stringify({ symbols }),
    },
  )
}

export async function addActiveUserWatchlistItem(symbol: SymbolRecord) {
  return apiJson<{ watchlist: SymbolRecord[] }>('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  })
}

export async function removeActiveUserWatchlistItem(symbol: string) {
  return apiJson<{ watchlist: SymbolRecord[] }>(
    `/api/watchlist/${encodeURIComponent(symbol)}`,
    { method: 'DELETE' },
  )
}
