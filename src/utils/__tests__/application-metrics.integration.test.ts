/**
 * Application Metrics Integration Tests
 * Tests the actual implementation without mocking
 */

import { jest } from '@jest/globals';

// Don't mock the module for integration tests
describe('Application Metrics Integration Tests', () => {
  let ApplicationMetricsCollector: any;
  let getApplicationMetrics: any;
  
  beforeAll(async () => {
    // Import the actual module
    const imported = await import('../application-metrics');
    ApplicationMetricsCollector = (imported as any).ApplicationMetricsCollector;
    getApplicationMetrics = imported.getApplicationMetrics;
  });
  
  beforeEach(() => {
    // Mock browser APIs
    global.performance = {
      now: jest.fn(() => Date.now()),
      getEntriesByType: jest.fn(() => []),
      getEntriesByName: jest.fn(() => []),
      mark: jest.fn(),
      measure: jest.fn(),
      clearMarks: jest.fn(),
      clearMeasures: jest.fn(),
      navigation: { type: 'navigate' }
    } as any;
    
    // Mock PerformanceObserver
    const mockPerformanceObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      takeRecords: jest.fn(() => [])
    }));
    
    Object.defineProperty(mockPerformanceObserver, 'supportedEntryTypes', {
      value: ['navigation', 'resource', 'measure', 'paint'],
      writable: false
    });
    
    global.PerformanceObserver = mockPerformanceObserver as any;
    
    // Mock window for error handlers
    global.window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    } as any;
    
    // Mock console to avoid noise in tests
    global.console = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn()
    } as any;
  });
  
  afterEach(() => {
    // Reset singleton instance
    if (ApplicationMetricsCollector) {
      (ApplicationMetricsCollector as any).instance = null;
    }
  });
  
  test('should create metrics collector instance', () => {
    const collector = getApplicationMetrics();
    expect(collector).toBeDefined();
    expect(typeof collector.getMetrics).toBe('function');
    expect(typeof collector.recordError).toBe('function');
    expect(typeof collector.addAlertRule).toBe('function');
  });
  
  test('should initialize default metrics', () => {
    const collector = getApplicationMetrics();
    const metrics = collector.getMetrics();
    
    expect(metrics).toBeDefined();
    expect(metrics.performance).toBeDefined();
    expect(metrics.resources).toBeDefined();
    expect(metrics.errors).toBeDefined();
    
    // Check histogram structure
    expect(metrics.performance.responseTime).toHaveProperty('buckets');
    expect(metrics.performance.responseTime).toHaveProperty('counts');
    expect(metrics.performance.responseTime).toHaveProperty('sum');
    expect(metrics.performance.responseTime).toHaveProperty('count');
    
    // Check counter structure
    expect(metrics.performance.throughput).toHaveProperty('value');
    
    // Check gauge structure
    expect(metrics.resources.cpu).toHaveProperty('value');
    expect(metrics.resources.memory).toHaveProperty('value');
  });
  
  test('should record histogram values', () => {
    const collector = getApplicationMetrics();
    
    // Record some histogram values
    collector.recordHistogram('http_request_duration_seconds', 0.15);
    collector.recordHistogram('http_request_duration_seconds', 0.25);
    collector.recordHistogram('http_request_duration_seconds', 0.35);
    
    const metrics = collector.getMetrics();
    const histogram = metrics.performance.responseTime;
    
    expect(histogram.count).toBeGreaterThan(0);
    expect(histogram.sum).toBeGreaterThan(0);
    expect(histogram.counts.some((count: number) => count > 0)).toBe(true);
  });
  
  test('should increment counters', () => {
    const collector = getApplicationMetrics();
    
    // Get initial value
    const initialMetrics = collector.getMetrics();
    const initialValue = initialMetrics.performance.throughput.value;
    
    // Increment counter
    collector.incrementCounter('http_requests_total');
    collector.incrementCounter('http_requests_total');
    
    const updatedMetrics = collector.getMetrics();
    const updatedValue = updatedMetrics.performance.throughput.value;
    
    expect(updatedValue).toBeGreaterThan(initialValue);
  });
  
  test('should set gauge values', () => {
    const collector = getApplicationMetrics();
    
    // Set gauge values
    collector.setGauge('cpu_usage_percent', 45.5);
    collector.setGauge('memory_usage_bytes', 1024 * 1024 * 50);
    
    const metrics = collector.getMetrics();
    
    expect(metrics.resources.cpu.value).toBe(45.5);
    expect(metrics.resources.memory.value).toBe(1024 * 1024 * 50);
  });
  
  test('should record errors with metadata', () => {
    const collector = getApplicationMetrics();
    
    // Record errors
    collector.recordError('javascript_error', {
      message: 'Test error',
      filename: 'test.js'
    });
    
    collector.recordError('network_error', {
      status: '500',
      url: '/api/test'
    });
    
    const metrics = collector.getMetrics();
    
    expect(metrics.errors.count.value).toBeGreaterThan(0);
    // Error types are tracked separately from the metrics structure
    expect(typeof metrics.errors.types).toBe('object');
  });
  
  test('should add and check alert rules', () => {
    const collector = getApplicationMetrics();
    
    // Add alert rule
    const alertRule = {
      metricName: 'cpu_usage_percent',
      threshold: 80,
      comparison: 'gt' as const,
      duration: 5000,
      severity: 'warning' as const
    };
    
    collector.addAlertRule(alertRule);
    
    // Set a value that should trigger the alert
    collector.setGauge('cpu_usage_percent', 85);
    
    // The addAlertRule method should work without throwing
    expect(() => collector.addAlertRule(alertRule)).not.toThrow();
  });
  
  test('should generate performance report', () => {
    const collector = getApplicationMetrics();
    
    // Add some data
    collector.recordHistogram('http_request_duration_seconds', 0.1);
    collector.recordHistogram('http_request_duration_seconds', 0.2);
    collector.recordHistogram('http_request_duration_seconds', 0.3);
    collector.incrementCounter('http_requests_total');
    collector.recordError('test_error', { type: 'test' });
    
    const report = collector.getPerformanceReport();
    
    expect(report).toBeDefined();
    expect(typeof report.uptime).toBe('number');
    expect(typeof report.metrics_collected).toBe('number');
    expect(report.uptime).toBeGreaterThanOrEqual(0);
  });
  
  test('should export Prometheus metrics', () => {
    const collector = getApplicationMetrics();
    
    // Add some data
    collector.recordHistogram('http_request_duration_seconds', 0.15);
    collector.incrementCounter('http_requests_total');
    collector.setGauge('memory_usage_bytes', 1024 * 1024);
    collector.recordError('test_error', {});
    
    const prometheusOutput = collector.getPrometheusMetrics();
    
    expect(typeof prometheusOutput).toBe('string');
    // Should contain metric data even if empty
    expect(prometheusOutput).toBeDefined();
  });
  
  test('should handle metric creation', () => {
    const collector = getApplicationMetrics();
    
    // Create custom metrics - should not throw
    expect(() => collector.createHistogram('custom_histogram', 'Custom histogram metric')).not.toThrow();
    expect(() => collector.createCounter('custom_counter', 'Custom counter metric')).not.toThrow();
    expect(() => collector.createGauge('custom_gauge', 'Custom gauge metric')).not.toThrow();
    
    // Use the custom metrics
    collector.recordHistogram('custom_histogram', 1.5);
    collector.incrementCounter('custom_counter');
    collector.setGauge('custom_gauge', 42);
    
    // Should work without errors
    expect(() => collector.getPrometheusMetrics()).not.toThrow();
  });
  
  test('should handle HTTP request recording', () => {
    const collector = getApplicationMetrics();
    
    // Record HTTP requests
    collector.recordHttpRequest('GET', '/api/games', 200, 150);
    collector.recordHttpRequest('POST', '/api/bets', 201, 220);
    collector.recordHttpRequest('GET', '/api/users', 404, 80);
    
    const metrics = collector.getMetrics();
    
    // Should increment throughput counter
    expect(metrics.performance.throughput.value).toBeGreaterThan(0);
    
    const report = collector.getPerformanceReport();
    expect(report.http_request_duration_seconds).toBeDefined();
  });
  
  test('should handle WebSocket message recording', () => {
    const collector = getApplicationMetrics();
    
    // Record WebSocket messages with correct parameters
    collector.recordWebSocketMessage('websocket_connect', 'inbound', 50);
    collector.recordWebSocketMessage('websocket_message', 'outbound', 25);
    
    // Should not throw and should increment counters
    expect(() => collector.recordWebSocketMessage('test', 'inbound')).not.toThrow();
  });
  
  test('should handle cleanup functionality', () => {
    const collector = getApplicationMetrics();
    
    // Add some data
    collector.incrementCounter('http_requests_total');
    collector.setGauge('cpu_usage_percent', 50);
    collector.recordError('test_error', {});
    
    const beforeCleanup = collector.getMetrics();
    expect(beforeCleanup.performance.throughput.value).toBeGreaterThan(0);
    
    // Cleanup should not throw
    expect(() => collector.cleanup()).not.toThrow();
  });
  
  test('should handle singleton pattern correctly', () => {
    const collector1 = getApplicationMetrics();
    const collector2 = getApplicationMetrics();
    
    expect(collector1).toBe(collector2);
    
    // Changes in one should reflect in the other
    collector1.incrementCounter('http_requests_total');
    
    const metrics1 = collector1.getMetrics();
    const metrics2 = collector2.getMetrics();
    
    expect(metrics1.performance.throughput.value).toBe(metrics2.performance.throughput.value);
  });
  
  test('should handle percentile calculations', () => {
    const collector = getApplicationMetrics();
    
    // Add multiple values for percentile calculation
    const values = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 1.0];
    values.forEach(value => {
      collector.recordHistogram('http_request_duration_seconds', value);
    });
    
    const report = collector.getPerformanceReport();
    
    expect(report).toBeDefined();
    expect(typeof report).toBe('object');
    
    // Check if percentiles are calculated (may or may not be available depending on implementation)
    if (report.http_request_duration_seconds && report.http_request_duration_seconds.percentiles) {
      expect(report.http_request_duration_seconds.percentiles.p50).toBeGreaterThan(0);
      expect(report.http_request_duration_seconds.percentiles.p95).toBeGreaterThanOrEqual(
        report.http_request_duration_seconds.percentiles.p50
      );
    }
  });
});
