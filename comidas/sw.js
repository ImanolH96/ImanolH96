// Cache-first service worker: after the first visit the app works fully offline.
const CACHE = 'comidas-libres-v19';
const ASSETS = ['./', 'index.html', 'app.js', 'vendor/xlsx.mini.min.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'fonts/bricolage.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
