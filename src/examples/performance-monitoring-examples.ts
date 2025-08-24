/**
 * US-015: Performance Monitoring Service Usage Examples
 * 
 * This file demonstrates how to integrate and use the Performance Monitoring Service
 * in different environments and scenarios.
 */

import { Pool } from 'pg';
import { 
  PerformanceMonitoringService, 
  PerformanceMonitoringFactory,
  type MonitoringConfiguration,
  type Alert,
  type PerformanceReport
} from '../lib/database/performance-monitoring-service';

// ========================================
// BASIC SETUP EXAMPLE
// ========================================

/**
 * Basic setup for development environment
 */
export async function setupDevelopmentMonitoring(pool: Pool): Promise<PerformanceMonitoringService> {
  // Create development monitor with relaxed thresholds
  const monitor = PerformanceMonitoringFactory.createDevelopmentMonitor(pool);

  // Set up event listeners for development
  monitor.on('alert', (alert: Alert) => {
    console.log(`🚨 [DEV] Performance Alert: ${alert.message}`);
    console.log(`   Metric: ${alert.metric}, Value: ${alert.currentValue}, Threshold: ${alert.threshold}`);
  });

  monitor.on('monitoringStarted', () => {
    console.log('✅ Performance monitoring started');
  });

  monitor.on('monitoringError', (error: Error) => {
    console.error('❌ Monitoring error:', error.message);
  });

  // Initialize and start monitoring
  await monitor.initialize();
  
  return monitor;
}

/**
 * Production setup with comprehensive alerting
 */
export async function setupProductionMonitoring(
  pool: Pool,
  alertWebhook?: string
): Promise<PerformanceMonitoringService> {
  // Create production monitor with strict thresholds
  const monitor = PerformanceMonitoringFactory.createProductionMonitor(pool);

  // Set up production alerting
  monitor.on('alert', async (alert: Alert) => {
    console.error(`🚨 [PROD] Critical Alert: ${alert.message}`);
    
    // Send to external monitoring systems
    if (alertWebhook) {
      await sendAlertToWebhook(alertWebhook, alert);
    }
    
    // Log to structured logging system
    await logAlert(alert);
    
    // For critical alerts, also send to pager
    if (alert.severity === 'critical') {
      await sendToPagerDuty(alert);
    }
  });

  monitor.on('alertAcknowledged', (alert: Alert) => {
    console.log(`✅ Alert acknowledged: ${alert.id}`);
  });

  monitor.on('alertResolved', (alert: Alert) => {
    console.log(`✅ Alert resolved: ${alert.id}`);
  });

  await monitor.initialize();
  
  return monitor;
}

// ========================================
// CUSTOM CONFIGURATION EXAMPLES
// ========================================

/**
 * High-frequency trading system monitoring with very strict thresholds
 */
export async function setupHighFrequencyMonitoring(pool: Pool): Promise<PerformanceMonitoringService> {
  const strictConfig: MonitoringConfiguration = {
    enabled: true,
    samplingIntervalMs: 5000, // Check every 5 seconds
    alertThresholds: {
      slowQueryTimeMs: 100, // 100ms is considered slow
      cacheHitRatioMin: 99.5, // 99.5% cache hit ratio minimum
      cpuUsageMaxPercent: 60, // Keep CPU under 60%
      memoryUsageMaxPercent: 70, // Keep memory under 70%
      diskUsageMaxPercent: 80,
      connectionUtilizationMax: 50, // Conservative connection usage
      errorRateMax: 0.1 // Very low error tolerance
    },
    retention: {
      queryMetricsDays: 90, // Longer retention for analysis
      resourceMetricsDays: 90,
      alertsDays: 180,
      reportsDays: 365
    },
    notifications: {
      email: true,
      slack: true,
      webhook: 'https://api.pagerduty.com/integration_keys/your-key'
    }
  };

  const monitor = new PerformanceMonitoringService(pool, strictConfig);

  // Set up specialized alerting for trading systems
  monitor.on('alert', async (alert: Alert) => {
    if (alert.metric === 'slow_queries' && alert.currentValue > 0) {
      // Any slow query in trading system is critical
      console.error(`🚨 TRADING SYSTEM ALERT: Slow query detected - this could impact trades!`);
      await notifyTradingTeam(alert);
    }
  });

  await monitor.initialize();
  return monitor;
}

/**
 * Analytics/Data Warehouse monitoring with different priorities
 */
