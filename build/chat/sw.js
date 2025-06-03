const CACHE_NAME = 'webllm-chat-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './favicon-96x96.png',
  './icon-192x192.png',
  './icon-512x512.png',
  './manifest.json',
  'https://esm.run/@mlc-ai/web-llm'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Service Worker: Static assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Cache failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip requests to different origins (like WebLLM model downloads)
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.includes('esm.run')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache', event.request.url);
          return cachedResponse;
        }

        // Otherwise fetch from network
        console.log('Service Worker: Fetching from network', event.request.url);
        return fetch(event.request)
          .then((response) => {
            // Don't cache if not a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone response for caching
            const responseToCache = response.clone();

            // Cache the response for future use
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch((error) => {
            console.error('Service Worker: Fetch failed', error);
            // Return a custom offline page if available
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// Handle model downloads and WebLLM cache
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_MODEL_SHARD') {
    const { url, data } = event.data;
    
    // Cache model shards
    caches.open(CACHE_NAME + '-models')
      .then((cache) => {
        const response = new Response(data);
        return cache.put(url, response);
      })
      .then(() => {
        console.log('Service Worker: Model shard cached', url);
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache model shard', error);
      });
  }
}); 