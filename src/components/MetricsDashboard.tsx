/**
 * Application Metrics Dashboard Component
 * Provides real-time visualization of application metrics
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getApplicationMetrics, ApplicationMetrics, AlertRule } from '../utils/application-metrics';

interface MetricsDashboardProps {
  refreshInterval?: number;
  showAlerts?: boolean;
  className?: string;
}

interface MetricCard {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  severity?: 'normal' | 'warning' | 'critical';
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({
  refreshInterval = 5000,
  showAlerts = true,
  className = ''
}) => {
  const [metrics, setMetrics] = useState<ApplicationMetrics | null>(null);
  const [performanceReport, setPerformanceReport] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const metricsCollector = getApplicationMetrics();
  
  const refreshMetrics = useCallback(async () => {
    try {
      setIsLoading(true);
      const currentMetrics = metricsCollector.getMetrics();
      const report = metricsCollector.getPerformanceReport();
      
      setMetrics(currentMetrics);
      setPerformanceReport(report);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setIsLoading(false);
    }
  }, [metricsCollector]);
  
  useEffect(() => {
    refreshMetrics();
    
    const interval = setInterval(refreshMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshMetrics, refreshInterval]);
  
  const formatNumber = (value: number, decimals: number = 2): string => {
    if (value === 0) return '0';
    if (value < 1) return value.toFixed(decimals);
    if (value < 1000) return Math.round(value).toString();
    if (value < 1000000) return (value / 1000).toFixed(1) + 'K';
    return (value / 1000000).toFixed(1) + 'M';
  };
  
  const formatDuration = (seconds: number): string => {
    if (seconds < 1) return Math.round(seconds * 1000) + 'ms';
    if (seconds < 60) return seconds.toFixed(2) + 's';
    return Math.round(seconds / 60) + 'm';
  };
  
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  const getMetricCards = (): MetricCard[] => {
    if (!metrics || !performanceReport) return [];
    
    const cards: MetricCard[] = [];
    
    // Performance metrics
    if (performanceReport.http_request_duration_seconds) {
      const responseTime = performanceReport.http_request_duration_seconds;
      cards.push({
        title: 'Avg Response Time',
        value: formatDuration(responseTime.avg),
        trend: responseTime.avg > 1 ? 'up' : responseTime.avg > 0.5 ? 'stable' : 'down',
        severity: responseTime.avg > 2 ? 'critical' : responseTime.avg > 1 ? 'warning' : 'normal'
      });
      
      cards.push({
        title: 'P95 Response Time',
        value: formatDuration(responseTime.percentiles.p95),
        severity: responseTime.percentiles.p95 > 5 ? 'critical' : responseTime.percentiles.p95 > 2 ? 'warning' : 'normal'
      });
    }
    
    // Throughput
    cards.push({
      title: 'Total Requests',
      value: formatNumber(metrics.performance.throughput.value),
      unit: 'requests'
    });
    
    // Error rate
    const errorRate = performanceReport.error_rate || 0;
    cards.push({
      title: 'Error Rate',
      value: errorRate.toFixed(2),
      unit: '%',
      severity: errorRate > 5 ? 'critical' : errorRate > 1 ? 'warning' : 'normal'
    });
    
    // Resource usage
    cards.push({
      title: 'Memory Usage',
      value: formatBytes(metrics.resources.memory.value),
      severity: metrics.resources.memory.value > 100 * 1024 * 1024 ? 'warning' : 'normal'
    });
    
    cards.push({
      title: 'Active Connections',
      value: formatNumber(metrics.resources.connections.value),
      unit: 'connections'
    });
    
    cards.push({
      title: 'CPU Usage',
      value: formatNumber(metrics.resources.cpu.value, 1),
      unit: '%',
      severity: metrics.resources.cpu.value > 80 ? 'critical' : metrics.resources.cpu.value > 60 ? 'warning' : 'normal'
    });
    
    return cards;
  };
  
  const getAlertSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50';
      case 'warning': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-green-600 bg-green-50';
    }
  };
  
  const getTrendIcon = (trend: string): string => {
    switch (trend) {
      case 'up': return '↗️';
      case 'down': return '↘️';
      default: return '➡️';
    }
  };
  
  if (isLoading && !metrics) {
    return (
      <div className={`metrics-dashboard ${className}`}>
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Loading metrics...</span>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={`metrics-dashboard ${className}`}>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <h3 className="text-red-800 font-semibold">Error Loading Metrics</h3>
          <p className="text-red-600 mt-1">{error}</p>
          <button
            onClick={refreshMetrics}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  const metricCards = getMetricCards();
  
  return (
    <div className={`metrics-dashboard ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Application Metrics</h2>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">
            Last updated: {new Date().toLocaleTimeString()}
          </span>
          <button
            onClick={refreshMetrics}
            disabled={isLoading}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {metricCards.map((card, index) => (
          <div
            key={index}
            className={`p-4 rounded-lg border-2 ${
              card.severity === 'critical'
                ? 'border-red-200 bg-red-50'
                : card.severity === 'warning'
                ? 'border-yellow-200 bg-yellow-50'
                : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">{card.title}</h3>
              {card.trend && (
                <span className="text-lg">{getTrendIcon(card.trend)}</span>
              )}
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold text-gray-900">
                {card.value}
              </span>
              {card.unit && (
                <span className="text-sm text-gray-500 ml-1">{card.unit}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Performance Details */}
      {performanceReport && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Response Time Distribution */}
          {performanceReport.http_request_duration_seconds && (
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Response Time Distribution
              </h3>
              <div className="space-y-2">
                {Object.entries(performanceReport.http_request_duration_seconds.percentiles).map(
                  ([percentile, value]) => (
                    <div key={percentile} className="flex justify-between">
                      <span className="text-sm text-gray-600">
                        {percentile.toUpperCase()}:
                      </span>
                      <span className="text-sm font-medium">
                        {formatDuration(value as number)}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
          
          {/* Error Types */}
          {performanceReport.error_types && Object.keys(performanceReport.error_types).length > 0 && (
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Error Types</h3>
              <div className="space-y-2">
                {Object.entries(performanceReport.error_types).map(([type, count]) => (
                  <div key={type} className="flex justify-between">
                    <span className="text-sm text-gray-600">{type}:</span>
                    <span className="text-sm font-medium">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* System Information */}
      {performanceReport && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="text-sm text-gray-600">Uptime:</span>
              <span className="ml-2 text-sm font-medium">
                {formatDuration(performanceReport.uptime / 1000)}
              </span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Metrics Collected:</span>
              <span className="ml-2 text-sm font-medium">
                {performanceReport.metrics_collected}
              </span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Error Rate:</span>
              <span className="ml-2 text-sm font-medium">
                {performanceReport.error_rate?.toFixed(2) || 0}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook for using metrics in components
export const useApplicationMetrics = () => {
  const [metrics, setMetrics] = useState<ApplicationMetrics | null>(null);
  const metricsCollector = getApplicationMetrics();
  
  useEffect(() => {
    const updateMetrics = () => {
      setMetrics(metricsCollector.getMetrics());
    };
    
    updateMetrics();
    const interval = setInterval(updateMetrics, 5000);
    
    return () => clearInterval(interval);
  }, [metricsCollector]);
  
  return {
    metrics,
    recordError: metricsCollector.recordError.bind(metricsCollector),
    recordHttpRequest: metricsCollector.recordHttpRequest.bind(metricsCollector),
    addAlertRule: metricsCollector.addAlertRule.bind(metricsCollector),
    getPerformanceReport: metricsCollector.getPerformanceReport.bind(metricsCollector)
  };
};

export default MetricsDashboard;