export async function setupAnalyticsMonitoring(pool: Pool): Promise<PerformanceMonitoringService> {
  const analyticsConfig: MonitoringConfiguration = {
    enabled: true,
    samplingIntervalMs: 120000, // Check every 2 minutes (less frequent)
    alertThresholds: {
      slowQueryTimeMs: 30000, // 30 seconds is acceptable for analytics
      cacheHitRatioMin: 85, // Lower cache requirements
      cpuUsageMaxPercent: 95, // Can use more CPU for batch processing
      memoryUsageMaxPercent: 95, // Can use more memory
      diskUsageMaxPercent: 85,
      connectionUtilizationMax: 90, // Higher connection usage OK
      errorRateMax: 2 // Higher error tolerance
    },
    retention: {
      queryMetricsDays: 180, // Longer retention for trend analysis
      resourceMetricsDays: 180,
      alertsDays: 90,
      reportsDays: 730 // 2 years of reports
    },
    notifications: {
      email: true,
      slack: false // Less noisy for analytics
    }
  };

  const monitor = new PerformanceMonitoringService(pool, analyticsConfig);

  // Focus on long-term trends rather than immediate alerts
  monitor.on('alert', (alert: Alert) => {
    if (alert.severity === 'critical') {
      console.warn(`📊 Analytics Alert: ${alert.message}`);
    }
  });

  await monitor.initialize();
  return monitor;
}

// ========================================
// REPORTING EXAMPLES
// ========================================

/**
 * Generate daily performance reports
 */
export async function generateDailyReport(monitor: PerformanceMonitoringService): Promise<void> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

  const report = await monitor.generatePerformanceReport(startDate, endDate, true);

  console.log(`📊 Daily Performance Report - ${report.reportId}`);
  console.log(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`Total Queries: ${report.summary.totalQueries}`);
  console.log(`Average Query Time: ${report.summary.avgQueryTime.toFixed(2)}ms`);
  console.log(`Slowest Query: ${report.summary.slowestQuery.mean_time?.toFixed(2)}ms`);
  console.log(`Error Count: ${report.summary.errorCount}`);
  console.log(`System Uptime: ${report.summary.uptime}%`);

  // Print top slow queries
  console.log('\n🐌 Top 5 Slowest Queries:');
  report.queryAnalysis.topSlowQueries.slice(0, 5).forEach((query, index) => {
    console.log(`${index + 1}. ${query.mean_time.toFixed(2)}ms - ${query.calls} calls`);
    console.log(`   Query: ${query.query_text.substring(0, 100)}...`);
  });

  // Print recommendations
  if (report.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });
  }

  // Print anomalies
  if (report.anomalies.length > 0) {
    console.log('\n⚠️ Anomalies Detected:');
    report.anomalies.forEach((anomaly, index) => {
      console.log(`${index + 1}. ${anomaly.type}: ${anomaly.description}`);
      console.log(`   Impact: ${anomaly.impact}, Recommendation: ${anomaly.recommendation}`);
    });
  }
}

/**
 * Generate weekly trend analysis
 */
export async function generateWeeklyTrendReport(monitor: PerformanceMonitoringService): Promise<void> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

  const report = await monitor.generatePerformanceReport(startDate, endDate, true);

  console.log(`📈 Weekly Trend Report - ${report.reportId}`);
  
  // Analyze resource trends
  const connectionTrends = report.resourceAnalysis.connectionTrends;
  if (connectionTrends.length > 0) {
    const maxConnections = Math.max(...connectionTrends.map(t => t.count));
    const minConnections = Math.min(...connectionTrends.map(t => t.count));
    const avgConnections = connectionTrends.reduce((sum, t) => sum + t.count, 0) / connectionTrends.length;

    console.log(`\n🔗 Connection Usage Trends:`);
    console.log(`   Average: ${avgConnections.toFixed(1)} connections`);
    console.log(`   Peak: ${maxConnections} connections`);
    console.log(`   Minimum: ${minConnections} connections`);
  }

  // Analyze disk growth
  if (report.resourceAnalysis.diskGrowth > 0) {
    const growthMB = report.resourceAnalysis.diskGrowth / (1024 * 1024);
    console.log(`\n💾 Disk Usage Growth: ${growthMB.toFixed(2)} MB this week`);
    
    if (growthMB > 1000) {
      console.log(`   ⚠️ High disk growth detected - consider cleanup or scaling`);
    }
  }

  // Query pattern analysis
  console.log('\n🔍 Query Pattern Analysis:');
  report.queryAnalysis.queryPatterns.slice(0, 5).forEach((pattern, index) => {
    console.log(`${index + 1}. ${pattern.count} queries matching pattern (avg: ${pattern.avgTime.toFixed(2)}ms)`);
    console.log(`   Pattern: ${pattern.pattern.substring(0, 80)}...`);
  });
}

