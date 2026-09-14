// La versión se sella en cada despliegue con el SHA del commit (GitHub Actions).
// Así el móvil no se queda con una versión cacheada antigua.
const VERSION = '__SW_VERSION__';
const CACHE = 'plan-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nunca cachear Firebase: auth y datos siempre en vivo.
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) return;
  if (e.request.method !== 'GET') return;
  // Network-first: si hay red, la versión fresca gana; si no, tira de caché.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
