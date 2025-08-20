import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  dynamicImport, 
  IntelligentPrefetcher, 
  getPrefetcher, 
  defaultCodeSplitConfig 
} from '../../src/utils/code-splitting';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
const mockIntersectionObserver = vi.fn(() => ({
  observe: mockObserve,
  disconnect: mockDisconnect,
  unobserve: vi.fn(),
  takeRecords: vi.fn()
}));

// Mock console methods
const originalConsole = { ...console };
const mockConsoleLog = vi.fn();
const mockConsoleWarn = vi.fn();

describe('Code Splitting Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.IntersectionObserver = mockIntersectionObserver;
    console.log = mockConsoleLog;
    console.warn = mockConsoleWarn;
    
    // Mock window object
    if (typeof window === 'undefined') {
      (global as any).window = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
    }
  });
  
  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    vi.restoreAllMocks();
  });
  
  describe('dynamicImport', () => {
    it('should successfully import a module', async () => {
      const mockImportFn = vi.fn().mockResolvedValue({ default: 'test-module' });
      
      const result = await dynamicImport(mockImportFn);
      
      expect(mockImportFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ default: 'test-module' });
    });
    
    it('should retry failed imports', async () => {
      const mockImportFn = vi.fn()
        .mockRejectedValueOnce(new Error('Import failed'))
        .mockResolvedValueOnce({ default: 'test-module' });
      
      const result = await dynamicImport(mockImportFn, 3, 10);
      
      expect(mockImportFn).toHaveBeenCalledTimes(2);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'Dynamic import failed, retrying... (2 attempts left)'
      );
      expect(result).toEqual({ default: 'test-module' });
    });
    
    it('should throw an error after exhausting retries', async () => {
      const mockError = new Error('Import failed');
      const mockImportFn = vi.fn().mockRejectedValue(mockError);
      
      await expect(dynamicImport(mockImportFn, 2, 10)).rejects.toThrow(mockError);
      expect(mockImportFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });
  
  describe('IntelligentPrefetcher', () => {
    let prefetcher: IntelligentPrefetcher;
    
    beforeEach(() => {
      prefetcher = new IntelligentPrefetcher(defaultCodeSplitConfig);
    });
    
    it('should initialize with the provided config', () => {
      expect(prefetcher).toBeDefined();
      expect(mockIntersectionObserver).toHaveBeenCalled();
    });
    
    it('should observe DOM elements for viewport-based loading', () => {
      const mockElement = document.createElement('div');
      
      prefetcher.observeComponent(mockElement, 'TestComponent');
      
      expect(mockElement.getAttribute('data-component')).toBe('TestComponent');
      expect(mockObserve).toHaveBeenCalledWith(mockElement);
    });
    
    it('should prefetch components based on configuration', () => {
      // Mock private methods since we can't spy on them directly
      (prefetcher as any).prefetchedModules = new Set();
      
      prefetcher.prefetchComponent('GameBoard');
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Prefetching component: GameBoard');
    });
    
    it('should track user interactions', () => {
      const mockEvent = {
        target: document.createElement('button')
      };
      mockEvent.target.setAttribute('data-route', '/game/poker-texas-holdem');
      
      // Trigger the event handler directly since we can't easily trigger DOM events
      (prefetcher as any).handleUserInteraction(mockEvent as any);
      
      // This would normally update interaction patterns and potentially trigger prefetching
      expect((prefetcher as any).userInteractionPatterns['/game/poker-texas-holdem']).toBe(1);
    });
    
    it('should clean up resources on cleanup', () => {
      prefetcher.cleanup();
      
      expect(mockDisconnect).toHaveBeenCalled();
      expect(window.removeEventListener).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('getPrefetcher', () => {
    it('should return a singleton instance', () => {
      const prefetcher1 = getPrefetcher();
      const prefetcher2 = getPrefetcher();
      
      expect(prefetcher1).toBe(prefetcher2);
    });
  });
});
