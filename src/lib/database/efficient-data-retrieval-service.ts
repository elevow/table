/**
 * US-011: Efficient Data Retrieval Service
 * 
 * Main service that coordinates all data access optimization components:
 * - Data Access Optimizer
 * - Database Performance Monitor  
 * - Query Optimization Service
 * - Concurrent Access Management
 */

import { DatabasePool, DatabaseClient } from './database-connection';
import { DataAccessOptimizer, DataAccessOptimizerFactory, DataAccessConfig } from './data-access-optimizer';
import { DatabasePerformanceMonitor, DatabasePerformanceMonitorFactory, MonitoringConfig } from './database-performance-monitor';
import { QueryOptimizationService, QueryOptimizationServiceFactory } from './query-optimization-service';

export interface EfficientDataRetrievalConfig {
  dataAccess?: Partial<DataAccessConfig>;
  monitoring?: Partial<MonitoringConfig>;
  optimization: {
    enableQueryAnalysis: boolean;
    enablePerformanceMonitoring: boolean;
    enableAutomaticOptimization: boolean;
    optimizationInterval: number; // minutes
  };
}

export interface DataRetrievalMetrics {
  performance: {
    averageQueryTime: number;
    cacheHitRatio: number;
    slowQueries: number;
    totalQueries: number;
  };
  optimization: {
    suggestedIndexes: number;
    materializedViewCandidates: number;
    queryRewrites: number;
  };
  alerts: {
    active: number;
    critical: number;
  };
  trends: {
    performanceImprovement: number;
    efficiencyGain: number;
  };
}

/**
 * Comprehensive data retrieval optimization service
 * Implements US-011 requirements for efficient data access patterns
 */
