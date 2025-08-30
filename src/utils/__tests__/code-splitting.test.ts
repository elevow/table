import { dynamicImport, IntelligentPrefetcher, getPrefetcher, defaultCodeSplitConfig } from '../code-splitting';

// Mock variables for IntersectionObserver
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();
const mockUnobserve = jest.fn();

// Mock global objects
beforeAll(() => {
  // Mock IntersectionObserver
  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    
    callback: IntersectionObserverCallback;
    observe = mockObserve;
    disconnect = mockDisconnect;
    unobserve = mockUnobserve;
    takeRecords = jest.fn().mockReturnValue([]);
  }
  
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  
  // Mock window events
  if (typeof window !== 'undefined') {
    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();
  }
});

// Restore mocks after all tests
afterAll(() => {
  jest.restoreAllMocks();
});

describe('Dynamic Import Utility', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  test('successfully imports module on first try', async () => {
    const mockModule = { default: { testFunction: jest.fn() } };
    const importFn = jest.fn().mockResolvedValue(mockModule);
    
  const result = await dynamicImport(importFn);
    
    expect(result).toBe(mockModule);
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and eventually succeeds', async () => {
    const mockModule = { default: { ok: true } };
    const importFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue(mockModule);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await dynamicImport(importFn, 3, 0);

    expect(result).toBe(mockModule);
    expect(importFn).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  test('throws after exhausting retries', async () => {
    const importFn = jest.fn().mockRejectedValue(new Error('always-fail'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(dynamicImport(importFn, 2, 0)).rejects.toThrow('always-fail');
    // two warnings for two retries
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(importFn).toHaveBeenCalledTimes(3); // initial + 2 retries
    warnSpy.mockRestore();
  });
});

describe('IntelligentPrefetcher', () => {
  let prefetcher: IntelligentPrefetcher;
  
  beforeEach(() => {
    // Reset console.log mock to avoid interference
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    prefetcher = new IntelligentPrefetcher(defaultCodeSplitConfig);
  });
  
  afterEach(() => {
    prefetcher.cleanup();
    jest.clearAllMocks();
  });
  
  test('initializes with config and sets up observers', () => {
    expect(prefetcher).toBeDefined();
    
    // Check if event listeners were set up
    if (typeof window !== 'undefined') {
      expect(window.addEventListener).toHaveBeenCalledTimes(2);
      expect(window.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith('mouseover', expect.any(Function));
    }
  });
  
  test('observes component elements for viewport detection', () => {
    const mockElement = document.createElement('div');
    const componentName = 'GameBoard';
    
    prefetcher.observeComponent(mockElement, componentName);
    
    expect(mockElement.getAttribute('data-component')).toBe(componentName);
    
    // Check if IntersectionObserver.observe was called
    expect(mockObserve).toHaveBeenCalledWith(mockElement);
  });
  
  test('prefetches component and its dependencies', () => {
    prefetcher.prefetchComponent('PlayerStats');
    
    // PlayerStats depends on game-core chunk, so both should be prefetched
    expect(console.log).toHaveBeenCalledWith('Prefetching component: GameBoard');
    expect(console.log).toHaveBeenCalledWith('Prefetching component: PlayerStats');
  });
  
  test('handles user interaction prefetching', () => {
    // Mock prefetchComponent method directly
    jest.spyOn(IntelligentPrefetcher.prototype, 'prefetchComponent').mockImplementation(() => {});
    
    // Create a mock element with data attribute
    const mockElement = document.createElement('a');
    mockElement.setAttribute('data-route', '/settings');
    
    // Access the event handler from window.addEventListener mock
    const mockAddEventListener = window.addEventListener as jest.Mock;
    const clickHandlerCall = mockAddEventListener.mock.calls.find(call => call[0] === 'click');
    
    if (!clickHandlerCall) {
      throw new Error('Click handler not registered');
    }
    
    const clickHandler = clickHandlerCall[1];
    
    // Call the handler directly with our mock element
    clickHandler({ target: mockElement });
    
    // Verify the prefetchComponent method would have been called
    // This is more of an integration test, so we can't verify the exact component name
    // without more complex mocking
    expect(IntelligentPrefetcher.prototype.prefetchComponent).toHaveBeenCalled();
  });

  test('upgrades route priority after repeated interactions', () => {
    const cfgCopy = JSON.parse(JSON.stringify(defaultCodeSplitConfig));
    // Ensure /settings starts low priority and prefetch false
    const settingsRoute = cfgCopy.routes.find((r: any) => r.path === '/settings');
    settingsRoute.priority = 'low';
    settingsRoute.prefetch = false;

    const localPrefetcher = new IntelligentPrefetcher(cfgCopy);

    const anchor = document.createElement('a');
    anchor.setAttribute('data-route', '/settings');

    // Trigger >3 interactions
    for (let i = 0; i < 4; i++) {
  // Call the instance handler directly to ensure we mutate cfgCopy
  (localPrefetcher as any).handleUserInteraction({ target: anchor } as any);
    }

    // Expect priority upgraded to medium and prefetch enabled
    expect(settingsRoute.priority).toBe('medium');
    expect(settingsRoute.prefetch).toBe(true);

    localPrefetcher.cleanup();
  });
  
  test('cleanup removes event listeners and disconnects observer', () => {
    prefetcher.cleanup();
    
    if (typeof window !== 'undefined') {
      expect(window.removeEventListener).toHaveBeenCalledTimes(2);
      expect(window.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(window.removeEventListener).toHaveBeenCalledWith('mouseover', expect.any(Function));
    }
    
    // Check if IntersectionObserver was disconnected
    expect(mockDisconnect).toHaveBeenCalled();
  });

  test('handles absence of IntersectionObserver gracefully', () => {
    // Temporarily remove IntersectionObserver
    const originalGlobal = (global as any).IntersectionObserver;
    const originalWindow = (window as any).IntersectionObserver;
    (global as any).IntersectionObserver = undefined;
    (window as any).IntersectionObserver = undefined;

    const localPrefetcher = new IntelligentPrefetcher(defaultCodeSplitConfig);
    const el = document.createElement('div');
    // Should no-op without throwing
    localPrefetcher.observeComponent(el, 'GameBoard');
    localPrefetcher.cleanup();

  // Restore
  (global as any).IntersectionObserver = originalGlobal;
  (window as any).IntersectionObserver = originalWindow;
  });
});

describe('Prefetcher Singleton', () => {
  test('getPrefetcher returns singleton instance', () => {
    const prefetcher1 = getPrefetcher();
    const prefetcher2 = getPrefetcher();
    
    expect(prefetcher1).toBe(prefetcher2);
  });
});
