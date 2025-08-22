// This file is responsible for registering the service worker
// It should be imported in _app.tsx or another entry point

// These functions are directly exposed for testing
export function registerServiceWorkerImpl(window: Window, navigator: Navigator): void {
  console.debug('registerServiceWorkerImpl called with:', { 
    windowDefined: !!window, 
    navigatorDefined: !!navigator,
    serviceWorkerAvailable: !!(navigator && 'serviceWorker' in navigator)
  });
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(registration => {
        console.log('SW registered: ', registration);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available, notify the user
                if (confirm('New version available! Reload to update?')) {
                  window.location.reload();
                }
              }
            });
          }
        });
      })
      .catch(error => {
        console.error('Service worker registration failed:', error);
      });
    
    // Handle communication with service worker
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, payload } = event.data;
      
      switch (type) {
        case 'CACHE_UPDATED':
          console.log('Cache updated:', payload);
          break;
        case 'OFFLINE_READY':
          console.log('App is ready for offline use');
          break;
        case 'CACHE_ERROR':
          console.error('Cache error:', payload);
          break;
        default:
          // Ignore unknown messages
          break;
      }
    });

    // Handle service worker controller changes
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isRefreshing) {
        window.location.reload();
        isRefreshing = true;
      }
    });
  }
}

export function onWindowLoad(callback: () => void): void {
  if (typeof window !== 'undefined') {
    window.addEventListener('load', callback);
  }
}

export function registerServiceWorker(): void {
  // Debug logging to check conditions
  console.debug('Environment check:', { 
    windowDefined: typeof window !== 'undefined',
    serviceWorkerSupported: typeof window !== 'undefined' && 'serviceWorker' in navigator
  });
  
  if (typeof window !== 'undefined') {
    // For testing, we need to directly call the implementation
    onWindowLoad(() => {
      console.debug('Window load event triggered');
      
      if ('serviceWorker' in navigator) {
        // Directly call the implementation
        registerServiceWorkerImpl(window, navigator);
        
        // Check if service worker needs to be updated on page focus
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }
    });
  }
}

// Helper function to check if the app is running offline
export function isOffline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

// Helper function to send messages to service worker
export function sendToServiceWorker(message: { type: string; payload?: any }) {
  console.debug('Sending message to service worker:', message, {
    navigatorDefined: typeof navigator !== 'undefined',
    serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    controllerExists: typeof navigator !== 'undefined' && 
                      'serviceWorker' in navigator && 
                      !!navigator.serviceWorker.controller
  });
  
  if (typeof navigator !== 'undefined' && 
      'serviceWorker' in navigator && 
      navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

// Function to check cache status
export async function getCacheStatus() {
  if (typeof caches === 'undefined') {
    return { available: false };
  }
  
  try {
    const cacheNames = await caches.keys();
    const cacheDetails = await Promise.all(
      cacheNames.map(async name => {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        return {
          name,
          size: keys.length,
          urls: keys.map(request => request.url).slice(0, 10) // limit to 10 for performance
        };
      })
    );
    
    return {
      available: true,
      caches: cacheDetails,
      totalCached: cacheDetails.reduce((sum, cache) => sum + cache.size, 0)
    };
  } catch (error) {
    console.error('Failed to get cache status:', error);
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Function to clear all service worker caches
export async function clearAllCaches() {
  if (typeof caches === 'undefined') {
    return false;
  }
  
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
    
    // Notify service worker
    sendToServiceWorker({ type: 'CLEAR_ALL_CACHES' });
    
    return true;
  } catch (error) {
    console.error('Failed to clear caches:', error);
    return false;
  }
}

// Function to unregister service worker
export async function unregisterServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to unregister service worker:', error);
    return false;
  }
}
