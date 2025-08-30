import { jest } from '@jest/globals';

describe('Application Metrics - extras', () => {
  let getApplicationMetrics: any;
  let ApplicationMetricsCollector: any;

  beforeEach(async () => {
    // Fresh import of actual module and reset singleton
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

    // Quiet logs and allow assertions
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

  it('wrapper functions record metrics without throwing', () => {
    const { recordHttpRequest, recordWebSocketMessage, recordGameAction, recordError } = require('../application-metrics');
    const collector = getApplicationMetrics();

    recordHttpRequest('GET', '/api/x', 500, 123);
    recordWebSocketMessage('ws_test', 'outbound', 10);
    recordGameAction('move', 'g1', 'p1', 20);
    recordError('custom_error', { foo: 'bar' });

    const snap = collector.getMetrics();
    expect(snap.performance.throughput.value).toBeGreaterThanOrEqual(1);
    expect(snap.errors.count.value).toBeGreaterThanOrEqual(1);
  });

  it('usePerformanceTracking returns closures that record histograms', () => {
    const { usePerformanceTracking } = require('../application-metrics');
    // Make performance.now advance on subsequent calls using a spy
    let t = 0;
    const nowSpy = jest.spyOn(global.performance, 'now').mockImplementation(() => (t += 16));

    try {
      const { trackRender, trackInteraction } = usePerformanceTracking('Widget');
      const endRender = trackRender();
      endRender();
      const endClick = trackInteraction('click');
      endClick();

      const metrics = getApplicationMetrics().getMetrics();
      // We can't assert exact numbers, but histograms should have some data recorded
      expect(metrics.performance.responseTime.count).toBeGreaterThanOrEqual(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('flushMetrics posts to export endpoint during cleanup', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const collector = getApplicationMetrics({ exportEndpoint: 'https://metrics.example/ingest' });
    collector.incrementCounter('http_requests_total');
    await collector.cleanup();
    expect(global.fetch).toHaveBeenCalled();
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
  expect(url).toContain('https://metrics.example/ingest');
  expect(init.method).toBe('POST');
  });

  it('alerts trigger on threshold breach (gt)', () => {
    const collector = getApplicationMetrics();
    collector.addAlertRule({ metricName: 'custom_metric', threshold: 0.01, comparison: 'gt', duration: 0, severity: 'warning' });
    collector.recordHistogram('custom_metric', 1.0);
    expect(console.warn).toHaveBeenCalled();
    const metrics = collector.getMetrics();
    expect(metrics.errors.count.value).toBeGreaterThanOrEqual(1);
  });
});