export class EfficientDataRetrievalService {
  private dataAccessOptimizer!: DataAccessOptimizer;
  private performanceMonitor!: DatabasePerformanceMonitor;
  private queryOptimizer!: QueryOptimizationService;
  private optimizationInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    private dbPool: DatabasePool,
    private config: EfficientDataRetrievalConfig
  ) {
    this.initializeComponents();
  }

  /**
   * Initialize all optimization components
   */
  private initializeComponents(): void {
    this.dataAccessOptimizer = DataAccessOptimizerFactory.create(
      this.dbPool,
      this.config.dataAccess
    );

    this.performanceMonitor = DatabasePerformanceMonitorFactory.create(
      this.dbPool,
      this.config.monitoring
    );

    this.queryOptimizer = QueryOptimizationServiceFactory.create(this.dbPool);

    // Start automatic optimization if enabled
    if (this.config.optimization.enableAutomaticOptimization) {
      this.startAutomaticOptimization();
    }

    this.isInitialized = true;
  }

  /**
   * Execute optimized query with comprehensive monitoring and caching
   */
  async executeOptimizedQuery<T = any>(
    sql: string,
    params: any[] = [],
    options?: {
      useCache?: boolean;
      cacheTtl?: number;
      enableOptimization?: boolean;
    }
  ): Promise<{
    rows: T[];
    metrics: {
      executionTime: number;
      fromCache: boolean;
      optimized: boolean;
      warnings: string[];
    };
  }> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const startTime = Date.now();
    let optimizedSql = sql;
    let warnings: string[] = [];

    try {
      // Optimize query if enabled
      if (options?.enableOptimization !== false && this.config.optimization.enableQueryAnalysis) {
        const optimization = await this.queryOptimizer.optimizeQueryBeforeExecution(sql);
        optimizedSql = optimization.optimizedQuery;
        warnings = optimization.warnings;
      }

      // Execute with data access optimizer
      const result = await this.dataAccessOptimizer.executeQuery<T>(
        optimizedSql,
        params,
        {
          indexing: [],
          partitioning: 'range',
          materializedViews: [],
          useCache: options?.useCache,
          cacheTtl: options?.cacheTtl
        }
      );

      const executionTime = Date.now() - startTime;

      // Record execution for monitoring and optimization
      this.recordQueryExecution(sql, executionTime, true);

      return {
        rows: result.rows,
        metrics: {
          executionTime: result.metrics.executionTime,
          fromCache: result.fromCache,
          optimized: optimizedSql !== sql,
          warnings
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.recordQueryExecution(sql, executionTime, false, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Execute transaction with optimized concurrent access control
   */
  async executeOptimizedTransaction<T>(
    operations: ((client: DatabaseClient) => Promise<T>)[]
  ): Promise<T[]> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const startTime = Date.now();

    try {
      const results = await this.dataAccessOptimizer.executeTransaction(operations);
      const executionTime = Date.now() - startTime;

      // Record transaction metrics
      this.performanceMonitor.recordQueryExecution(
        'TRANSACTION',
        executionTime,
        true
      );

      return results;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.performanceMonitor.recordQueryExecution(
        'TRANSACTION',
        executionTime,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Get comprehensive performance metrics
   */
  getMetrics(): DataRetrievalMetrics {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const performanceMetrics = this.dataAccessOptimizer.getPerformanceMetrics();
    const dbMetrics = this.performanceMonitor.getCurrentMetrics();
    const alerts = this.performanceMonitor.getActiveAlerts();

    return {
      performance: {
        averageQueryTime: performanceMetrics.averageExecutionTime,
        cacheHitRatio: performanceMetrics.cacheHitRatio,
        slowQueries: performanceMetrics.slowQueries,
        totalQueries: performanceMetrics.totalQueries
      },
      optimization: {
        suggestedIndexes: 0, // Will be populated by optimization analysis
        materializedViewCandidates: 0,
        queryRewrites: 0
      },
      alerts: {
        active: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length
      },
      trends: {
        performanceImprovement: this.calculatePerformanceImprovement(),
        efficiencyGain: this.calculateEfficiencyGain()
      }
    };
  }

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations(): Promise<{
    dataAccess: {
      slowQueries: any[];
      indexRecommendations: string[];
      cacheEfficiency: number;
      suggestions: string[];
    };
    database: {
      indexRecommendations: string[];
      queryOptimizations: string[];
      configurationTuning: string[];
      resourceRecommendations: string[];
    };
    strategy: any;
  }> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const [dataAccessRecs, dbRecs, strategy] = await Promise.all([
      this.dataAccessOptimizer.getOptimizationRecommendations(),
      this.performanceMonitor.getPerformanceRecommendations(),
      this.queryOptimizer.generateOptimizationStrategy()
    ]);

    return {
      dataAccess: dataAccessRecs,
      database: dbRecs,
      strategy
    };
  }

  /**
   * Get real-time performance dashboard data
   */
  async getDashboardData(): Promise<{
    currentMetrics: any;
    alerts: any[];
    topSlowQueries: any[];
    recentTrends: any;
    optimizationStatus: {
      lastOptimization: Date;
      nextOptimization: Date;
      pendingOptimizations: number;
    };
  }> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const currentMetrics = this.performanceMonitor.getCurrentMetrics();
    const alerts = this.performanceMonitor.getActiveAlerts();
    const mvCandidates = await this.queryOptimizer.identifyMaterializedViewCandidates();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const trends = this.performanceMonitor.getPerformanceTrends({
      start: oneHourAgo,
      end: now
    });

    return {
      currentMetrics,
      alerts,
      topSlowQueries: mvCandidates.slice(0, 10),
      recentTrends: trends,
      optimizationStatus: {
        lastOptimization: new Date(), // Mock data
        nextOptimization: new Date(Date.now() + this.config.optimization.optimizationInterval * 60000),
        pendingOptimizations: alerts.length
      }
    };
  }

  /**
   * Invalidate cache for specific patterns
   */
  async invalidateCache(patterns: string[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    await this.dataAccessOptimizer.invalidateCache(patterns);
  }

  /**
   * Force optimization analysis
   */
  async runOptimizationAnalysis(): Promise<{
    completed: boolean;
    recommendations: number;
    estimatedImprovement: number;
  }> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      const strategy = await this.queryOptimizer.generateOptimizationStrategy();
      const recommendations = 
        strategy.indexing.newIndexes.length +
        strategy.materializedViews.length +
        strategy.queryRewrite.length;

      return {
        completed: true,
        recommendations,
        estimatedImprovement: Math.min(recommendations * 10, 50) // Rough estimate
      };

    } catch (error) {
      return {
        completed: false,
        recommendations: 0,
        estimatedImprovement: 0
      };
    }
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics(format: 'prometheus' | 'json' | 'csv' = 'json'): any {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    const exported = this.performanceMonitor.exportMetrics();
    const dataAccessMetrics = this.dataAccessOptimizer.getPerformanceMetrics();

    const combined = {
      timestamp: new Date().toISOString(),
      dataAccess: dataAccessMetrics,
      database: exported.json
    };

    switch (format) {
      case 'prometheus':
        return this.formatPrometheusMetrics(combined);
      case 'csv':
        return this.formatCsvMetrics(combined);
      default:
        return combined;
    }
  }

  /**
   * Cleanup resources and stop monitoring
   */
  async cleanup(): Promise<void> {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    if (this.isInitialized) {
      this.performanceMonitor.stopMonitoring();
      this.performanceMonitor.cleanup();
      this.dataAccessOptimizer.cleanup();
      this.queryOptimizer.clearCache();
    }

    this.isInitialized = false;
  }

  // Private methods

  private recordQueryExecution(
    sql: string,
    executionTime: number,
    success: boolean,
    error?: string
  ): void {
    if (this.config.optimization.enablePerformanceMonitoring) {
      this.performanceMonitor.recordQueryExecution(sql, executionTime, success, error);
    }

    if (this.config.optimization.enableQueryAnalysis) {
      this.queryOptimizer.recordQueryExecution(sql, executionTime);
    }
  }

  private startAutomaticOptimization(): void {
    if (this.optimizationInterval) return;

    const intervalMs = this.config.optimization.optimizationInterval * 60 * 1000;
    
    this.optimizationInterval = setInterval(async () => {
      try {
        await this.runAutomaticOptimization();
      } catch (error) {
        console.error('Automatic optimization failed:', error);
      }
    }, intervalMs);
  }

  private async runAutomaticOptimization(): Promise<void> {
    // Get current recommendations
    const recommendations = await this.getOptimizationRecommendations();
    
    // Log recommendations for manual review (skip in CI)
    if (!process.env.CI) {
      // eslint-disable-next-line no-console
      console.log('Optimization recommendations generated:', {
        dataAccess: recommendations.dataAccess.suggestions.length,
        database: recommendations.database.indexRecommendations.length,
        strategy: Object.keys(recommendations.strategy).length
      });
    }

    // Clear caches to free up memory
    this.dataAccessOptimizer.cleanup();
    this.queryOptimizer.clearCache();
  }

  private calculatePerformanceImprovement(): number {
    // Mock calculation - in real implementation would track historical data
    const metrics = this.dataAccessOptimizer.getPerformanceMetrics();
    const baseline = 1000; // Baseline average execution time
    
    if (metrics.averageExecutionTime < baseline) {
      return ((baseline - metrics.averageExecutionTime) / baseline) * 100;
    }
    
    return 0;
  }

  private calculateEfficiencyGain(): number {
    // Mock calculation based on cache hit ratio
    const metrics = this.dataAccessOptimizer.getPerformanceMetrics();
    return Math.max(0, metrics.cacheHitRatio - 50); // Assume 50% baseline
  }

  private formatPrometheusMetrics(metrics: any): string {
    const lines: string[] = [];
    
    lines.push(`# HELP data_access_average_execution_time Average query execution time`);
    lines.push(`# TYPE data_access_average_execution_time gauge`);
    lines.push(`data_access_average_execution_time ${metrics.dataAccess.averageExecutionTime}`);
    
    lines.push(`# HELP data_access_cache_hit_ratio Cache hit ratio percentage`);
    lines.push(`# TYPE data_access_cache_hit_ratio gauge`);
    lines.push(`data_access_cache_hit_ratio ${metrics.dataAccess.cacheHitRatio}`);
    
    lines.push(`# HELP data_access_total_queries Total queries executed`);
    lines.push(`# TYPE data_access_total_queries counter`);
    lines.push(`data_access_total_queries ${metrics.dataAccess.totalQueries}`);
    
    return lines.join('\n');
  }

  private formatCsvMetrics(metrics: any): string {
    const headers = [
      'timestamp',
      'avg_execution_time',
      'cache_hit_ratio',
      'total_queries',
      'slow_queries'
    ];
    
    const values = [
      metrics.timestamp,
      metrics.dataAccess.averageExecutionTime,
      metrics.dataAccess.cacheHitRatio,
      metrics.dataAccess.totalQueries,
      metrics.dataAccess.slowQueries
    ];
    
    return `${headers.join(',')}\n${values.join(',')}`;
  }
}

/**
 * Factory for creating efficient data retrieval service instances
 */
export class EfficientDataRetrievalServiceFactory {
  static create(
    dbPool: DatabasePool,
    config?: Partial<EfficientDataRetrievalConfig>
  ): EfficientDataRetrievalService {
    const defaultConfig: EfficientDataRetrievalConfig = {
      optimization: {
        enableQueryAnalysis: true,
        enablePerformanceMonitoring: true,
        enableAutomaticOptimization: true,
        optimizationInterval: 60 // 1 hour
      }
    };
    
    const mergedConfig = {
      ...defaultConfig,
      ...config,
      optimization: {
        ...defaultConfig.optimization,
        ...config?.optimization
      }
    };
    
    return new EfficientDataRetrievalService(dbPool, mergedConfig);
  }
}
