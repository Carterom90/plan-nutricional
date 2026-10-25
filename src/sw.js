// La versión se sella en cada despliegue con el SHA del commit (GitHub Actions).
// Así el móvil no se queda con una versión cacheada antigua.
const VERSION = '__SW_VERSION__';
const CACHE = 'balance-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

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
  // Solo recursos propios; Firebase (auth y datos) siempre en vivo.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  // Network-first: con red gana la versión fresca; sin red, tira de caché.
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
