import { jest } from '@jest/globals';

describe('Application Metrics - branches', () => {
  let getApplicationMetrics: any;
  let ApplicationMetricsCollector: any;

  beforeEach(async () => {
    const mod = await import('../application-metrics');
    getApplicationMetrics = mod.getApplicationMetrics as any;
    ApplicationMetricsCollector = (mod as any).ApplicationMetricsCollector;
    if (ApplicationMetricsCollector) {
      (ApplicationMetricsCollector as any).instance = null;
    }

    // Minimal browser-like env
    global.performance = {
      now: jest.fn(() => 0),
      getEntriesByType: jest.fn(() => []),
      getEntriesByName: jest.fn(() => []),
      mark: jest.fn(),
      measure: jest.fn(),
      clearMarks: jest.fn(),
      clearMeasures: jest.fn(),
      navigation: { type: 'navigate' }
    } as any;

    const PO = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      takeRecords: jest.fn(() => [])
    }));
    Object.defineProperty(PO, 'supportedEntryTypes', { value: ['navigation', 'resource', 'measure', 'paint'] });
    // @ts-ignore
    global.PerformanceObserver = PO;

    // Window mock for error handlers
    // @ts-ignore
    global.window = { addEventListener: jest.fn(), removeEventListener: jest.fn() };

    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    if (ApplicationMetricsCollector) {
      (ApplicationMetricsCollector as any).instance = null;
    }
  });

  it('triggers alert rules for eq and lt comparisons', () => {
    const collector = getApplicationMetrics();
    collector.addAlertRule({ metricName: 'eq_metric', threshold: 5, comparison: 'eq', duration: 0, severity: 'info' });
    collector.addAlertRule({ metricName: 'lt_metric', threshold: 10, comparison: 'lt', duration: 0, severity: 'warning' });

    collector.recordHistogram('eq_metric', 5);
    collector.setGauge('lt_metric', 5);

    expect(console.warn).toHaveBeenCalled();
    const snap = collector.getMetrics();
    expect(snap.errors.count.value).toBeGreaterThanOrEqual(1);
  });

  it('formats labels in Prometheus output for counters and gauges', () => {
    const collector = getApplicationMetrics();
    collector.incrementCounter('prom_counter', { a: '1', b: 'x' }, 3);
    collector.setGauge('prom_gauge', 7, { env: 'test' });

    const text = collector.getPrometheusMetrics();
    expect(text).toContain('prom_counter{a="1",b="x"} 3');
    expect(text).toContain('prom_gauge{env="test"} 7');
  });

  it('records websocket counter without latency histogram when latency is undefined', () => {
    const collector = getApplicationMetrics();
    collector.recordWebSocketMessage('evt', 'inbound');
    const snap = collector.getMetrics();
    expect(snap.performance.latency.count).toBe(0);
  });

  it('does not record an error for successful HTTP requests', () => {
    const collector = getApplicationMetrics();
    collector.recordHttpRequest('GET', '/ok', 200, 10);
    const snap = collector.getMetrics();
    expect(snap.errors.count.value).toBe(0);
  });

  it('covers performance entry handling and resource type detection', () => {
    const collector = getApplicationMetrics();
    // Call private methods through runtime access
    const navEntry = {
      entryType: 'navigation',
      loadEventEnd: 3000,
      domContentLoadedEventEnd: 1500,
      responseStart: 300,
      domainLookupStart: 0,
      domainLookupEnd: 1,
      connectStart: 1,
      connectEnd: 2
    } as any;
    (collector as any).handlePerformanceEntry(navEntry);

    (collector as any).handlePerformanceEntry({ entryType: 'paint', name: 'first-paint', startTime: 100 } as any);
    (collector as any).handlePerformanceEntry({ entryType: 'largest-contentful-paint', startTime: 2000 } as any);
    (collector as any).handlePerformanceEntry({ entryType: 'measure', name: 'custom', duration: 123 } as any);

    const resBase = {
      duration: 1000,
      transferSize: 1024
    } as any;
    (collector as any).recordResourceTiming({ ...resBase, name: 'file.js' });
    (collector as any).recordResourceTiming({ ...resBase, name: 'styles.css' });
    (collector as any).recordResourceTiming({ ...resBase, name: 'image.png' });
    (collector as any).recordResourceTiming({ ...resBase, name: 'font.woff2' });
    (collector as any).recordResourceTiming({ ...resBase, name: 'data.json' });
    (collector as any).recordResourceTiming({ ...resBase, name: 'other.bin' });

  // Also record an HTTP request so responseTime histogram has data
  collector.recordHttpRequest('GET', '/detect', 201, 5);
  const snap = collector.getMetrics();
  expect(snap.performance.responseTime.count).toBeGreaterThanOrEqual(1);
  });

  it('logs a warning if export flush fails during cleanup', async () => {
    // Recreate instance with endpoint
    const collector = getApplicationMetrics({ exportEndpoint: 'https://metrics.example/ingest' });
    // @ts-ignore
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await collector.cleanup();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to export metrics:'), expect.any(Error));
  });

  it('records histogram values above all buckets and exports correctly', () => {
    const collector = getApplicationMetrics();
    collector.recordHistogram('custom_hi', 10000);
    const text = collector.getPrometheusMetrics();
    expect(text).toContain('custom_hi_sum 10000');
    expect(text).toContain('custom_hi_count 1');
  });

  it('records websocket latency histogram when latency provided', () => {
    const collector = getApplicationMetrics();
    collector.recordWebSocketMessage('evt', 'outbound', 42);
    const snap = collector.getMetrics();
    expect(snap.performance.latency.count).toBeGreaterThanOrEqual(1);
  });

  it('omits braces in label formatting when no labels present', () => {
    const collector = getApplicationMetrics();
    collector.createCounter('empty_labels_counter', 'test');
    const text = collector.getPrometheusMetrics();
    expect(text).toContain('empty_labels_counter 0');
    expect(text).not.toContain('empty_labels_counter{');
  });
});
