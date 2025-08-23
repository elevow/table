/**
 * Game Analytics Dashboard Component - US-042 Implementation
 * 
 * React component providing comprehensive visualization of game analytics
 * including room statistics, player behavior, feature usage, and trend analysis.
 * 
 * @author GitHub Copilot
 * @version 1.0.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GameAnalytics,
  GameAnalyticsCollector,
  RoomStatistics,
  PlayerSession,
  ActionTiming,
  TrendData,
  AnalyticsReport,
  AnalyticsFilter,
  AnalyticsEvent,
  getGameAnalytics
} from '../lib/game-analytics';

// Types for component props
interface GameAnalyticsDashboardProps {
  refreshInterval?: number;
  showAdvancedMetrics?: boolean;
  allowExport?: boolean;
  customFilters?: AnalyticsFilter;
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  trend?: number;
  format?: 'number' | 'currency' | 'percentage' | 'duration';
  className?: string;
}

interface ChartProps {
  data: TrendData[];
  title: string;
  type?: 'line' | 'bar' | 'area';
  height?: number;
}

interface TableProps {
  data: any[];
  columns: TableColumn[];
  maxRows?: number;
}

interface TableColumn {
  key: string;
  title: string;
  format?: (value: any) => string;
  sortable?: boolean;
}

// Custom hooks for analytics data
export const useGameAnalytics = (refreshInterval: number = 5000) => {
  const [analytics, setAnalytics] = useState<GameAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const collector = useMemo(() => getGameAnalytics(), []);

  const refreshAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const currentAnalytics = collector.getAnalytics();
      setAnalytics(currentAnalytics);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  }, [collector]);

  useEffect(() => {
    refreshAnalytics();

    const interval = setInterval(refreshAnalytics, refreshInterval);
    const eventListener = () => refreshAnalytics();
    
    collector.on('metricsUpdated', eventListener);

    return () => {
      clearInterval(interval);
      collector.off('metricsUpdated', eventListener);
    };
  }, [refreshInterval, refreshAnalytics, collector]);

  return {
    analytics,
    loading,
    error,
    lastUpdated,
    refresh: refreshAnalytics,
    collector
  };
};

export const useRoomStatistics = () => {
  const [roomStats, setRoomStats] = useState<RoomStatistics[]>([]);
  const [loading, setLoading] = useState(true);

  const collector = useMemo(() => getGameAnalytics(), []);

  useEffect(() => {
    const fetchRoomStats = () => {
      try {
        const stats = collector.getRoomStatistics();
        setRoomStats(stats);
      } catch (error) {
        console.error('Failed to fetch room statistics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRoomStats();
    const interval = setInterval(fetchRoomStats, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [collector]);

  return { roomStats, loading };
};

export const useTrendData = (metric: string, period: 'hour' | 'day' | 'week' | 'month') => {
  const [trendData, setTrendData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);

  const collector = useMemo(() => getGameAnalytics(), []);

  useEffect(() => {
    const fetchTrends = () => {
      try {
        const trends = collector.getTrendData(metric, period);
        setTrendData(trends);
      } catch (error) {
        console.error('Failed to fetch trend data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTrends();
    const interval = setInterval(fetchTrends, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [metric, period, collector]);

  return { trendData, loading };
};

// Utility Components
const MetricCard: React.FC<MetricCardProps> = ({ 
  title, 
  value, 
  trend, 
  format = 'number',
  className = '' 
}) => {
  const formatValue = (val: string | number): string => {
    if (typeof val === 'string') return val;
    
    switch (format) {
      case 'currency':
        return `$${val.toLocaleString()}`;
      case 'percentage':
        return `${val.toFixed(1)}%`;
      case 'duration':
        const minutes = Math.floor(val / 60000);
        const seconds = Math.floor((val % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
      default:
        return val.toLocaleString();
    }
  };

  const getTrendIcon = () => {
    if (trend === undefined) return null;
    if (trend > 0) return '↗️';
    if (trend < 0) return '↘️';
    return '→';
  };

  const getTrendColor = () => {
    if (trend === undefined) return '';
    if (trend > 0) return 'text-green-600';
    if (trend < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <div className={`bg-white rounded-lg p-4 shadow-sm border ${className}`}>
      <div className="text-sm font-medium text-gray-600 mb-1">{title}</div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold text-gray-900">{formatValue(value)}</div>
        {trend !== undefined && (
          <div className={`text-sm ${getTrendColor()} flex items-center`}>
            {getTrendIcon()}
            <span className="ml-1">{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

const SimpleChart: React.FC<ChartProps> = ({ data, title, type = 'line', height = 200 }) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg p-4 shadow-sm border">
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="flex items-center justify-center h-48 text-gray-500">
          No data available
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d.value));
  const minValue = Math.min(...data.map(d => d.value));
  const range = maxValue - minValue;

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="relative" style={{ height }}>
        <svg width="100%" height="100%" className="overflow-visible">
          {data.map((point, index) => {
            const x = (index / (data.length - 1)) * 100;
            const y = 100 - ((point.value - minValue) / range) * 100;
            
            if (type === 'bar') {
              const barWidth = 80 / data.length;
              return (
                <rect
                  key={index}
                  x={`${x - barWidth/2}%`}
                  y={`${y}%`}
                  width={`${barWidth}%`}
                  height={`${100 - y}%`}
                  fill="#3B82F6"
                  opacity={0.7}
                />
              );
            }
            
            return (
              <circle
                key={index}
                cx={`${x}%`}
                cy={`${y}%`}
                r="3"
                fill="#3B82F6"
              />
            );
          })}
          
          {type === 'line' && data.length > 1 && (
            <polyline
              points={data.map((point, index) => {
                const x = (index / (data.length - 1)) * 100;
                const y = 100 - ((point.value - minValue) / range) * 100;
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        
        {/* Simple Y-axis labels */}
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-gray-500 -ml-12">
          <span>{maxValue.toFixed(0)}</span>
          <span>{((maxValue + minValue) / 2).toFixed(0)}</span>
          <span>{minValue.toFixed(0)}</span>
        </div>
      </div>
      
      {/* X-axis labels */}
      <div className="mt-2 flex justify-between text-xs text-gray-500">
        {data.length > 0 && (
          <>
            <span>{data[0].timestamp.toLocaleDateString()}</span>
            {data.length > 1 && (
              <span>{data[data.length - 1].timestamp.toLocaleDateString()}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const DataTable: React.FC<TableProps> = ({ data, columns, maxRows = 10 }) => {
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (columnKey: string) => {
    const column = columns.find(col => col.key === columnKey);
    if (!column?.sortable) return;

    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortColumn) return data.slice(0, maxRows);

    const sorted = [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted.slice(0, maxRows);
  }, [data, sortColumn, sortDirection, maxRows]);

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${
                    column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                  }`}
                  onClick={() => handleSort(column.key)}
                >
                  <div className="flex items-center">
                    {column.title}
                    {column.sortable && sortColumn === column.key && (
                      <span className="ml-1">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedData.map((row, index) => (
              <tr key={index} className="hover:bg-gray-50">
                {columns.map((column) => (
                  <td key={column.key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {column.format ? column.format(row[column.key]) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {data.length > maxRows && (
        <div className="bg-gray-50 px-6 py-3 text-sm text-gray-500">
          Showing {maxRows} of {data.length} items
        </div>
      )}
    </div>
  );
};

// Main Dashboard Component
export const GameAnalyticsDashboard: React.FC<GameAnalyticsDashboardProps> = ({
  refreshInterval = 5000,
  showAdvancedMetrics = false,
  allowExport = true,
  customFilters,
  className = ''
}) => {
  const { analytics, loading, error, lastUpdated, refresh, collector } = useGameAnalytics(refreshInterval);
  const { roomStats } = useRoomStatistics();
  const playerTrend = useTrendData('active_players', 'hour');
  const revenueTrend = useTrendData('revenue', 'day');
  
  const [selectedTab, setSelectedTab] = useState<'overview' | 'rooms' | 'players' | 'features' | 'trends'>('overview');
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleExport = useCallback(async () => {
    if (!collector) return;
    
    try {
      const exportData = collector.exportData(exportFormat, customFilters);
      const blob = new Blob([exportData], { 
        type: exportFormat === 'json' ? 'application/json' : 'text/csv' 
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `game-analytics-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setShowExportDialog(false);
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, [collector, exportFormat, customFilters]);

  const generateReport = useCallback(async (type: 'daily' | 'weekly' | 'monthly') => {
    if (!collector) return;
    
    try {
      const report = collector.generateReport(type, {
        includeCharts: true,
        includeRecommendations: true,
        filter: customFilters
      });
      
      const reportData = JSON.stringify(report, null, 2);
      const blob = new Blob([reportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `analytics-report-${type}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Report generation failed:', error);
    }
  }, [collector, customFilters]);

  if (loading && !analytics) {
    return (
      <div className={`game-analytics-dashboard ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`game-analytics-dashboard ${className}`}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-red-800 font-medium">Error loading analytics</div>
          <div className="text-red-600 text-sm mt-1">{error}</div>
          <button 
            onClick={refresh}
            className="mt-3 bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className={`game-analytics-dashboard ${className}`}>
        <div className="text-center py-8 text-gray-500">
          No analytics data available
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'players', label: 'Players' },
    { id: 'features', label: 'Features' },
    { id: 'trends', label: 'Trends' }
  ];

  const roomColumns: TableColumn[] = [
    { key: 'roomId', title: 'Room ID', sortable: true },
    { key: 'gameType', title: 'Game Type', sortable: true },
    { key: 'stakes', title: 'Stakes', sortable: true },
    { key: 'playerCount', title: 'Players', sortable: true },
    { key: 'handsPlayed', title: 'Hands', sortable: true },
    { 
      key: 'duration', 
      title: 'Duration', 
      sortable: true,
      format: (value: number) => {
        const minutes = Math.floor(value / 60000);
        return `${minutes}m`;
      }
    },
    { 
      key: 'rakeCollected', 
      title: 'Rake', 
      sortable: true,
      format: (value: number) => `$${value.toFixed(2)}`
    }
  ];

  return (
    <div className={`game-analytics-dashboard ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Game Analytics</h1>
          {lastUpdated && (
            <p className="text-sm text-gray-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        
        <div className="flex space-x-2">
          <button
            onClick={refresh}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
          >
            Refresh
          </button>
          
          {allowExport && (
            <div className="relative">
              <button
                onClick={() => setShowExportDialog(!showExportDialog)}
                className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700"
              >
                Export
              </button>
              
              {showExportDialog && (
                <div className="absolute right-0 mt-2 w-48 bg-white border rounded-lg shadow-lg z-10">
                  <div className="p-3">
                    <div className="mb-3">
                      <label className="text-sm font-medium text-gray-700">Format:</label>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'json' | 'csv')}
                        className="mt-1 block w-full text-sm border-gray-300 rounded"
                      >
                        <option value="json">JSON</option>
                        <option value="csv">CSV</option>
                      </select>
                    </div>
                    <button
                      onClick={handleExport}
                      className="w-full bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700"
                    >
                      Export Data
                    </button>
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-gray-500 mb-2">Generate Report:</p>
                      <div className="space-y-1">
                        <button
                          onClick={() => generateReport('daily')}
                          className="w-full text-left text-xs text-gray-600 hover:text-blue-600"
                        >
                          Daily Report
                        </button>
                        <button
                          onClick={() => generateReport('weekly')}
                          className="w-full text-left text-xs text-gray-600 hover:text-blue-600"
                        >
                          Weekly Report
                        </button>
                        <button
                          onClick={() => generateReport('monthly')}
                          className="w-full text-left text-xs text-gray-600 hover:text-blue-600"
                        >
                          Monthly Report
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Active Rooms"
              value={analytics.rooms.active}
              format="number"
            />
            <MetricCard
              title="Active Players"
              value={analytics.players.active}
              format="number"
            />
            <MetricCard
              title="Total Revenue"
              value={analytics.revenue.grossRevenue}
              format="currency"
            />
            <MetricCard
              title="Avg Session Duration"
              value={analytics.players.behavior.sessionDuration}
              format="duration"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SimpleChart
              data={playerTrend.trendData}
              title="Player Activity (Last 24 Hours)"
              type="line"
            />
            <SimpleChart
              data={revenueTrend.trendData}
              title="Revenue Trend (Last 7 Days)"
              type="bar"
            />
          </div>

          {/* Feature Usage Overview */}
          <div className="bg-white rounded-lg p-4 shadow-sm border">
            <h3 className="text-lg font-semibold mb-4">Feature Usage</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(analytics.features.usage).map(([feature, stats]) => (
                <div key={feature} className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.usage}</div>
                  <div className="text-sm text-gray-600 capitalize">{feature}</div>
                  <div className="text-xs text-gray-500">Frequency: {stats.frequency}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'rooms' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title="Active Rooms"
              value={analytics.rooms.active}
              format="number"
            />
            <MetricCard
              title="Avg Room Duration"
              value={analytics.rooms.avgDuration}
              format="duration"
            />
            <MetricCard
              title="Total Rake Collected"
              value={analytics.revenue.rakeCollected}
              format="currency"
            />
          </div>

          <DataTable
            data={roomStats}
            columns={roomColumns}
            maxRows={15}
          />
        </div>
      )}

      {selectedTab === 'players' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Active Players"
              value={analytics.players.active}
              format="number"
            />
            <MetricCard
              title="Average VPIP"
              value={analytics.players.behavior.vpip}
              format="percentage"
            />
            <MetricCard
              title="Average PFR"
              value={analytics.players.behavior.pfr}
              format="percentage"
            />
            <MetricCard
              title="Win Rate"
              value={analytics.players.behavior.winRate}
              format="percentage"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Player Demographics */}
            <div className="bg-white rounded-lg p-4 shadow-sm border">
              <h3 className="text-lg font-semibold mb-4">Player Demographics</h3>
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-2">By Device</div>
                  <div className="space-y-1">
                    {Object.entries(analytics.players.demographics.byDevice).map(([device, count]) => (
                      <div key={device} className="flex justify-between text-sm">
                        <span className="capitalize">{device}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Retention Metrics */}
            <div className="bg-white rounded-lg p-4 shadow-sm border">
              <h3 className="text-lg font-semibold mb-4">Player Retention</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Day 1 Retention</span>
                  <span className="font-medium">{(analytics.players.retention.day1 * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Day 7 Retention</span>
                  <span className="font-medium">{(analytics.players.retention.day7 * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Day 30 Retention</span>
                  <span className="font-medium">{(analytics.players.retention.day30 * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'features' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(analytics.features.usage).map(([feature, stats]) => (
              <MetricCard
                key={feature}
                title={feature.charAt(0).toUpperCase() + feature.slice(1)}
                value={stats.usage}
                format="number"
                className="text-center"
              />
            ))}
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border">
            <h3 className="text-lg font-semibold mb-4">Feature Performance</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Feature</th>
                    <th className="text-left py-2">Load Time (ms)</th>
                    <th className="text-left py-2">Error Rate (%)</th>
                    <th className="text-left py-2">Completion Rate (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(analytics.features.performance.loadTimes).map(([feature, loadTime]) => (
                    <tr key={feature} className="border-b">
                      <td className="py-2 capitalize">{feature}</td>
                      <td className="py-2">{loadTime.toFixed(0)}</td>
                      <td className="py-2">
                        {((analytics.features.performance.errorRates[feature] || 0) * 100).toFixed(1)}
                      </td>
                      <td className="py-2">
                        {((analytics.features.performance.completionRates[feature] || 0) * 100).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'trends' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SimpleChart
              data={playerTrend.trendData}
              title="Player Activity Trend"
              type="line"
              height={250}
            />
            <SimpleChart
              data={revenueTrend.trendData}
              title="Revenue Trend"
              type="area"
              height={250}
            />
          </div>

          {showAdvancedMetrics && (
            <div className="bg-white rounded-lg p-4 shadow-sm border">
              <h3 className="text-lg font-semibold mb-4">Advanced Metrics</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricCard
                  title="Hands per Hour"
                  value={analytics.gameplay.handsPerHour}
                  format="number"
                />
                <MetricCard
                  title="Average Pot Size"
                  value={analytics.gameplay.averagePotSize}
                  format="currency"
                />
                <MetricCard
                  title="Flop Percentage"
                  value={analytics.gameplay.flopPercentage}
                  format="percentage"
                />
                <MetricCard
                  title="Showdown Percentage"
                  value={analytics.gameplay.showdownPercentage}
                  format="percentage"
                />
                <MetricCard
                  title="Avg Players per Flop"
                  value={analytics.gameplay.averagePlayersPerFlop}
                  format="number"
                />
                <MetricCard
                  title="Lifetime Value"
                  value={analytics.revenue.lifetimeValue}
                  format="currency"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Click outside to close export dialog */}
      {showExportDialog && (
        <div
          className="fixed inset-0 z-5"
          onClick={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
};

export default GameAnalyticsDashboard;
