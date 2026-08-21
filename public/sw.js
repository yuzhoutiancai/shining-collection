const CACHE_PREFIX = 'shining-collection-shell-'
const CACHE = `${CACHE_PREFIX}v3`
const SCOPE = self.registration.scope
const scoped = (path = '') => new URL(path, SCOPE).toString()
const INDEX = scoped('index.html')
const CORE = [scoped('manifest.webmanifest'), scoped('icon.svg'), scoped('icon-192.png'), scoped('icon-512.png'), scoped('icon-maskable-512.png')]

async function cacheAppShell() {
  const cache = await caches.open(CACHE)
  const response = await fetch(INDEX, { cache: 'reload' })
  if (!response.ok) throw new Error(`Unable to cache app shell: ${response.status}`)

  const html = await response.clone().text()
  await cache.put(INDEX, response.clone())
  await cache.put(scoped(), response.clone())

  const linkedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], INDEX).toString())
    .filter((url) => url.startsWith(SCOPE))

  await cache.addAll([...new Set([...CORE, ...linkedAssets])])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) void caches.open(CACHE).then((cache) => cache.put(INDEX, response.clone()))
          return response
        })
        .catch(async () => (await caches.match(INDEX)) || Response.error()),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) void caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
        return response
      })
    }),
  )
})
