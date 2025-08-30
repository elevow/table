/**
 * Comprehensive Application Metrics System - US-041 Implementation
 * Provides Prometheus-style metrics collection with histograms, counters, gauges
 * Includes performance monitoring, error tracking, and resource utilization
 */

// Core metric types based on Prometheus patterns
export interface Histogram {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface Counter {
  value: number;
  labels?: Record<string, string>;
}

export interface Gauge {
  value: number;
  labels?: Record<string, string>;
}

// Application metrics interface from user story
export interface ApplicationMetrics {
  performance: {
    responseTime: Histogram;
    latency: Histogram;
    throughput: Counter;
  };
  resources: {
    cpu: Gauge;
    memory: Gauge;
    connections: Gauge;
  };
  errors: {
    count: Counter;
    types: Record<string, number>;
  };
}

// Extended metrics for comprehensive monitoring
export type MetricValue =
  | { timestamp: number; labels: Record<string, string>; value: number }
  | { timestamp: number; labels: Record<string, string>; increment: number };

// Specific metric value helpers can be derived from MetricValue union when needed.

// Metric collection configuration
export interface MetricsConfig {
  enableCollection: boolean;
  sampleRate: number;
  flushInterval: number;
  histogramBuckets: number[];
  maxMetricsRetention: number;
  exportEndpoint?: string;
}

// Alert configuration
export interface AlertRule {
  metricName: string;
  threshold: number;
  comparison: 'gt' | 'lt' | 'eq';
  duration: number; // ms
  severity: 'critical' | 'warning' | 'info';
}

class ApplicationMetricsCollector {
  private static instance: ApplicationMetricsCollector;
  
  private histograms: Map<string, Histogram> = new Map();
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  
  private config: MetricsConfig;
  private flushTimer: NodeJS.Timeout | null = null;
  private alertRules: AlertRule[] = [];
  private metricHistory: Map<string, MetricValue[]> = new Map();
  
  // Performance observers
  private performanceObserver: PerformanceObserver | null = null;
  private resourceObserver: PerformanceObserver | null = null;
  
  // Error tracking
  private errorCounts: Map<string, number> = new Map();
  private lastErrorFlush = Date.now();
  
  // Resource monitoring
  private lastCpuCheck = 0;
  private cpuUsageHistory: number[] = [];
  
  private constructor(config: Partial<MetricsConfig> = {}) {
    this.config = {
      enableCollection: true,
      sampleRate: 1.0,
      flushInterval: 10000, // 10 seconds
      histogramBuckets: [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000],
      maxMetricsRetention: 1000,
      ...config
    };
    
    this.initializeDefaultMetrics();
    this.setupPerformanceMonitoring();
    this.setupErrorTracking();
    this.startFlushTimer();
  }
  
  public static getInstance(config?: Partial<MetricsConfig>): ApplicationMetricsCollector {
    if (!ApplicationMetricsCollector.instance) {
      ApplicationMetricsCollector.instance = new ApplicationMetricsCollector(config);
    }
    return ApplicationMetricsCollector.instance;
  }
  
  private initializeDefaultMetrics(): void {
    // Initialize core performance metrics
    this.createHistogram('http_request_duration_seconds', 'HTTP request duration in seconds');
    this.createHistogram('websocket_message_latency_seconds', 'WebSocket message latency in seconds');
    this.createHistogram('component_render_duration_seconds', 'Component render duration in seconds');
    
    // Initialize counters
    this.createCounter('http_requests_total', 'Total HTTP requests');
    this.createCounter('websocket_messages_total', 'Total WebSocket messages');
    this.createCounter('errors_total', 'Total errors');
    this.createCounter('game_actions_total', 'Total game actions');
    
    // Initialize gauges
    this.createGauge('active_connections', 'Number of active connections');
    this.createGauge('memory_usage_bytes', 'Memory usage in bytes');
    this.createGauge('cpu_usage_percent', 'CPU usage percentage');
    this.createGauge('active_games', 'Number of active games');
    this.createGauge('active_players', 'Number of active players');
  }
  
