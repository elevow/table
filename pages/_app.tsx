import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Script from 'next/script';

// Code splitting and optimization imports
import { dynamicImport } from '../src/utils/code-splitting';
// Service worker registration
import { registerServiceWorker, isOffline } from '../src/utils/service-worker-registration';

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isRouteChanging, setIsRouteChanging] = useState(false);
  const [loadingKey, setLoadingKey] = useState(0);
  const [offline, setOffline] = useState(false);
  
  useEffect(() => {
    // Register service worker for caching and offline support
    registerServiceWorker();
    
    // Initialize offline status
    setOffline(isOffline());
    
    // Listen for online/offline events
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  useEffect(() => {
    // Setup route change handlers for loading indicators
    const handleRouteChangeStart = () => {
      setIsRouteChanging(true);
      setLoadingKey(prevKey => prevKey + 1);
    };
    
    const handleRouteChangeComplete = () => {
      setIsRouteChanging(false);
    };
    
    router.events.on('routeChangeStart', handleRouteChangeStart);
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    router.events.on('routeChangeError', handleRouteChangeComplete);
    
    // Prefetch critical routes
    const prefetchCriticalRoutes = async () => {
      // Home page is likely to be visited
      router.prefetch('/');
      
      // Main game routes that should be available quickly
      if (router.pathname !== '/game/[id]') {
        // Dynamically load the game route metadata
        try {
          // Note: If game-routes.ts doesn't exist, this will need to be created or modified
          await dynamicImport(() => import('../src/utils/game-routes'));
          console.log('Prefetched game route metadata');
        } catch (error) {
          console.error('Failed to prefetch game route metadata', error);
        }
      }
      
      // Only prefetch profile if user is logged in
      const isLoggedIn = typeof window !== 'undefined' && Boolean(localStorage.getItem('auth_token'));
      if (isLoggedIn) {
        router.prefetch('/profile');
      }
    };
    
    // Execute prefetching after a short delay to prioritize current route
    const prefetchTimer = setTimeout(prefetchCriticalRoutes, 2000);
    
    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
      router.events.off('routeChangeError', handleRouteChangeComplete);
      clearTimeout(prefetchTimer);
    };
  }, [router]);
  
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="Online poker game platform" />
        <link rel="icon" href="/favicon.ico" />
        
        {/* Add preload hints for critical resources */}
        <link rel="preload" href="/fonts/main-font.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.example.com" />
        <link rel="dns-prefetch" href="https://api.example.com" />
      </Head>
      
      {/* Load non-critical JavaScript after page load */}
      <Script
        src="https://cdn.example.com/analytics.js"
        strategy="lazyOnload"
        onLoad={() => console.log('Analytics script loaded')}
      />
      
      {/* Offline indicator */}
      {offline && (
        <div className="offline-indicator">
          You are currently offline. Some features may be limited.
        </div>
      )}
      
      {/* Loading indicator for route changes */}
      {isRouteChanging && (
        <div className="route-change-indicator" key={loadingKey}>
          Loading...
        </div>
      )}
      
      <Component {...pageProps} />
    </>
  );
}

export default MyApp;