// ========================================
// ALERT MANAGEMENT EXAMPLES
// ========================================

/**
 * Dashboard for managing alerts
 */
export class AlertDashboard {
  private monitor: PerformanceMonitoringService;

  constructor(monitor: PerformanceMonitoringService) {
    this.monitor = monitor;
  }

  /**
   * Get current active alerts
   */
  getActiveAlerts(): Alert[] {
    const metrics = this.monitor.getCurrentMetrics();
    return metrics.alerts.filter(alert => !alert.acknowledged && !alert.resolvedAt);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: Alert['severity']): Alert[] {
    const metrics = this.monitor.getCurrentMetrics();
    return metrics.alerts.filter(alert => alert.severity === severity);
  }

  /**
   * Bulk acknowledge alerts by metric type
   */
  async acknowledgeAlertsByMetric(metric: string, acknowledgedBy: string): Promise<void> {
    const alerts = this.getActiveAlerts().filter(alert => alert.metric === metric);
    
    for (const alert of alerts) {
      await this.monitor.acknowledgeAlert(alert.id, acknowledgedBy);
      console.log(`✅ Acknowledged alert ${alert.id} for metric ${metric}`);
    }
  }

  /**
   * Auto-resolve alerts that are no longer relevant
   */
  async autoResolveStaleAlerts(resolvedBy: string = 'system'): Promise<void> {
    const currentMetrics = this.monitor.getCurrentMetrics();
    const activeAlerts = this.getActiveAlerts();

    for (const alert of activeAlerts) {
      let shouldResolve = false;

      // Check if alert condition is no longer met
      switch (alert.metric) {
        case 'slow_queries':
          if (currentMetrics.queryStats.slow_queries === 0) {
            shouldResolve = true;
          }
          break;
        case 'cache_hit_ratio':
          if (currentMetrics.queryStats.cache_hit_ratio >= alert.threshold) {
            shouldResolve = true;
          }
          break;
        case 'cpu_usage':
          if (currentMetrics.resources.cpu_usage < alert.threshold) {
            shouldResolve = true;
          }
          break;
      }

      if (shouldResolve) {
        await this.monitor.resolveAlert(alert.id, resolvedBy);
        console.log(`🔧 Auto-resolved alert ${alert.id} for ${alert.metric}`);
      }
    }
  }

  /**
   * Print alert summary
   */
  printAlertSummary(): void {
    const critical = this.getAlertsBySeverity('critical');
    const errors = this.getAlertsBySeverity('error');
    const warnings = this.getAlertsBySeverity('warning');
    const info = this.getAlertsBySeverity('info');

    console.log('\n🚨 Alert Summary:');
    console.log(`   Critical: ${critical.length}`);
    console.log(`   Error: ${errors.length}`);
    console.log(`   Warning: ${warnings.length}`);
    console.log(`   Info: ${info.length}`);

    if (critical.length > 0) {
      console.log('\n🔴 Critical Alerts:');
      critical.forEach(alert => {
        console.log(`   - ${alert.message} (${alert.timestamp.toLocaleString()})`);
      });
    }
  }
}

// ========================================
// MONITORING LIFECYCLE EXAMPLES
// ========================================

/**
 * Complete application monitoring setup
 */
class ApplicationMonitoringManager {
  private monitor: PerformanceMonitoringService;
  private alertDashboard: AlertDashboard;
  private isShuttingDown: boolean = false;

  constructor(pool: Pool, environment: 'development' | 'production' | 'analytics') {
    // Create appropriate monitor for environment
    switch (environment) {
      case 'development':
        this.monitor = PerformanceMonitoringFactory.createDevelopmentMonitor(pool);
        break;
      case 'production':
        this.monitor = PerformanceMonitoringFactory.createProductionMonitor(pool);
        break;
      case 'analytics':
        // For analytics, we'll use a custom config instead of the async function
        this.monitor = PerformanceMonitoringFactory.createPerformanceMonitor(pool, {
          samplingIntervalMs: 120000,
          alertThresholds: {
            slowQueryTimeMs: 30000,
            cacheHitRatioMin: 85,
            cpuUsageMaxPercent: 95,
            memoryUsageMaxPercent: 95,
            diskUsageMaxPercent: 85,
            connectionUtilizationMax: 90,
            errorRateMax: 2
          },
          retention: {
            queryMetricsDays: 180,
            resourceMetricsDays: 180,
            alertsDays: 90,
            reportsDays: 730
          },
          notifications: {
            email: true,
            slack: false
          }
        });
        break;
      default:
        this.monitor = PerformanceMonitoringFactory.createPerformanceMonitor(pool);
    }

    this.alertDashboard = new AlertDashboard(this.monitor);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle graceful shutdown
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());

