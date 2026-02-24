const CACHE_NAME = 'mentria-cache-v2';
const ASSETS = [
  '/',
  '/assets/css/style.css',
  '/manifest.json',
  '/tools/decision-wheel/',
  '/tools/decision-wheel/index.html',
  '/tools/countdown-timer/',
  '/tools/countdown-timer/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
