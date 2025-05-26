/**
 * OctoBeats Radio Service Worker
 * Provides offline functionality and caching for PWA
 */

const CACHE_NAME = 'octobeats-radio-v1';
const STATIC_CACHE_URLS = [
    '/radio/',
    '/radio/index.html',
    '/radio/assets/css/radio.css',
    '/radio/assets/js/radio.js',
    '/radio/manifest.json',
    '/radio/favicon-96x96.png',
    '/radio/icon-192x192.png',
    '/radio/icon-512x512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Caching static assets');
                return cache.addAll(STATIC_CACHE_URLS);
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
                console.log('✅ Service Worker activated successfully');
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
    
    // Handle audio files with network-first strategy
    if (url.pathname.includes('/assets/audios/') && url.pathname.endsWith('.mp3')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Clone the response before caching
                    const responseClone = response.clone();
                    
                    // Cache successful responses
                    if (response.status === 200) {
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseClone);
                            });
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
    
    // Handle manifest.json with network-first strategy
    if (url.pathname.includes('manifest.json')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const responseClone = response.clone();
                    
                    if (response.status === 200) {
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseClone);
                            });
                    }
                    
                    return response;
                })
                .catch(() => {
                    return caches.match(request);
                })
        );
        return;
    }
    
    // Handle static assets with cache-first strategy
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                return fetch(request)
                    .then((response) => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        const responseClone = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseClone);
                            });
                        
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

// Handle background sync for offline actions
self.addEventListener('sync', (event) => {
    console.log('🔄 Background sync triggered:', event.tag);
    
    if (event.tag === 'background-sync') {
        event.waitUntil(
            // Handle any background sync tasks here
            Promise.resolve()
        );
    }
});

// Handle push notifications (if needed in the future)
self.addEventListener('push', (event) => {
    console.log('📬 Push notification received');
    
    const options = {
        body: 'New music tracks available!',
        icon: '/radio/icon-192x192.png',
        badge: '/radio/favicon-96x96.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Listen Now',
                icon: '/radio/icon-192x192.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/radio/icon-192x192.png'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('OctoBeats Radio', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Notification clicked:', event.action);
    
    event.notification.close();
    
    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/radio/')
        );
    }
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    console.log('💬 Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('🎵 OctoBeats Radio Service Worker loaded'); 