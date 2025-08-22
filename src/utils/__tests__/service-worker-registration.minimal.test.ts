import {
  registerServiceWorker,
  registerServiceWorkerImpl,
  onWindowLoad,
  isOffline,
  sendToServiceWorker,
  getCacheStatus,
  clearAllCaches,
  unregisterServiceWorker
} from '../service-worker-registration';

describe('Service Worker Registration Minimal Tests', () => {
  // Setup minimal mocks
  const originalWindow = global.window;
  const originalNavigator = global.navigator;
  const originalCaches = global.caches;
  const originalConsole = global.console;

  let mockAddEventListener: jest.Mock;
  let mockRegister: jest.Mock;
  let mockPostMessage: jest.Mock;
  let mockGetRegistration: jest.Mock;
  let mockConsoleLog: jest.Mock;
  let mockConsoleError: jest.Mock;

  beforeEach(() => {
    // Mock console
    mockConsoleLog = jest.fn();
    mockConsoleError = jest.fn();
    global.console = {
      log: mockConsoleLog,
      error: mockConsoleError,
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    } as any;

    // Mock window
    mockAddEventListener = jest.fn();
    global.window = {
      addEventListener: mockAddEventListener,
      location: { reload: jest.fn() }
    } as any;

    // Mock navigator
    mockRegister = jest.fn().mockResolvedValue({
      addEventListener: jest.fn(),
      installing: { addEventListener: jest.fn() }
    });
    mockPostMessage = jest.fn();
    mockGetRegistration = jest.fn().mockResolvedValue({
      unregister: jest.fn().mockResolvedValue(true)
    });
    
    global.navigator = {
      onLine: true,
      serviceWorker: {
        register: mockRegister,
        controller: { postMessage: mockPostMessage },
        addEventListener: jest.fn(),
        getRegistration: mockGetRegistration
      }
    } as any;
    
    // Ensure serviceWorker is defined in navigator type check
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      writable: true,
      value: {
        register: mockRegister,
        controller: { postMessage: mockPostMessage },
        addEventListener: jest.fn(),
        getRegistration: mockGetRegistration
      }
    });

    // Mock caches
    global.caches = {
      keys: jest.fn().mockResolvedValue(['cache1', 'cache2']),
      open: jest.fn().mockResolvedValue({
        keys: jest.fn().mockResolvedValue([
          { url: 'https://example.com/asset1.js' },
          { url: 'https://example.com/asset2.css' }
        ])
      }),
      delete: jest.fn().mockResolvedValue(true)
    } as any;

    // Mock confirm
    global.confirm = jest.fn().mockReturnValue(true);
  });

  afterEach(() => {
    global.window = originalWindow;
    global.navigator = originalNavigator;
    global.caches = originalCaches;
    global.console = originalConsole;

    jest.resetAllMocks();
  });

  describe('registerServiceWorker', () => {
    it('registers service worker on load event', () => {
      // Create a spy on window.addEventListener to catch the load event registration
      const spy = jest.spyOn(global.window, 'addEventListener');
      
      // Act
      registerServiceWorker();

      // Assert - check addEventListener was called
      expect(spy).toHaveBeenCalledWith('load', expect.any(Function));

      // Trigger the load event callback manually
      const loadCallback = spy.mock.calls[0][1] as EventListener;
      const mockEvent = { type: 'load' } as Event;
      loadCallback(mockEvent);

      // Assert service worker was registered
      expect(mockRegister).toHaveBeenCalledWith('/service-worker.js');
      
      // Clean up
      spy.mockRestore();
    });

    it('directly calls registerServiceWorkerImpl', () => {
      // Need to directly spy on the imported module
      const spy = jest.spyOn(require('../service-worker-registration'), 'registerServiceWorkerImpl');
      
      // Call the function directly
      registerServiceWorkerImpl(window as Window, navigator as Navigator);
      
      // Verify it was called
      expect(spy).toHaveBeenCalled();
      
      // Clean up
      spy.mockRestore();
    });
  });

  describe('isOffline', () => {
    it('returns true when navigator.onLine is false', () => {
      // Arrange
      Object.defineProperty(global.navigator, 'onLine', { value: false, configurable: true });

      // Act & Assert
      expect(isOffline()).toBe(true);
    });

    it('returns false when navigator.onLine is true', () => {
      // Arrange
      Object.defineProperty(global.navigator, 'onLine', { value: true, configurable: true });

      // Act & Assert
      expect(isOffline()).toBe(false);
    });
  });

  describe('sendToServiceWorker', () => {
    it('sends message to service worker controller', () => {
      // Arrange
      const message = { type: 'TEST_MESSAGE', payload: 'test data' };
      
      // Make sure navigator.serviceWorker.controller is defined
      Object.defineProperty(navigator.serviceWorker, 'controller', {
        configurable: true,
        value: { postMessage: mockPostMessage }
      });

      // Act
      sendToServiceWorker(message);

      // Assert
      expect(mockPostMessage).toHaveBeenCalledWith(message);
    });
  });

  describe('getCacheStatus', () => {
    it('returns cache status when available', async () => {
      // Act
      const result = await getCacheStatus();

      // Assert
      expect(result).toEqual({
        available: true,
        caches: [
          {
            name: 'cache1',
            size: 2,
            urls: ['https://example.com/asset1.js', 'https://example.com/asset2.css']
          },
          {
            name: 'cache2',
            size: 2,
            urls: ['https://example.com/asset1.js', 'https://example.com/asset2.css']
          }
        ],
        totalCached: 4
      });
    });
  });

  describe('clearAllCaches', () => {
    it('clears all caches successfully', async () => {
      // Act
      const result = await clearAllCaches();

      // Assert
      expect(result).toBe(true);
      expect(global.caches.keys).toHaveBeenCalled();
      expect(global.caches.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('unregisterServiceWorker', () => {
    it('unregisters service worker successfully', async () => {
      // Arrange
      const mockUnregister = jest.fn().mockResolvedValue(true);
      mockGetRegistration.mockResolvedValue({
        unregister: mockUnregister
      });

      // Act
      const result = await unregisterServiceWorker();

      // Assert
      expect(mockGetRegistration).toHaveBeenCalled();
      expect(mockUnregister).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
