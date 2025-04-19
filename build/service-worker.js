// Service Worker for Mentria.AI PWA
const CACHE_NAME = 'mentria-cache-v1';

// Assets to cache initially
const INITIAL_CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/styles.css',
  '/assets/js/main.js',
  '/assets/js/quotes.js',
  '/assets/js/animated-subtitles.js',
  '/assets/js/utils.js',
  '/assets/data/directory.json',
  '/assets/img/favicon-96x96.png',
];

// Install event - cache initial assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching initial assets');
        return cache.addAll(INITIAL_CACHE_URLS);
      })
      .catch(err => console.error('Service Worker: Cache failed', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Cleaning old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // For JSON files, use network-first strategy to get fresh data
  if (event.request.url.includes('directory.json')) {
    event.respondWith(
      fetchWithNetworkFirst(event.request)
    );
    return;
  }

  // For images and audio files, use cache-first strategy to save bandwidth
  if (
    event.request.url.includes('/img/quotes/') || 
    event.request.url.includes('/audio/quotes/')
  ) {
    event.respondWith(
      fetchWithCacheFirst(event.request)
    );
    return;
  }

  // For all other assets, use stale-while-revalidate strategy
  event.respondWith(
    fetchWithStaleWhileRevalidate(event.request)
  );
});

// Network-first strategy - try network, fallback to cache
async function fetchWithNetworkFirst(request) {
  try {
    // Try to get from network first
    const networkResponse = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    
    // Update cache with fresh response
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    // If network fails, try to get from cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // If not in cache, then throw error
    throw error;
  }
}

// Cache-first strategy - try cache, fallback to network
async function fetchWithCacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // If not in cache, fetch from network and cache
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Network fetch failed', error);
    // For images, could return fallback image
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// Stale-while-revalidate strategy - return cache but update in background
async function fetchWithStaleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  
  // Get from cache
  const cachedResponse = await cache.match(request);
  
  // Fetch and update cache in background
  const fetchPromise = fetch(request).then(response => {
    cache.put(request, response.clone());
    return response;
  }).catch(error => {
    console.error('Service Worker: Fetch failed', error);
  });
  
  // Return cached response if available, otherwise wait for fetch
  return cachedResponse || fetchPromise;
}

// Background sync for offline likes
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-likes') {
    event.waitUntil(syncLikes());
  }
});

// Function to sync likes when online
async function syncLikes() {
  try {
    // Get pending likes from IndexedDB
    const pendingLikes = await getPendingLikesFromDB();
    
    if (pendingLikes.length === 0) {
      return;
    }
    
    // Process each pending like
    for (const like of pendingLikes) {
      try {
        // Here you'd normally make an API call
        // For this demo, we'll just update localStorage
        let likedQuotes = JSON.parse(localStorage.getItem('likedQuotes') || '[]');
        
        if (like.action === 'add') {
          if (!likedQuotes.includes(like.quoteId)) {
            likedQuotes.push(like.quoteId);
          }
        } else if (like.action === 'remove') {
          likedQuotes = likedQuotes.filter(id => id !== like.quoteId);
        }
        
        localStorage.setItem('likedQuotes', JSON.stringify(likedQuotes));
        
        // Remove from pending after successful processing
        await removePendingLikeFromDB(like.id);
      } catch (error) {
        console.error('Failed to process like:', error);
      }
    }
  } catch (error) {
    console.error('Failed to sync likes:', error);
    throw error;
  }
}

// IndexedDB mock functions (replace with actual implementation)
async function getPendingLikesFromDB() {
  // Mock implementation - would use actual IndexedDB in production
  const pendingStr = localStorage.getItem('pendingLikes');
  return pendingStr ? JSON.parse(pendingStr) : [];
}

async function removePendingLikeFromDB(id) {
  // Mock implementation - would use actual IndexedDB in production
  const pending = await getPendingLikesFromDB();
  const filtered = pending.filter(like => like.id !== id);
  localStorage.setItem('pendingLikes', JSON.stringify(filtered));
}

// Precaching of quotes
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_QUOTES') {
    const urls = event.data.urls;
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(urls);
      })
    );
  }
}); 