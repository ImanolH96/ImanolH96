// Network-first service worker: online you always get the latest version; offline, the cached copy.
const CACHE = 'cuaderno-v2';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'fonts/bricolage.woff2', 'css/styles.css',
  'js/main.js', 'js/config.js',
  'js/core/dom.js', 'js/core/store.js', 'js/core/router.js',
  'js/data/model.js', 'js/data/images.js', 'js/data/ai.js', 'js/data/backup.js',
  'js/ui/overlays.js', 'js/ui/platform.js', 'js/ui/components.js',
  'js/views/list.js', 'js/views/detail.js', 'js/views/edit.js', 'js/views/ia.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});
