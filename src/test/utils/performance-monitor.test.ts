import { getPerformanceMonitor, useComponentPerformance } from '../../utils/performance-monitor';
import { renderHook, act } from '@testing-library/react';

// Mock performance API
global.performance = {
  now: jest.fn().mockReturnValue(100),
  mark: jest.fn(),
  measure: jest.fn(),
  getEntriesByType: jest.fn().mockReturnValue([]),
  getEntriesByName: jest.fn().mockReturnValue([]),
  clearMarks: jest.fn(),
  clearMeasures: jest.fn(),
} as unknown as Performance;

// Mock PerformanceObserver
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();
global.PerformanceObserver = jest.fn().mockImplementation(() => ({
  observe: mockObserve,
  disconnect: mockDisconnect,
  takeRecords: jest.fn()
})) as unknown as typeof PerformanceObserver;

describe('Performance Monitoring', () => {
  const originalConsole = { ...console };
  
  beforeEach(() => {
    jest.resetAllMocks();
    // console.log = jest.fn();
    console.error = jest.fn();
    
    // Mock setTimeout
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    // console.log = original// console.log;
    console.error = originalConsole.error;
    jest.useRealTimers();
  });
  
  describe('getPerformanceMonitor', () => {
    test('returns singleton instance', () => {
      const monitor1 = getPerformanceMonitor();
      const monitor2 = getPerformanceMonitor();
      
      expect(monitor1).toBe(monitor2);
    });
    
    test('sets up performance observers', () => {
      getPerformanceMonitor();
      
      expect(global.PerformanceObserver).toHaveBeenCalledTimes(3);
      expect(mockObserve).toHaveBeenCalledTimes(3);
    });
  });
  
  describe('Performance Monitor', () => {
    test('starts and ends marks correctly', () => {
      const monitor = getPerformanceMonitor();
      
      (performance.now as jest.Mock).mockReturnValueOnce(100);
      monitor.startMark('test-mark');
      
      (performance.now as jest.Mock).mockReturnValueOnce(200);
      monitor.endMark('test-mark');
      
      // Advance timers to trigger the flush
      jest.advanceTimersByTime(10000);
      
      expect(// console.log).toHaveBeenCalledWith(
        expect.stringContaining('Performance metric: test-mark')
      );
    });
  });
  
  describe('useComponentPerformance', () => {
    test('provides marking functionality for components', () => {
      const { result } = renderHook(() => useComponentPerformance('TestComponent'));
      
      // It should create a start mark
      expect(performance.now).toHaveBeenCalled();
      
      // Test interaction marking
      const markInteraction = result.current.markInteraction;
      const endMark = markInteraction('click');
      
      // If endMark is a function, call it
      if (typeof endMark === 'function') {
        jest.advanceTimersByTime(50);
        endMark();
      }
      
      // Advance timer to complete the component render marking
      jest.advanceTimersByTime(10);
      
      // Check marks were completed
      expect(performance.now).toHaveBeenCalledTimes(4);
    });
  });
});
