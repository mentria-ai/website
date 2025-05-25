// OctoBeats Radio Service Worker
const CACHE_NAME = 'octobeats-radio-v1';
const STATIC_ASSETS = [
  '/radio/',
  '/radio/index.html',
  '/radio/assets/css/radio.css',
  '/radio/assets/js/audio-engine.js',
  '/radio/assets/js/equalizer.js',
  '/radio/assets/js/playlist.js',
  '/radio/assets/js/radio.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('✅ Service Worker installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('❌ Service Worker installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('🗑️ Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('✅ Service Worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle different types of requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle audio files - always try network first for fresh content
  if (url.pathname.includes('/assets/audios/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful audio responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }
  
  // Handle manifest.json - always try network first
  if (url.pathname.includes('manifest.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }
  
  // Handle static assets - cache first strategy
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(request)
          .then((response) => {
            // Cache successful responses
            if (response.ok && request.url.startsWith('http')) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, responseClone));
            }
            return response;
          });
      })
      .catch(() => {
        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/radio/index.html');
        }
      })
  );
});

// Background sync for playlist updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'playlist-sync') {
    console.log('🔄 Background sync: updating playlist');
    event.waitUntil(
      fetch('/radio/assets/audios/manifest.json')
        .then((response) => {
          if (response.ok) {
            return caches.open(CACHE_NAME)
              .then((cache) => cache.put('/radio/assets/audios/manifest.json', response));
          }
        })
        .catch((error) => {
          console.log('Background sync failed:', error);
        })
    );
  }
});

// Push notifications (for future use)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'New track available!',
      icon: '/radio/icon-192.png',
      badge: '/radio/badge-72.png',
      tag: 'octobeats-notification',
      data: data.url || '/radio/',
      actions: [
        {
          action: 'play',
          title: 'Play Now',
          icon: '/radio/play-icon.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'OctoBeats Radio', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'play') {
    event.waitUntil(
      clients.openWindow(event.notification.data || '/radio/')
    );
  } else if (event.action === 'dismiss') {
    // Just close the notification
    return;
  } else {
    // Default action - open the app
    event.waitUntil(
      clients.openWindow('/radio/')
    );
  }
});

// Message handler for communication with main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('🎵 OctoBeats Radio Service Worker loaded'); 