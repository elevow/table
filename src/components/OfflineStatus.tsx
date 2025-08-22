import { useState, useEffect } from 'react';
import { isOffline, getCacheStatus, clearAllCaches } from '../utils/service-worker-registration';
import { getOfflineSupportedRoutes } from '../utils/game-routes';
import Link from 'next/link';

/**
 * OfflineStatus component displays the current offline status
 * and allows users to manage cached content
 */
export default function OfflineStatus() {
  const [offline, setOffline] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<any>(null);
  const [offlineRoutes, setOfflineRoutes] = useState<any[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  
  // Monitor online status
  useEffect(() => {
    const updateOfflineStatus = () => {
      setOffline(isOffline());
    };
    
    // Initial check
    updateOfflineStatus();
    
    // Setup event listeners
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
    
    return () => {
      window.removeEventListener('online', updateOfflineStatus);
      window.removeEventListener('offline', updateOfflineStatus);
    };
  }, []);
  
  // Get offline-supported routes
  useEffect(() => {
    setOfflineRoutes(getOfflineSupportedRoutes());
  }, []);
  
  // Function to check cache status
  const checkCacheStatus = async () => {
    const status = await getCacheStatus();
    setCacheInfo(status);
    setShowDetails(true);
  };
  
  // Function to clear caches
  const handleClearCache = async () => {
    const cleared = await clearAllCaches();
    if (cleared) {
      setCacheInfo(null);
      alert('Caches cleared successfully');
    } else {
      alert('Failed to clear caches');
    }
  };
  
  return (
    <div className="offline-status-container">
      <div className={`status-indicator ${offline ? 'offline' : 'online'}`}>
        <div className="status-dot"></div>
        <span>{offline ? 'Offline' : 'Online'}</span>
      </div>
      
      {offline && (
        <div className="offline-message">
          <p>You are currently offline. Some features may be limited.</p>
          <h3>Available offline:</h3>
          <ul className="offline-routes">
            {offlineRoutes.map(route => (
              <li key={route.id}>
                <Link href={route.path}>
                  <a>{route.id}</a>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      <div className="cache-controls">
        <button onClick={checkCacheStatus} className="cache-button">
          Check Cache Status
        </button>
        <button onClick={handleClearCache} className="cache-button clear">
          Clear Cached Data
        </button>
      </div>
      
      {showDetails && cacheInfo && (
        <div className="cache-details">
          <h3>Cache Information</h3>
          {cacheInfo.available ? (
            <>
              <p>Total cached items: {cacheInfo.totalCached}</p>
              <div className="cache-list">
                {cacheInfo.caches.map((cache: any) => (
                  <div key={cache.name} className="cache-item">
                    <h4>{cache.name}</h4>
                    <p>Items: {cache.size}</p>
                    {cache.urls.length > 0 && (
                      <details>
                        <summary>Cached URLs</summary>
                        <ul className="url-list">
                          {cache.urls.map((url: string, index: number) => (
                            <li key={index}>{url}</li>
                          ))}
                          {cache.size > cache.urls.length && (
                            <li>...and {cache.size - cache.urls.length} more</li>
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>Cache API not available or no caches found.</p>
          )}
          <button 
            onClick={() => setShowDetails(false)} 
            className="cache-button"
          >
            Hide Details
          </button>
        </div>
      )}
      
      <style jsx>{`
        .offline-status-container {
          padding: 1rem;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          margin: 1rem 0;
          background-color: #f9f9f9;
        }
        
        .status-indicator {
          display: flex;
          align-items: center;
          font-weight: bold;
          margin-bottom: 1rem;
        }
        
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          margin-right: 8px;
        }
        
        .online .status-dot {
          background-color: #4caf50;
        }
        
        .offline .status-dot {
          background-color: #f44336;
        }
        
        .offline-message {
          background-color: #ffe8e6;
          border-left: 4px solid #f44336;
          padding: 1rem;
          margin-bottom: 1rem;
        }
        
        .offline-routes {
          list-style-type: none;
          padding: 0;
        }
        
        .offline-routes li {
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        
        .cache-controls {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }
        
        .cache-button {
          padding: 8px 16px;
          background-color: #2196f3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        
        .cache-button:hover {
          background-color: #0b7dda;
        }
        
        .cache-button.clear {
          background-color: #f44336;
        }
        
        .cache-button.clear:hover {
          background-color: #d32f2f;
        }
        
        .cache-details {
          background-color: #e8f4fd;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
        }
        
        .cache-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        
        .cache-item {
          background-color: white;
          padding: 1rem;
          border-radius: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .cache-item h4 {
          margin-top: 0;
          color: #2196f3;
        }
        
        details {
          margin-top: 0.5rem;
        }
        
        summary {
          cursor: pointer;
          color: #2196f3;
        }
        
        .url-list {
          max-height: 200px;
          overflow-y: auto;
          font-size: 12px;
          padding-left: 1.5rem;
        }
      `}</style>
    </div>
  );
}
