// Service Worker for offline caching
// This file should be placed at the root of the public directory

const CACHE_NAME = 'poker-app-v1';
const RUNTIME_CACHE_NAME = 'poker-app-runtime';

// Resources to cache immediately on service worker install
const PRECACHE_RESOURCES = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/manifest.json',
  '/fonts/main-font.woff2',
  '/css/main.css',
  '/js/main.js',
  '/offline.html'
];

// Listen for install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // console.log('Service worker precaching resources');
        return cache.addAll(PRECACHE_RESOURCES);
      })
      .then(() => {
        // Skip waiting to activate the service worker immediately
        return self.skipWaiting();
      })
  );
});

// Listen for activate event
self.addEventListener('activate', (event) => {
  // Delete old caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            // Delete old version of caches
            return cacheName.startsWith('poker-app-') && 
                  cacheName !== CACHE_NAME &&
                  cacheName !== RUNTIME_CACHE_NAME;
          })
          .map(cacheName => {
            // console.log('Service worker removing old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      // Claim all clients to allow the service worker to control them
      return self.clients.claim();
    })
  );
});

// Listen for fetch events
self.addEventListener('fetch', (event) => {
  // API requests should not be cached using this simple strategy
  if (event.request.url.includes('/api/')) {
    // For API requests, use network first, falling back to cache
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the API response for offline use
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // If network fails, try to serve from cache
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // If not in cache, respond with offline page for HTML requests
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }
            
            // Return a basic error for other resources
            return new Response('Network error happened', {
              status: 408,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
  } else {
    // For non-API requests, use cache first, falling back to network
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Not in cache, fetch from network
        return fetch(event.request).then(response => {
          // Only cache successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone the response to cache it and return the original
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE_NAME).then(cache => {
            // Don't cache videos or large files
            const url = event.request.url;
            if (!url.endsWith('.mp4') && !url.endsWith('.webm') && !url.endsWith('.mov')) {
              cache.put(event.request, responseToCache);
            }
          });
          
          return response;
        }).catch(() => {
          // Network failed, check if it's an HTML request
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/offline.html');
          }
          
          // Return a basic error for other resources
          return new Response('Network error happened', {
            status: 408,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
  }
});

// Listen for message events (e.g., from the cache manager)
self.addEventListener('message', (event) => {
  if (event.data.type === 'INIT_CACHE_CHANNEL') {
    // Store the port for communication
    const port = event.ports[0];
    
    // Use the port to send a message back
    port.postMessage({
      type: 'CACHE_UPDATED',
      payload: {
        timestamp: Date.now(),
        status: 'Service worker initialized'
      }
    });
  } else if (event.data.type === 'CACHE_CLEAR') {
    // Clear specified caches
    const cacheNames = event.data.payload?.cacheNames || [];
    
    if (cacheNames.length === 0) {
      // Clear all caches
      caches.keys().then(names => {
        Promise.all(names.map(name => caches.delete(name)))
          .then(() => {
            // Notify clients about cache clearing
            self.clients.matchAll().then(clients => {
              clients.forEach(client => {
                client.postMessage({
                  type: 'CACHE_CLEARED',
                  payload: {
                    timestamp: Date.now()
                  }
                });
              });
            });
          });
      });
    } else {
      // Clear specific caches
      Promise.all(cacheNames.map(name => caches.delete(name)))
        .then(() => {
          // Notify clients
          self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'CACHE_CLEARED',
                payload: {
                  cacheNames,
                  timestamp: Date.now()
                }
              });
            });
          });
        });
    }
  }
});

// Listen for push notifications
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }
  
  try {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'New notification',
      icon: data.icon || '/favicon.ico',
      badge: data.badge || '/favicon.ico',
      data: {
        url: data.url || '/'
      }
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'Poker App', options)
    );
  } catch (error) {
    console.error('Error showing push notification:', error);
  }
});

// Listen for notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Check if there is already a window/tab open with the target URL
      const url = event.notification.data.url;
      
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        // If so, just focus it
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      
      // If not, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