    // Setup monitoring event handlers
    this.monitor.on('monitoringStarted', () => {
      console.log('🎯 Performance monitoring system started');
    });

    this.monitor.on('monitoringStopped', () => {
      console.log('⏹️ Performance monitoring system stopped');
    });

    this.monitor.on('monitoringError', (error) => {
      console.error('💥 Monitoring system error:', error);
    });
  }

  async start(): Promise<void> {
    console.log('🚀 Starting application monitoring...');
    
    await this.monitor.initialize();
    
    // Setup periodic reporting
    this.setupPeriodicReporting();
    
    // Setup alert management
    this.setupAlertManagement();
    
    console.log('✅ Application monitoring started successfully');
  }

  private setupPeriodicReporting(): void {
    // Daily reports at 9 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 9 && now.getMinutes() === 0) {
        await generateDailyReport(this.monitor);
      }
    }, 60000); // Check every minute

    // Weekly reports on Monday at 9 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() === 0) {
        await generateWeeklyTrendReport(this.monitor);
      }
    }, 60000);
  }

  private setupAlertManagement(): void {
    // Auto-resolve stale alerts every 10 minutes
    setInterval(async () => {
      if (!this.isShuttingDown) {
        await this.alertDashboard.autoResolveStaleAlerts();
      }
    }, 10 * 60 * 1000);

    // Print alert summary every hour
    setInterval(() => {
      if (!this.isShuttingDown) {
        this.alertDashboard.printAlertSummary();
      }
    }, 60 * 60 * 1000);
  }

  async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    console.log('🛑 Gracefully shutting down monitoring system...');
    this.isShuttingDown = true;
    
    // Stop monitoring
    this.monitor.stopMonitoring();
    
    // Generate final report
    console.log('📊 Generating final performance report...');
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    
    try {
      await generateDailyReport(this.monitor);
    } catch (error) {
      console.error('Error generating final report:', error);
    }
    
    console.log('✅ Monitoring system shutdown complete');
    process.exit(0);
  }

  getMonitor(): PerformanceMonitoringService {
    return this.monitor;
  }

  getAlertDashboard(): AlertDashboard {
    return this.alertDashboard;
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

async function sendAlertToWebhook(webhook: string, alert: Alert): Promise<void> {
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'performance_alert',
        alert: {
          id: alert.id,
          severity: alert.severity,
          metric: alert.metric,
          message: alert.message,
          current_value: alert.currentValue,
          threshold: alert.threshold,
          timestamp: alert.timestamp.toISOString()
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send alert to webhook:', error);
  }
}

async function logAlert(alert: Alert): Promise<void> {
  // Structured logging for production systems
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: alert.severity,
    type: 'performance_alert',
    metric: alert.metric,
    message: alert.message,
    current_value: alert.currentValue,
    threshold: alert.threshold,
    alert_id: alert.id
  };

  console.log(JSON.stringify(logEntry));
}

async function sendToPagerDuty(alert: Alert): Promise<void> {
  // Mock PagerDuty integration
  console.log(`📟 PAGERDUTY: Critical alert - ${alert.message}`);
  // In real implementation, use PagerDuty API
}

async function notifyTradingTeam(alert: Alert): Promise<void> {
  // Mock trading team notification
  console.log(`📞 TRADING TEAM ALERT: ${alert.message}`);
  // In real implementation, send to trading team notification system
}

// ========================================
// USAGE EXAMPLE
// ========================================

/**
 * Example of how to use the monitoring system in your application
 */
export async function exampleUsage(): Promise<void> {
  // Create database pool
  const pool = new Pool({
    host: 'localhost',
    database: 'poker_game',
    user: 'postgres',
    password: 'password',
    port: 5432,
    max: 20
  });

  // Setup monitoring manager
  const monitoringManager = new ApplicationMonitoringManager(pool, 'production');
  
  // Start monitoring
  await monitoringManager.start();

  // Get access to monitoring services
  const monitor = monitoringManager.getMonitor();
  const dashboard = monitoringManager.getAlertDashboard();

  // Manual operations examples
  setTimeout(async () => {
    // Generate an on-demand report
    console.log('📊 Generating on-demand performance report...');
    await generateDailyReport(monitor);

    // Check alert status
    dashboard.printAlertSummary();

    // Acknowledge all warning alerts
    await dashboard.acknowledgeAlertsByMetric('slow_queries', 'admin-user');
  }, 5000);

  // The monitoring system will continue running until the application shuts down
  console.log('🎯 Monitoring system is now active and will continue until shutdown...');
}

// Export main classes for use in application
export { ApplicationMonitoringManager };
