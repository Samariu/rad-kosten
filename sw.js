// App-shell cache. Bump CACHE_VERSION whenever a shell file changes — the
// old cache is then dropped on activate.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `rad-kosten-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calc.js',
  './db.js',
  './charts.js',
  './format.js',
  './recurring.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Stale-while-revalidate: instant and fully offline from cache, while the
  // next load quietly picks up a newer deploy even if the version wasn't bumped.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const response = await network;
      if (response) return response;
      // Offline and never cached: fall back to the shell for a navigation.
      if (request.mode === 'navigate') {
        return (await cache.match('./index.html')) || Response.error();
      }
      return Response.error();
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.ports[0]?.postMessage(CACHE_VERSION);
});