  private setupPerformanceMonitoring(): void {
    if (typeof window === 'undefined') return;
    
    try {
      // Monitor navigation and resource timing
      this.performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.handlePerformanceEntry(entry);
        }
      });
      
      this.performanceObserver.observe({
        entryTypes: ['navigation', 'measure', 'paint', 'largest-contentful-paint']
      });
      
      // Monitor resource loading
      this.resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordResourceTiming(entry as PerformanceResourceTiming);
        }
      });
      
      this.resourceObserver.observe({ entryTypes: ['resource'] });
      
      // Monitor memory usage if available
      if ('memory' in performance) {
        setInterval(() => {
          this.updateMemoryMetrics();
        }, 5000);
      }
      
    } catch (error) {
      console.warn('Performance monitoring setup failed:', error);
    }
  }
  
  private setupErrorTracking(): void {
    if (typeof window === 'undefined') return;
    
    // Global error handler
    window.addEventListener('error', (event) => {
      this.recordError('javascript_error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno?.toString(),
        colno: event.colno?.toString()
      });
    });
    
    // Promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
      this.recordError('unhandled_promise_rejection', {
        reason: event.reason?.toString() || 'Unknown'
      });
    });
  }
  
  private handlePerformanceEntry(entry: PerformanceEntry): void {
    switch (entry.entryType) {
      case 'navigation':
        this.recordNavigationTiming(entry as PerformanceNavigationTiming);
        break;
      case 'paint':
        this.recordPaintTiming(entry);
        break;
      case 'largest-contentful-paint':
        this.recordHistogram('largest_contentful_paint_seconds', entry.startTime / 1000);
        break;
      case 'measure':
        this.recordHistogram('custom_measure_seconds', entry.duration / 1000, {
          name: entry.name
        });
        break;
    }
  }
  
  private recordNavigationTiming(entry: PerformanceNavigationTiming): void {
    // Record various navigation timing metrics
    this.recordHistogram('page_load_duration_seconds', entry.loadEventEnd / 1000);
    this.recordHistogram('dom_content_loaded_seconds', entry.domContentLoadedEventEnd / 1000);
    this.recordHistogram('first_byte_time_seconds', entry.responseStart / 1000);
    
    // DNS and connection timing
    if (entry.domainLookupEnd > entry.domainLookupStart) {
      this.recordHistogram('dns_lookup_duration_seconds', 
        (entry.domainLookupEnd - entry.domainLookupStart) / 1000);
    }
    
    if (entry.connectEnd > entry.connectStart) {
      this.recordHistogram('connection_duration_seconds',
        (entry.connectEnd - entry.connectStart) / 1000);
    }
  }
  
  private recordPaintTiming(entry: PerformanceEntry): void {
    const metricName = entry.name.replace('-', '_') + '_seconds';
    this.recordHistogram(metricName, entry.startTime / 1000);
  }
  
  private recordResourceTiming(entry: PerformanceResourceTiming): void {
    const resourceType = this.getResourceType(entry.name);
    
    this.recordHistogram('resource_load_duration_seconds', entry.duration / 1000, {
      type: resourceType,
      name: entry.name
    });
    
    this.incrementCounter('resources_loaded_total', { type: resourceType });
    
    // Record resource size if available
    if (entry.transferSize > 0) {
      this.recordHistogram('resource_size_bytes', entry.transferSize, {
        type: resourceType
      });
    }
  }
  
  private getResourceType(url: string): string {
    if (url.match(/\.(js|mjs)$/)) return 'script';
    if (url.match(/\.(css)$/)) return 'stylesheet';
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) return 'image';
    if (url.match(/\.(woff|woff2|ttf|eot)$/)) return 'font';
    if (url.match(/\.(json|xml)$/)) return 'fetch';
    return 'other';
  }
  
  private updateMemoryMetrics(): void {
    if (typeof window === 'undefined' || !('memory' in performance)) return;
    
    const memory = (performance as any).memory;
    this.setGauge('memory_usage_bytes', memory.usedJSHeapSize);
    this.setGauge('memory_limit_bytes', memory.jsHeapSizeLimit);
    this.setGauge('memory_total_bytes', memory.totalJSHeapSize);
  }
  
  // Public API methods
  
  /**
   * Create a new histogram metric
   */
  public createHistogram(name: string, help: string, buckets?: number[]): void {
    if (this.histograms.has(name)) return;
    
    const histogram: Histogram = {
      buckets: buckets || this.config.histogramBuckets,
      counts: new Array(buckets?.length || this.config.histogramBuckets.length).fill(0),
      sum: 0,
      count: 0
    };
    
    this.histograms.set(name, histogram);
  }
  
  /**
   * Record a value in a histogram
   */
  public recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.config.enableCollection || Math.random() > this.config.sampleRate) return;
    
    const histogram = this.histograms.get(name);
    if (!histogram) {
      this.createHistogram(name, `Auto-created histogram for ${name}`);
      return this.recordHistogram(name, value, labels);
    }
    
    // Find the appropriate bucket
    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]) {
        histogram.counts[i]++;
        break;
      }
    }
    
    histogram.sum += value;
    histogram.count++;
    
    // Store for history
    this.storeMetricValue(name, { timestamp: Date.now(), labels, value });
    
    // Check alerts
    this.checkAlerts(name, value);
  }
  
  /**
   * Create a new counter metric
   */
  public createCounter(name: string, help: string): void {
    if (this.counters.has(name)) return;
    
    this.counters.set(name, { value: 0 });
  }
  
  /**
   * Increment a counter
   */
  public incrementCounter(name: string, labels: Record<string, string> = {}, amount: number = 1): void {
    if (!this.config.enableCollection) return;
    
    const counter = this.counters.get(name);
    if (!counter) {
      this.createCounter(name, `Auto-created counter for ${name}`);
      return this.incrementCounter(name, labels, amount);
    }
    
    counter.value += amount;
    counter.labels = { ...counter.labels, ...labels };
    
    // Store for history
    this.storeMetricValue(name, { timestamp: Date.now(), labels, increment: amount });
  }
  
  /**
   * Create a new gauge metric
   */
  public createGauge(name: string, help: string): void {
    if (this.gauges.has(name)) return;
    
    this.gauges.set(name, { value: 0 });
  }
  
  /**
   * Set a gauge value
   */
  public setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.config.enableCollection) return;
    
    const gauge = this.gauges.get(name);
    if (!gauge) {
      this.createGauge(name, `Auto-created gauge for ${name}`);
      return this.setGauge(name, value, labels);
    }
    
    gauge.value = value;
    gauge.labels = { ...gauge.labels, ...labels };
    
    // Store for history
    this.storeMetricValue(name, { timestamp: Date.now(), labels, value });
    
    // Check alerts
    this.checkAlerts(name, value);
  }
  
  /**
   * Record an error with categorization
   */
  public recordError(errorType: string, metadata: Record<string, string> = {}): void {
    const fullType = `error_${errorType}`;
    this.incrementCounter('errors_total', { type: errorType });
    
    // Track error types
    const currentCount = this.errorCounts.get(fullType) || 0;
    this.errorCounts.set(fullType, currentCount + 1);
    
    // Record error timing
    this.recordHistogram('error_rate_per_minute', 1, { type: errorType });
    
    console.warn(`Application Error [${errorType}]:`, metadata);
  }
  
  /**
   * Record HTTP request metrics
   */
  public recordHttpRequest(method: string, path: string, statusCode: number, duration: number): void {
    this.recordHistogram('http_request_duration_seconds', duration / 1000, {
      method,
      path,
      status: statusCode.toString()
    });
    
    this.incrementCounter('http_requests_total', {
      method,
      path,
      status: statusCode.toString()
    });
    
    // Record error if status indicates failure
    if (statusCode >= 400) {
      this.recordError('http_error', {
        method,
        path,
        status: statusCode.toString()
      });
    }
  }
  
  /**
   * Record WebSocket message metrics
   */
  public recordWebSocketMessage(type: string, direction: 'inbound' | 'outbound', latency?: number): void {
    this.incrementCounter('websocket_messages_total', { type, direction });
    
    if (latency !== undefined) {
      this.recordHistogram('websocket_message_latency_seconds', latency / 1000, {
        type,
        direction
      });
    }
  }
  
  /**
   * Record game-specific metrics
   */
  public recordGameAction(action: string, gameId: string, playerId: string, duration?: number): void {
    this.incrementCounter('game_actions_total', { action, game_id: gameId });
    
    if (duration !== undefined) {
      this.recordHistogram('game_action_duration_seconds', duration / 1000, {
        action,
        game_id: gameId
      });
    }
  }
  
  /**
   * Get current metrics snapshot
   */
  public getMetrics(): ApplicationMetrics {
    return {
      performance: {
        responseTime: this.histograms.get('http_request_duration_seconds') || this.createEmptyHistogram(),
        latency: this.histograms.get('websocket_message_latency_seconds') || this.createEmptyHistogram(),
        throughput: this.counters.get('http_requests_total') || { value: 0 }
      },
      resources: {
        cpu: this.gauges.get('cpu_usage_percent') || { value: 0 },
        memory: this.gauges.get('memory_usage_bytes') || { value: 0 },
        connections: this.gauges.get('active_connections') || { value: 0 }
      },
      errors: {
        count: this.counters.get('errors_total') || { value: 0 },
        types: Object.fromEntries(this.errorCounts)
      }
    };
  }
  
  /**
   * Get all metrics in Prometheus format
   */
  public getPrometheusMetrics(): string {
    const lines: string[] = [];
    
    // Export histograms
    for (const [name, histogram] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (let i = 0; i < histogram.buckets.length; i++) {
        lines.push(`${name}_bucket{le="${histogram.buckets[i]}"} ${histogram.counts[i]}`);
      }
      lines.push(`${name}_bucket{le="+Inf"} ${histogram.count}`);
      lines.push(`${name}_sum ${histogram.sum}`);
      lines.push(`${name}_count ${histogram.count}`);
    }
    
    // Export counters
    for (const [name, counter] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      const labels = counter.labels ? this.formatLabels(counter.labels) : '';
      lines.push(`${name}${labels} ${counter.value}`);
    }
    
    // Export gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      const labels = gauge.labels ? this.formatLabels(gauge.labels) : '';
      lines.push(`${name}${labels} ${gauge.value}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Add alert rule
   */
  public addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }
  
  /**
   * Get performance summary report
   */
  public getPerformanceReport(): Record<string, any> {
    const now = Date.now();
    const report: Record<string, any> = {
      timestamp: now,
      uptime: now - (this.lastErrorFlush || now),
      metrics_collected: this.histograms.size + this.counters.size + this.gauges.size
    };
    
    // Calculate percentiles for key histograms
    const keyHistograms = [
      'http_request_duration_seconds',
      'websocket_message_latency_seconds',
      'page_load_duration_seconds'
    ];
    
    for (const histogramName of keyHistograms) {
      const histogram = this.histograms.get(histogramName);
      if (histogram && histogram.count > 0) {
        report[histogramName] = {
          count: histogram.count,
          sum: histogram.sum,
          avg: histogram.sum / histogram.count,
          percentiles: this.calculatePercentiles(histogram)
        };
      }
    }
    
    // Error rate analysis
    const totalErrors = this.counters.get('errors_total')?.value || 0;
    const totalRequests = this.counters.get('http_requests_total')?.value || 0;
    
    report.error_rate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    report.error_types = Object.fromEntries(this.errorCounts);
    
    return report;
  }
  
  // Private helper methods
  
  private createEmptyHistogram(): Histogram {
    return {
      buckets: this.config.histogramBuckets,
      counts: new Array(this.config.histogramBuckets.length).fill(0),
      sum: 0,
      count: 0
    };
  }
  
  private formatLabels(labels: Record<string, string>): string {
    const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }
  
  private calculatePercentiles(histogram: Histogram): Record<string, number> {
    const percentiles = { p50: 0, p90: 0, p95: 0, p99: 0 };
    
    if (histogram.count === 0) return percentiles;
    
    const targets = [0.5, 0.9, 0.95, 0.99];
    const labels = ['p50', 'p90', 'p95', 'p99'];
    
    let cumulative = 0;
    let targetIndex = 0;
    
    for (let i = 0; i < histogram.buckets.length && targetIndex < targets.length; i++) {
      cumulative += histogram.counts[i];
      const ratio = cumulative / histogram.count;
      
      while (targetIndex < targets.length && ratio >= targets[targetIndex]) {
        percentiles[labels[targetIndex] as keyof typeof percentiles] = histogram.buckets[i];
        targetIndex++;
      }
    }
    
    return percentiles;
  }
  
  private storeMetricValue(name: string, value: MetricValue): void {
    if (!this.metricHistory.has(name)) {
      this.metricHistory.set(name, []);
    }
    
    const history = this.metricHistory.get(name)!;
    history.push(value);
    
    // Keep only recent values
    if (history.length > this.config.maxMetricsRetention) {
      history.splice(0, history.length - this.config.maxMetricsRetention);
    }
  }
  
  private checkAlerts(metricName: string, value: number): void {
    for (const rule of this.alertRules) {
      if (rule.metricName === metricName) {
        let triggered = false;
        
        switch (rule.comparison) {
          case 'gt':
            triggered = value > rule.threshold;
            break;
          case 'lt':
            triggered = value < rule.threshold;
            break;
          case 'eq':
            triggered = value === rule.threshold;
            break;
        }
        
        if (triggered) {
          console.warn(`ALERT [${rule.severity}]: ${metricName} ${rule.comparison} ${rule.threshold}, current: ${value}`);
          
          // Could integrate with external alerting system here
          this.recordError('metric_alert', {
            metric: metricName,
            severity: rule.severity,
            threshold: rule.threshold.toString(),
            value: value.toString()
          });
        }
      }
    }
  }
  
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      this.flushMetrics();
    }, this.config.flushInterval);
  }
  
  private async flushMetrics(): Promise<void> {
    if (!this.config.exportEndpoint) return;
    
    try {
      const metrics = this.getPrometheusMetrics();
      
      await fetch(this.config.exportEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: metrics
      });
      
    } catch (error) {
      console.warn('Failed to export metrics:', error);
    }
  }
  
  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
    
    if (this.resourceObserver) {
      this.resourceObserver.disconnect();
    }
    
    // Final flush
    this.flushMetrics();
  }
}

// Singleton instance
export const getApplicationMetrics = (config?: Partial<MetricsConfig>): ApplicationMetricsCollector => {
  return ApplicationMetricsCollector.getInstance(config);
};

// Convenience functions for common operations
export const recordHttpRequest = (method: string, path: string, statusCode: number, duration: number) => {
  getApplicationMetrics().recordHttpRequest(method, path, statusCode, duration);
};

export const recordWebSocketMessage = (type: string, direction: 'inbound' | 'outbound', latency?: number) => {
  getApplicationMetrics().recordWebSocketMessage(type, direction, latency);
};

export const recordGameAction = (action: string, gameId: string, playerId: string, duration?: number) => {
  getApplicationMetrics().recordGameAction(action, gameId, playerId, duration);
};

export const recordError = (errorType: string, metadata: Record<string, string> = {}) => {
  getApplicationMetrics().recordError(errorType, metadata);
};

// React hooks for component-level metrics
export const useMetrics = () => {
  const metrics = getApplicationMetrics();
  
  return {
    recordHistogram: metrics.recordHistogram.bind(metrics),
    incrementCounter: metrics.incrementCounter.bind(metrics),
    setGauge: metrics.setGauge.bind(metrics),
    recordError: metrics.recordError.bind(metrics),
    addAlertRule: metrics.addAlertRule.bind(metrics)
  };
};

export const usePerformanceTracking = (componentName: string) => {
  const metrics = getApplicationMetrics();
  
  const trackRender = () => {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      metrics.recordHistogram('component_render_duration_seconds', duration / 1000, {
        component: componentName
      });
    };
  };
  
  const trackInteraction = (interactionName: string) => {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      metrics.recordHistogram('user_interaction_duration_seconds', duration / 1000, {
        component: componentName,
        interaction: interactionName
      });
    };
  };
  
  return { trackRender, trackInteraction };
};

// Export types
// Types are already exported as interfaces above; no duplicate re-export needed
