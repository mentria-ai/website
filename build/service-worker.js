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
  // Skip cross-origin requests and non-GET requests
  if (!event.request.url.startsWith(self.location.origin) || event.request.method !== 'GET') {
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
    
    // Only cache successful, non-partial responses from GET requests
    if (request.method === 'GET' && networkResponse.ok && networkResponse.status !== 206) {
      try {
        await cache.put(request, networkResponse.clone());
      } catch (cacheError) {
        console.error('Service Worker: Caching failed:', cacheError);
      }
    }
    
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
    
    // Only cache successful, non-partial responses from GET requests
    if (request.method === 'GET' && networkResponse.ok && networkResponse.status !== 206) {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.put(request, networkResponse.clone());
      } catch (cacheError) {
        console.error('Service Worker: Caching failed:', cacheError);
      }
    }
    
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
    // Only cache successful, non-partial responses from GET requests
    if (request.method === 'GET' && response.ok && response.status !== 206) {
      try {
        cache.put(request, response.clone());
      } catch (cacheError) {
        console.error('Service Worker: Caching failed:', cacheError);
      }
    }
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
        // Here you'd normally make an API call to your backend
        // For this demo, we'll just update the liked status in IndexedDB
        if (like.action === 'add') {
          await addLikedQuoteToDB(like.quoteId);
        } else if (like.action === 'remove') {
          await removeLikedQuoteFromDB(like.quoteId);
        }
        
        // Remove from pending after successful processing
        await removePendingLikeFromDB(like.id);
      } catch (error) {
        console.error('Failed to process like:', error);
      }
    }
  } catch (error) {
    console.error('Failed to sync likes:', error);
  }
}

// IndexedDB implementation
const DB_NAME = 'mentria_quotes_db';
const DB_VERSION = 1;
const LIKES_STORE = 'liked_quotes';
const PENDING_STORE = 'pending_likes';

// Open the database
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = event => {
      console.error('Error opening IndexedDB:', event.target.error);
      reject(event.target.error);
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      
      // Create stores if they don't exist
      if (!db.objectStoreNames.contains(LIKES_STORE)) {
        db.createObjectStore(LIKES_STORE, { keyPath: 'quoteId' });
      }
      
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
      }
    };
  });
}

// Get pending likes from IndexedDB
async function getPendingLikesFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(PENDING_STORE, 'readonly');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.getAll();
      
      request.onsuccess = () => {
        resolve(request.result || []);
      };
      
      request.onerror = event => {
        console.error('Error getting pending likes:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
    return [];
  }
}

// Remove pending like from IndexedDB
async function removePendingLikeFromDB(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(PENDING_STORE, 'readwrite');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.delete(id);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = event => {
        console.error('Error removing pending like:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
  }
}

// Add liked quote to IndexedDB
async function addLikedQuoteToDB(quoteId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LIKES_STORE, 'readwrite');
      const store = transaction.objectStore(LIKES_STORE);
      const request = store.put({ quoteId, timestamp: Date.now() });
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = event => {
        console.error('Error adding liked quote:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
  }
}

// Remove liked quote from IndexedDB
async function removeLikedQuoteFromDB(quoteId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LIKES_STORE, 'readwrite');
      const store = transaction.objectStore(LIKES_STORE);
      const request = store.delete(quoteId);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = event => {
        console.error('Error removing liked quote:', event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error('Error accessing IndexedDB:', error);
  }
}

// Precaching of quotes
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_QUOTES') {
    const urls = event.data.urls;
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return Promise.all(
          urls.map(url => {
            return fetch(url).then(response => {
              // Only cache successful, non-partial responses
              if (response.ok && response.status !== 206) {
                return cache.put(url, response);
              }
              return Promise.resolve();
            }).catch(error => {
              console.error(`Service Worker: Failed to cache ${url}:`, error);
              return Promise.resolve();
            });
          })
        );
      })
    );
  }
}); 