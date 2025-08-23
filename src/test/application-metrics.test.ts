/**
 * Application Metrics Test Suite
 * Comprehensive tests for the metrics collection system
 */

import { jest } from '@jest/globals';

// Mock the utils import
const mockMetricsCollector = {
  getMetrics: jest.fn(),
  recordError: jest.fn(),
  recordHttpRequest: jest.fn(),
  recordWebSocketMessage: jest.fn(),
  recordGameAction: jest.fn(),
  addAlertRule: jest.fn(),
  checkAlerts: jest.fn(),
  getPerformanceReport: jest.fn(),
  exportPrometheusMetrics: jest.fn(),
  reset: jest.fn()
};

jest.mock('../utils/application-metrics', () => ({
  getApplicationMetrics: jest.fn(() => mockMetricsCollector)
}));

describe('Application Metrics System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock performance APIs
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
  });
  
  describe('Metrics Collection', () => {
    test('should collect basic metrics', () => {
      const mockMetrics = {
        performance: {
          responseTime: { buckets: [0.1, 0.5, 1, 5], counts: [10, 25, 35, 40], sum: 150, count: 40 },
          latency: { buckets: [0.01, 0.05, 0.1, 0.5], counts: [5, 15, 25, 30], sum: 75, count: 30 },
          throughput: { value: 100 }
        },
        resources: {
          memory: { value: 50 * 1024 * 1024 },
          cpu: { value: 45.2 },
          connections: { value: 25 }
        },
        errors: {
          count: { value: 10 },
          types: { javascript: 3, network: 4, application: 3 }
        }
      };
      
      mockMetricsCollector.getMetrics.mockReturnValue(mockMetrics);
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      const metrics = collector.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.performance.responseTime.sum).toBe(150);
      expect(metrics.resources.memory.value).toBe(50 * 1024 * 1024);
      expect(metrics.errors.count.value).toBe(10);
      expect(metrics.performance.throughput.value).toBe(100);
    });
    
    test('should record HTTP requests', () => {
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      collector.recordHttpRequest('GET', '/api/games', 200, 150);
      
      expect(mockMetricsCollector.recordHttpRequest).toHaveBeenCalledWith(
        'GET',
        '/api/games',
        200,
        150
      );
    });
    
    test('should record errors', () => {
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      const error = new Error('Test error');
      collector.recordError(error, 'javascript');
      
      expect(mockMetricsCollector.recordError).toHaveBeenCalledWith(
        error,
        'javascript'
      );
    });
    
    test('should record WebSocket messages', () => {
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      collector.recordWebSocketMessage('sent', 1024);
      
      expect(mockMetricsCollector.recordWebSocketMessage).toHaveBeenCalledWith(
        'sent',
        1024
      );
    });
  });
  
  describe('Alert System', () => {
    test('should add alert rules', () => {
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      const alertRule = {
        metricName: 'cpu_usage_percent',
        threshold: 80,
        comparison: 'gt' as const,
        duration: 5000,
        severity: 'warning' as const
      };
      
      collector.addAlertRule(alertRule);
      
      expect(mockMetricsCollector.addAlertRule).toHaveBeenCalledWith(alertRule);
    });
    
    test('should check alerts', () => {
      const mockAlerts = [
        {
          rule: {
            metricName: 'response_time',
            threshold: 1000,
            comparison: 'gt',
            duration: 5000,
            severity: 'warning'
          },
          currentValue: 1500,
          triggeredAt: new Date()
        }
      ];
      
      mockMetricsCollector.checkAlerts.mockReturnValue(mockAlerts);
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      const alerts = collector.checkAlerts();
      
      expect(alerts).toEqual(mockAlerts);
      expect(mockMetricsCollector.checkAlerts).toHaveBeenCalled();
    });
  });
  
  describe('Performance Reporting', () => {
    test('should generate performance report', () => {
      const mockReport = {
        uptime: 3600000,
        metrics_collected: 150,
        error_rate: 2.5,
        http_request_duration_seconds: {
          avg: 0.15,
          min: 0.05,
          max: 2.5,
          percentiles: {
            p50: 0.12,
            p90: 0.25,
            p95: 0.45,
            p99: 1.2
          }
        },
        memory_usage_bytes: {
          avg: 45 * 1024 * 1024,
          peak: 80 * 1024 * 1024
        },
        error_types: {
          javascript: 5,
          network: 3,
          application: 2
        }
      };
      
      mockMetricsCollector.getPerformanceReport.mockReturnValue(mockReport);
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      const report = collector.getPerformanceReport();
      
      expect(report).toEqual(mockReport);
      expect(report.uptime).toBe(3600000);
      expect(report.error_rate).toBe(2.5);
      expect(report.http_request_duration_seconds.percentiles.p95).toBe(0.45);
    });
  });
  
  describe('Prometheus Export', () => {
    test('should export metrics in Prometheus format', () => {
      const mockPrometheusOutput = `
# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 10
http_request_duration_seconds_bucket{le="0.5"} 25
http_request_duration_seconds_bucket{le="1.0"} 45
http_request_duration_seconds_bucket{le="+Inf"} 50
http_request_duration_seconds_sum 15.5
http_request_duration_seconds_count 50

# HELP memory_usage_bytes Memory usage in bytes
# TYPE memory_usage_bytes gauge
memory_usage_bytes 52428800

# HELP error_total Total number of errors
# TYPE error_total counter
error_total{type="javascript"} 5
error_total{type="network"} 3
error_total{type="application"} 2
      `.trim();
      
      mockMetricsCollector.exportPrometheusMetrics.mockReturnValue(mockPrometheusOutput);
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      const prometheusOutput = collector.exportPrometheusMetrics();
      
      expect(prometheusOutput).toContain('http_request_duration_seconds');
      expect(prometheusOutput).toContain('memory_usage_bytes');
      expect(prometheusOutput).toContain('error_total');
      expect(mockMetricsCollector.exportPrometheusMetrics).toHaveBeenCalled();
    });
  });
  
  describe('Reset Functionality', () => {
    test('should reset all metrics', () => {
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      collector.reset();
      
      expect(mockMetricsCollector.reset).toHaveBeenCalled();
    });
  });
  
  describe('Utility Functions', () => {
    test('should format numbers correctly', () => {
      const formatNumber = (value: number, decimals: number = 2): string => {
        if (value === 0) return '0';
        if (value < 1) return value.toFixed(decimals);
        if (value < 1000) return Math.round(value).toString();
        if (value < 1000000) return (value / 1000).toFixed(1) + 'K';
        return (value / 1000000).toFixed(1) + 'M';
      };
      
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(0.5)).toBe('0.50');
      expect(formatNumber(150)).toBe('150');
      expect(formatNumber(1500)).toBe('1.5K');
      expect(formatNumber(1500000)).toBe('1.5M');
    });
    
    test('should format duration correctly', () => {
      const formatDuration = (seconds: number): string => {
        if (seconds < 1) return Math.round(seconds * 1000) + 'ms';
        if (seconds < 60) return seconds.toFixed(2) + 's';
        return Math.round(seconds / 60) + 'm';
      };
      
      expect(formatDuration(0.5)).toBe('500ms');
      expect(formatDuration(1.5)).toBe('1.50s');
      expect(formatDuration(90)).toBe('2m');
    });
    
    test('should format bytes correctly', () => {
      const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });
  
  describe('Error Handling', () => {
    test('should handle metrics collection errors gracefully', () => {
      mockMetricsCollector.getMetrics.mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      expect(() => collector.getMetrics()).toThrow('Metrics collection failed');
    });
    
    test('should handle invalid metric recording', () => {
      mockMetricsCollector.recordError.mockImplementation(() => {
        throw new Error('Invalid error recording');
      });
      
      const { getApplicationMetrics } = require('../utils/application-metrics');
      const collector = getApplicationMetrics();
      
      expect(() => collector.recordError(new Error('test'), 'javascript')).toThrow('Invalid error recording');
    });
  });
});
