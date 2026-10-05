const CACHE_NAME = 'meridian-markets-v4'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/apple-touch-icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {})).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) return

  const isStatic = STATIC_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        return cached || fetchPromise
      }),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      }).catch(() => caches.match('/'))
    }),
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()
    const title = data.title || 'Meridian Markets'
    const options = {
      body: data.body || '',
      icon: '/apple-touch-icon.png',
      badge: '/favicon.svg',
      tag: data.tag || 'market-alert',
      data: {
        url: data.url || '/',
      },
    }

    event.waitUntil(self.registration.showNotification(title, options))
  } catch (err) {
    const text = event.data.text()
    event.waitUntil(self.registration.showNotification('Meridian Markets', { body: text }))
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const matching = windowClients.find((client) => {
        return client.url.includes(self.location.origin)
      })
      if (matching) {
        matching.focus()
        if (matching.navigate && urlToOpen !== '/') matching.navigate(urlToOpen)
        return
      }
      return clients.openWindow(urlToOpen)
    }),
  )
})
