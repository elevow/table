import { PerformanceMonitor } from '../performance-monitor';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = PerformanceMonitor.getInstance();
  });

  describe('Action Latency Tracking', () => {
    it('should track action processing time', () => {
      jest.useFakeTimers();
      const actionId = 'test-action';
      
      monitor.startActionTracking(actionId);
      jest.advanceTimersByTime(50); // Simulate 50ms processing time
      monitor.endActionTracking(actionId);

      const metrics = monitor.getMetrics();
      expect(metrics.actionLatency).toBeGreaterThan(0);
      expect(metrics.actionLatency).toBeLessThanOrEqual(100);

      jest.useRealTimers();
    });
  });

  describe('State Update Latency Tracking', () => {
    it('should track state update time', () => {
      jest.useFakeTimers();
      const updateId = 'test-update';
      
      monitor.startStateUpdateTracking(updateId);
      jest.advanceTimersByTime(25); // Simulate 25ms sync time
      monitor.endStateUpdateTracking(updateId);

      const metrics = monitor.getMetrics();
      expect(metrics.stateUpdateLatency).toBeGreaterThan(0);
      expect(metrics.stateUpdateLatency).toBeLessThanOrEqual(50);

      jest.useRealTimers();
    });
  });

  describe('Message Queue Tracking', () => {
    it('should track message queue length', () => {
      monitor.trackMessageQueue(5);
      const metrics = monitor.getMetrics();
      expect(metrics.messageQueueLength).toBe(5);
    });
  });

  describe('FPS Tracking', () => {
    it('should track client FPS', () => {
      jest.useFakeTimers();
      
      // Simulate 60 frames at 60fps
      for (let i = 0; i < 60; i++) {
        monitor.updateFPS();
        jest.advanceTimersByTime(16.67); // ~60fps
      }

      const metrics = monitor.getMetrics();
      expect(metrics.clientFPS).toBeGreaterThan(55); // Allow some variance
      expect(metrics.clientFPS).toBeLessThanOrEqual(60);

      jest.useRealTimers();
    });
  });

  describe('Performance Thresholds', () => {
    it('should validate performance thresholds', () => {
      // Set up good performance metrics
      monitor.trackMessageQueue(5);
      
      jest.useFakeTimers();
      
      // Simulate fast action
      monitor.startActionTracking('test-action');
      jest.advanceTimersByTime(50);
      monitor.endActionTracking('test-action');

      // Simulate fast state update
      monitor.startStateUpdateTracking('test-update');
      jest.advanceTimersByTime(25);
      monitor.endStateUpdateTracking('test-update');

      // Simulate good FPS
      for (let i = 0; i < 60; i++) {
        monitor.updateFPS();
        jest.advanceTimersByTime(16.67);
      }

      expect(monitor.checkPerformanceThresholds()).toBe(true);

      jest.useRealTimers();
    });

    it('should detect performance issues', () => {
      // Set up poor performance metrics
      monitor.trackMessageQueue(150); // Too many pending messages
      
      jest.useFakeTimers();
      
      // Simulate slow action
      monitor.startActionTracking('test-action');
      jest.advanceTimersByTime(150);
      monitor.endActionTracking('test-action');

      // Simulate slow state update
      monitor.startStateUpdateTracking('test-update');
      jest.advanceTimersByTime(75);
      monitor.endStateUpdateTracking('test-update');

      // Simulate poor FPS
      for (let i = 0; i < 60; i++) {
        monitor.updateFPS();
        jest.advanceTimersByTime(33.33); // ~30fps
      }

      expect(monitor.checkPerformanceThresholds()).toBe(false);

      jest.useRealTimers();
    });
  });
});
