/**
 * Utility to monitor code loading and execution performance
 */

type MetricType = 'load' | 'render' | 'interaction' | 'navigation';

interface PerformanceMetric {
  type: MetricType;
  name: string;
  startTime: number;
  duration: number;
  metadata?: Record<string, any>;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private marks: Record<string, number> = {};
  private ongoing: Record<string, number> = {};
  private sent: Set<string> = new Set();
  private flushInterval: NodeJS.Timeout | null = null;
  
  constructor(private flushIntervalMs = 10000, private sampleRate = 0.1) {
    if (typeof window !== 'undefined') {
      this.setupPerformanceObservers();
      this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
    }
  }
  
  private setupPerformanceObservers() {
    try {
      // Observe paint timing
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const metric: PerformanceMetric = {
            type: 'render',
            name: entry.name,
            startTime: entry.startTime,
            duration: 0,
          };
          this.addMetric(metric);
        }
      });
      paintObserver.observe({ entryTypes: ['paint'] });
      
      // Observe navigation timing
      const navigationObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const navEntry = entry as PerformanceNavigationTiming;
          const metric: PerformanceMetric = {
            type: 'navigation',
            name: 'page-load',
            startTime: 0,
            duration: navEntry.loadEventEnd,
            metadata: {
              domInteractive: navEntry.domInteractive,
              domComplete: navEntry.domComplete,
              redirectTime: navEntry.redirectEnd - navEntry.redirectStart,
              dnsTime: navEntry.domainLookupEnd - navEntry.domainLookupStart,
              tcpTime: navEntry.connectEnd - navEntry.connectStart,
              requestTime: navEntry.responseStart - navEntry.requestStart,
              responseTime: navEntry.responseEnd - navEntry.responseStart,
              domProcessingTime: navEntry.domComplete - navEntry.responseEnd,
              url: window.location.pathname,
            }
          };
          this.addMetric(metric);
        }
      });
      navigationObserver.observe({ entryTypes: ['navigation'] });
      
      // Observe resource timing
      const resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const resEntry = entry as PerformanceResourceTiming;
          // Only sample a percentage of resource loads to reduce noise
          if (Math.random() > this.sampleRate) continue;
          
          const metric: PerformanceMetric = {
            type: 'load',
            name: `resource-${this.getResourceType(resEntry.name)}`,
            startTime: resEntry.startTime,
            duration: resEntry.duration,
            metadata: {
              url: resEntry.name,
              size: resEntry.transferSize,
              initiatorType: resEntry.initiatorType,
            }
          };
          this.addMetric(metric);
        }
      });
      resourceObserver.observe({ entryTypes: ['resource'] });
      
    } catch (error) {
      console.error('Error setting up performance observers:', error);
    }
  }
  
  private getResourceType(url: string): string {
    if (url.match(/\.(js)(\?|$)/)) return 'js';
    if (url.match(/\.(css)(\?|$)/)) return 'css';
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/)) return 'image';
    if (url.match(/\.(woff|woff2|ttf|otf|eot)(\?|$)/)) return 'font';
    return 'other';
  }
  
  // Start timing a custom event
  public startMark(name: string): void {
    this.ongoing[name] = performance.now();
  }
  
  // End timing and record the metric
  public endMark(name: string, metadata?: Record<string, any>): void {
    if (this.ongoing[name]) {
      const startTime = this.ongoing[name];
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      const metric: PerformanceMetric = {
        type: 'interaction',
        name,
        startTime,
        duration,
        metadata,
      };
      
      this.addMetric(metric);
      delete this.ongoing[name];
    }
  }
  
  private addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`Performance metric: ${metric.name} (${metric.type}) - ${metric.duration.toFixed(2)}ms`);
    }
  }
  
  // Send metrics to analytics service
  private flush(): void {
    if (this.metrics.length === 0) return;
    
    const metricsToSend = this.metrics.filter(m => !this.sent.has(`${m.name}-${m.startTime}`));
    
    if (metricsToSend.length > 0) {
      // In a real implementation, you would send these to your analytics service
      console.log(`Sending ${metricsToSend.length} performance metrics`);
      
      // Mark as sent
      metricsToSend.forEach(m => this.sent.add(`${m.name}-${m.startTime}`));
      
      // Keep the metrics array from growing too large
      if (this.metrics.length > 1000) {
        this.metrics = this.metrics.slice(-100);
      }
    }
  }
  
  // Clean up on unmount
  public cleanup(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

// Create singleton instance
let monitor: PerformanceMonitor | null = null;

export const getPerformanceMonitor = (): PerformanceMonitor => {
  if (!monitor) {
    monitor = new PerformanceMonitor();
  }
  return monitor;
};

// Hook for measuring component render performance
export const useComponentPerformance = (componentName: string) => {
  if (typeof window === 'undefined') return { markInteraction: () => {} };
  
  const monitor = getPerformanceMonitor();
  
  // Mark component render start
  monitor.startMark(`render-${componentName}`);
  
  // Use setTimeout to ensure we measure after the render is complete
  setTimeout(() => {
    monitor.endMark(`render-${componentName}`);
  }, 0);
  
  return {
    markInteraction: (interactionName: string, metadata?: Record<string, any>) => {
      const fullName = `${componentName}-${interactionName}`;
      monitor.startMark(fullName);
      
      return () => {
        monitor.endMark(fullName, metadata);
      };
    }
  };
};
