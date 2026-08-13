// SINTONIA Service Worker v4
const CACHE_NAME = 'sintonia-v4';
const CRITICAL_ASSETS = [
  './',
  './sintonia-radio-hub.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// Install: cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CRITICAL_ASSETS).catch(() => {
        // If offline during install, just continue — we'll cache on first use
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for live streams, cache-fallback for API
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Live streaming URLs — always go to network, never cache (would be stale).
  // Keyword matching alone misses plenty of real stream URLs (bare IP:port,
  // generic paths), so we also check req.destination, which browsers set to
  // 'audio' for requests made by an <audio> element — this is the reliable
  // signal. We also pass cache:'no-store' explicitly: without it, fetch()
  // may still be satisfied from the browser's own HTTP cache if the stream
  // server doesn't send strict no-cache headers, which is what causes
  // playback to "resume" from an earlier, stale point after a reconnect.
  const looksLikeStream =
    req.destination === 'audio' ||
    url.hostname.includes('stream') ||
    url.hostname.includes('radio') ||
    req.url.includes('.mp3') ||
    req.url.includes('.m3u') ||
    req.url.includes('/stream');

  if (looksLikeStream) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => {
        return new Response('Stream unavailable', { status: 503 });
      })
    );
    return;
  }

  // Radio Browser API — network-first with cache fallback
  if (url.hostname.includes('api.radio-browser.info')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const cache_copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cache_copy);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((response) => {
            return response || new Response('Offline: no cached data', { status: 503 });
          });
        })
    );
    return;
  }

  // Everything else — cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Listen for messages from the app (e.g., to cache specific data)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_STATIONS') {
    caches.open(CACHE_NAME).then((cache) => {
      cache.add(event.data.url);
    });
  }
});
