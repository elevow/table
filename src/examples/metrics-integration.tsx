/**
 * Application Metrics Integration Example
 * Demonstrates how to integrate the metrics system into your application
 */

import React, { useEffect } from 'react';
import { getApplicationMetrics, recordError } from '../utils/application-metrics';
import { MetricsDashboard, useApplicationMetrics } from '../components/MetricsDashboard';

// Initialize metrics collector early in your application
const metricsCollector = getApplicationMetrics();

// Example: Game Component with Metrics Integration
export const PokerGameWithMetrics: React.FC = () => {
  const { metrics } = useApplicationMetrics();
  
  useEffect(() => {
    // Set up performance monitoring
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'navigation') {
          metricsCollector.recordHttpRequest(
            'GET',
            window.location.pathname,
            200,
            entry.duration
          );
        }
      }
    });
    
    observer.observe({ entryTypes: ['navigation'] });
    
    // Set up error boundaries
    const handleError = (error: ErrorEvent) => {
      recordError('javascript_error', {
        message: error.message,
        filename: error.filename || '',
        lineno: error.lineno?.toString() || '',
        colno: error.colno?.toString() || ''
      });
    };
    
    window.addEventListener('error', handleError);
    
    return () => {
      observer.disconnect();
      window.removeEventListener('error', handleError);
    };
  }, []);
  
  const handleBet = async (amount: number) => {
    const startTime = performance.now();
    
    try {
      // Example API call
      const response = await fetch('/api/game/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      
      const duration = performance.now() - startTime;
      
      // Record HTTP request metrics
      metricsCollector.recordHttpRequest('POST', '/api/game/bet', response.status, duration);
      
      if (!response.ok) {
        throw new Error(`Bet failed: ${response.statusText}`);
      }
      
      // Record game action
      metricsCollector.incrementCounter('game_actions_total', {
        action: 'bet',
        game: 'poker',
        amount: amount.toString()
      });
      
    } catch (error) {
      // Record error
      recordError('network_error', {
        message: (error as Error).message,
        endpoint: '/api/game/bet'
      });
      throw error;
    }
  };
  
  return (
    <div className="poker-game">
      <h1>Poker Game</h1>
      <button onClick={() => handleBet(10)}>
        Bet $10
      </button>
      
      {/* Include metrics dashboard */}
      <MetricsDashboard 
        refreshInterval={5000}
        showAlerts={true}
        className="mt-8"
      />
    </div>
  );
};

// Example: API Service with Metrics
export class ApiServiceWithMetrics {
  private baseUrl: string;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }
  
  async request<T>(
    method: string,
    endpoint: string,
    data?: any
  ): Promise<T> {
    const startTime = performance.now();
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      
      const duration = performance.now() - startTime;
      
      // Record HTTP request metrics
      metricsCollector.recordHttpRequest(method, endpoint, response.status, duration);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      const duration = performance.now() - startTime;
      
      // Record error metrics
      metricsCollector.recordHttpRequest(method, endpoint, 0, duration);
      recordError('network_error', {
        message: (error as Error).message,
        method,
        endpoint,
        url
      });
      
      throw error;
    }
  }
}

// Example: WebSocket Service with Metrics
export class WebSocketServiceWithMetrics {
  private ws: WebSocket | null = null;
  
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
        
        this.ws.onopen = () => {
          metricsCollector.incrementCounter('websocket_messages_total', {
            direction: 'outbound',
            type: 'connection'
          });
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          const messageSize = new Blob([event.data]).size;
          metricsCollector.incrementCounter('websocket_messages_total', {
            direction: 'inbound',
            type: 'data'
          });
          metricsCollector.recordHistogram('websocket_message_size_bytes', messageSize);
        };
        
        this.ws.onerror = (error) => {
          recordError('websocket_error', {
            message: 'WebSocket connection error',
            url
          });
          reject(error);
        };
        
        this.ws.onclose = () => {
          metricsCollector.incrementCounter('websocket_messages_total', {
            direction: 'outbound',
            type: 'disconnection'
          });
        };
        
      } catch (error) {
        recordError('websocket_error', {
          message: (error as Error).message,
          url
        });
        reject(error);
      }
    });
  }
  
  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify(data);
      const messageSize = new Blob([message]).size;
      
      this.ws.send(message);
      metricsCollector.incrementCounter('websocket_messages_total', {
        direction: 'outbound',
        type: 'data'
      });
      metricsCollector.recordHistogram('websocket_message_size_bytes', messageSize);
    }
  }
}

// Example: Setting up Alert Rules
export const setupApplicationAlerts = () => {
  // CPU usage alert
  metricsCollector.addAlertRule({
    metricName: 'cpu_usage_percent',
    threshold: 80,
    comparison: 'gt',
    duration: 30000, // 30 seconds
    severity: 'warning'
  });
  
  // Memory usage alert
  metricsCollector.addAlertRule({
    metricName: 'memory_usage_bytes',
    threshold: 512 * 1024 * 1024, // 512MB
    comparison: 'gt',
    duration: 60000, // 1 minute
    severity: 'critical'
  });
  
  // Response time alert
  metricsCollector.addAlertRule({
    metricName: 'http_request_duration_seconds',
    threshold: 2, // 2 seconds
    comparison: 'gt',
    duration: 30000, // 30 seconds
    severity: 'warning'
  });
};

// Example: Metrics Export for Monitoring Systems
export const exportMetricsToPrometheus = async () => {
  try {
    const prometheusMetrics = metricsCollector.getPrometheusMetrics();
    
    // Send to monitoring system
    await fetch('/metrics/prometheus', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: prometheusMetrics
    });
    
  } catch (error) {
    console.error('Failed to export metrics:', error);
    recordError('application_error', {
      message: (error as Error).message,
      operation: 'export_metrics'
    });
  }
};

// Example: Application Initialization with Metrics
export const initializeApplicationWithMetrics = async () => {
  try {
    // Initialize metrics collection
    const metrics = getApplicationMetrics();
    
    // Set up alert rules
    setupApplicationAlerts();
    
    // Set up periodic metrics export (every 30 seconds)
    setInterval(exportMetricsToPrometheus, 30000);
    
    // Set up performance monitoring
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') {
            metrics.recordHistogram('largest_contentful_paint_seconds', entry.startTime / 1000);
          }
        }
      });
      
      observer.observe({ entryTypes: ['largest-contentful-paint'] });
    }
    
    // Monitor memory usage
    if ('memory' in performance) {
      setInterval(() => {
        const memInfo = (performance as any).memory;
        metrics.setGauge('memory_usage_bytes', memInfo.usedJSHeapSize);
      }, 5000);
    }
    
    // console.log('Application metrics initialized successfully');
    
  } catch (error) {
    console.error('Failed to initialize metrics:', error);
  }
};

// Export the main integration points
export {
  metricsCollector as ApplicationMetrics,
  MetricsDashboard,
  useApplicationMetrics
};
