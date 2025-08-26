/**
 * US-011: Efficient Data Retrieval
 * 
 * Implements comprehensive data access optimization strategies including:
 * - Intelligent caching with configurable strategies
 * - Query optimization and performance monitoring
 * - Concurrent access management
 * - Performance metrics collection
 */

import { DatabaseClient, DatabasePool } from './database-connection';
import { getCacheManager, CacheConfig, InvalidationRule } from '../../utils/cache-manager';

export type CacheStrategy = 'write-through' | 'write-behind' | 'write-around' | 'cache-aside';
export type PartitionStrategy = 'range' | 'hash' | 'list' | 'composite';

export interface QueryOptimization {
  indexing: string[];
  partitioning: PartitionStrategy;
  materializedViews: string[];
  hints?: string[];
  estimatedRows?: number;
  useCache?: boolean;
  cacheTtl?: number;
}

export interface DataAccessConfig {
  cache: {
    strategy: CacheStrategy;
    ttl: number;
    maxSize: number;
    invalidationRules: InvalidationRule[];
    namespace: string;
  };
  performance: {
    slowQueryThreshold: number;
    maxConcurrentQueries: number;
    connectionPoolSize: number;
    queryTimeout: number;
  };
  optimization: {
    enableQueryCache: boolean;
    enableResultCache: boolean;
    enablePreparedStatements: boolean;
    enableQueryPlanning: boolean;
  };
}

export interface QueryMetrics {
  query: string;
  executionTime: number;
  rowsReturned: number;
  cacheHit: boolean;
  timestamp: Date;
  parameters?: any[];
  indexesUsed?: string[];
  planCost?: number;
}

export interface PerformanceMetrics {
  totalQueries: number;
  averageExecutionTime: number;
  cacheHitRatio: number;
  slowQueries: number;
  concurrentQueries: number;
  connectionPoolUtilization: number;
  indexEfficiency: Map<string, number>;
  queryPatterns: Map<string, number>;
}

export interface ConcurrencyConfig {
  maxConcurrentReads: number;
  maxConcurrentWrites: number;
  lockTimeout: number;
  deadlockRetries: number;
  transactionIsolation: 'read_committed' | 'repeatable_read' | 'serializable';
}

/**
 * Main data access optimization manager
 * Coordinates caching, query optimization, and performance monitoring
 */
export class DataAccessOptimizer {
  private cacheManager = getCacheManager();
  private queryMetrics: QueryMetrics[] = [];
  private performanceMetrics: PerformanceMetrics = this.initializePerformanceMetrics();
  private activeQueries = new Map<string, Date>();
  private preparedStatements = new Map<string, string>();
  private queryPlanCache = new Map<string, any>();
  private connectionSemaphore: number = 0;
  private readonly maxMetricsHistory = 10000;

  constructor(
    private dbPool: DatabasePool,
    private config: DataAccessConfig
  ) {
    this.setupCacheConfig();
  }

  /**
   * Execute optimized query with caching, monitoring, and concurrent access management
   */
  async executeQuery<T = any>(
    sql: string,
    params: any[] = [],
    optimization?: QueryOptimization
  ): Promise<{ rows: T[]; fromCache: boolean; metrics: QueryMetrics }> {
    const queryId = this.generateQueryId(sql, params);
    const startTime = Date.now();
    
    try {
      // Check cache first if enabled
      if (this.shouldUseCache(sql, optimization)) {
        const cached = await this.getCachedResult<T>(queryId);
        if (cached) {
          const metrics = this.createQueryMetrics(sql, 0, cached.rows.length, true, params);
          return { rows: cached.rows, fromCache: true, metrics };
        }
      }

      // Acquire connection with concurrency control
      await this.acquireConnection();
      const client = await this.dbPool.connect();
      
      try {
        // Track active query
        this.activeQueries.set(queryId, new Date());
        
        // Apply query optimization
        const optimizedSql = await this.optimizeQuery(sql, optimization);
        
        // Execute query
        const result = await this.executeWithTimeout(client, optimizedSql, params);
        const executionTime = Date.now() - startTime;
        
        // Cache result if applicable
        if (this.shouldCacheResult(sql, result.rows.length, optimization)) {
          await this.cacheResult(queryId, result.rows, optimization?.cacheTtl);
        }
        
        // Record metrics
        const metrics = this.createQueryMetrics(
          sql, 
          executionTime, 
          result.rowCount || 0, 
          false, 
          params
        );
        this.recordQueryMetrics(metrics);
        
        return { rows: result.rows, fromCache: false, metrics };
        
      } finally {
        client.release();
        this.releaseConnection();
        this.activeQueries.delete(queryId);
      }
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const metrics = this.createQueryMetrics(sql, executionTime, 0, false, params);
      this.recordQueryMetrics(metrics);
      throw error;
    }
  }

  /**
   * Execute transaction with optimized concurrent access control
   */
  async executeTransaction<T>(
    operations: ((client: DatabaseClient) => Promise<T>)[]
  ): Promise<T[]> {
    await this.acquireConnection();
    const client = await this.dbPool.connect();
    
    try {
      await client.query('BEGIN');
      
      const results: T[] = [];
      for (const operation of operations) {
        const result = await operation(client);
        results.push(result);
      }
      
      await client.query('COMMIT');
      return results;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      this.releaseConnection();
    }
  }

  /**
   * Invalidate cached queries based on table/pattern changes
   */
  async invalidateCache(patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      await this.cacheManager.invalidate(pattern);
    }
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    this.updatePerformanceMetrics();
    return { ...this.performanceMetrics };
  }

  /**
   * Get query optimization recommendations
   */
  async getOptimizationRecommendations(): Promise<{
    slowQueries: QueryMetrics[];
    indexRecommendations: string[];
    cacheEfficiency: number;
    suggestions: string[];
  }> {
    const recentMetrics = this.queryMetrics.slice(-1000);
    const slowQueries = recentMetrics
      .filter(m => m.executionTime > this.config.performance.slowQueryThreshold)
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    const indexRecommendations = this.generateIndexRecommendations(recentMetrics);
    const cacheEfficiency = this.calculateCacheEfficiency();
    const suggestions = this.generateOptimizationSuggestions(recentMetrics);

    return {
      slowQueries,
      indexRecommendations,
      cacheEfficiency,
      suggestions
    };
  }

  /**
   * Cleanup old metrics and optimize memory usage
   */
  cleanup(): void {
    // Keep only recent metrics
    if (this.queryMetrics.length > this.maxMetricsHistory) {
      this.queryMetrics = this.queryMetrics.slice(-this.maxMetricsHistory);
    }
    
    // Clear old query plans
    this.queryPlanCache.clear();
    
    // Clear expired prepared statements
    this.preparedStatements.clear();
  }

  // Private methods

  private initializePerformanceMetrics(): PerformanceMetrics {
    return {
      totalQueries: 0,
      averageExecutionTime: 0,
      cacheHitRatio: 0,
      slowQueries: 0,
      concurrentQueries: 0,
      connectionPoolUtilization: 0,
      indexEfficiency: new Map(),
      queryPatterns: new Map()
    };
  }

  private setupCacheConfig(): void {
    const cacheConfig: CacheConfig = {
      storage: 'memory',
      ttl: this.config.cache.ttl,
      maxSize: this.config.cache.maxSize,
      invalidationRules: this.config.cache.invalidationRules,
      namespace: this.config.cache.namespace
    };
    
    this.cacheManager.configure('queries', cacheConfig);
  }

  private generateQueryId(sql: string, params: any[]): string {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const paramHash = JSON.stringify(params);
    return `${normalizedSql}_${paramHash}`;
  }

  private shouldUseCache(sql: string, optimization?: QueryOptimization): boolean {
    if (!this.config.optimization.enableQueryCache) return false;
    if (optimization?.useCache === false) return false;
    
    // Don't cache writes
    const writeKeywords = ['insert', 'update', 'delete', 'create', 'drop', 'alter'];
    const sqlLower = sql.toLowerCase().trim();
    return !writeKeywords.some(keyword => sqlLower.startsWith(keyword));
  }

  private async getCachedResult<T>(queryId: string): Promise<{ rows: T[] } | null> {
    try {
  const cached = await this.cacheManager.get<{ rows: T[] }>('queries', queryId);
  if (cached) return cached;
      return null;
    } catch {
      return null;
    }
  }

  private shouldCacheResult(sql: string, rowCount: number, optimization?: QueryOptimization): boolean {
    if (!this.config.optimization.enableResultCache) return false;
    if (optimization?.useCache === false) return false;
    if (rowCount > 1000) return false; // Don't cache large results
    
    return this.shouldUseCache(sql, optimization);
  }

  private async cacheResult(queryId: string, rows: any[], ttl?: number): Promise<void> {
    const cacheTtl = ttl || this.config.cache.ttl;
    try {
  await this.cacheManager.set('queries', queryId, { rows }, { ttl: cacheTtl, tags: ['db', 'query'] });
    } catch {
      // Silently fail if cache is unavailable
    }
  }

  private async optimizeQuery(sql: string, optimization?: QueryOptimization): Promise<string> {
    if (!optimization || !this.config.optimization.enableQueryPlanning) {
      return sql;
    }

    let optimizedSql = sql;
    
    // Add query hints if provided
    if (optimization.hints && optimization.hints.length > 0) {
      optimizedSql += ` /* ${optimization.hints.join(', ')} */`;
    }
    
    return optimizedSql;
  }

  private async executeWithTimeout(
    client: DatabaseClient, 
    sql: string, 
    params: any[]
  ): Promise<{ rows: any[]; rowCount: number }> {
    const timeout = this.config.performance.queryTimeout;
    
    return Promise.race([
      client.query(sql, params),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), timeout)
      )
    ]);
  }

  private async acquireConnection(): Promise<void> {
    while (this.connectionSemaphore >= this.config.performance.maxConcurrentQueries) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.connectionSemaphore++;
  }

  private releaseConnection(): void {
    this.connectionSemaphore = Math.max(0, this.connectionSemaphore - 1);
  }

  private createQueryMetrics(
    query: string,
    executionTime: number,
    rowsReturned: number,
    cacheHit: boolean,
    parameters?: any[]
  ): QueryMetrics {
    return {
      query: query.substring(0, 200), // Truncate for storage
      executionTime,
      rowsReturned,
      cacheHit,
      timestamp: new Date(),
      parameters: parameters?.slice(0, 10), // Limit parameter logging
    };
  }

  private recordQueryMetrics(metrics: QueryMetrics): void {
    this.queryMetrics.push(metrics);
    
    // Update performance counters
    this.performanceMetrics.totalQueries++;
    if (metrics.executionTime > this.config.performance.slowQueryThreshold) {
      this.performanceMetrics.slowQueries++;
    }
    
    // Track query patterns
    const pattern = this.extractQueryPattern(metrics.query);
    const currentCount = this.performanceMetrics.queryPatterns.get(pattern) || 0;
    this.performanceMetrics.queryPatterns.set(pattern, currentCount + 1);
  }

  private updatePerformanceMetrics(): void {
    if (this.queryMetrics.length === 0) return;

    const recentMetrics = this.queryMetrics.slice(-1000);
    const totalTime = recentMetrics.reduce((sum, m) => sum + m.executionTime, 0);
    const cacheHits = recentMetrics.filter(m => m.cacheHit).length;
    
    this.performanceMetrics.averageExecutionTime = totalTime / recentMetrics.length;
    this.performanceMetrics.cacheHitRatio = (cacheHits / recentMetrics.length) * 100;
    this.performanceMetrics.concurrentQueries = this.activeQueries.size;
    this.performanceMetrics.connectionPoolUtilization = 
      (this.connectionSemaphore / this.config.performance.connectionPoolSize) * 100;
  }

  private extractQueryPattern(query: string): string {
    // Extract basic query pattern (SELECT, INSERT, etc.)
    const match = query.match(/^\s*(\w+)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  private generateIndexRecommendations(metrics: QueryMetrics[]): string[] {
    const recommendations: string[] = [];
    const slowQueries = metrics.filter(m => 
      m.executionTime > this.config.performance.slowQueryThreshold
    );
    
    // Analyze common patterns in slow queries
    const tablePatterns = new Map<string, number>();
    slowQueries.forEach(query => {
      const tables = this.extractTablesFromQuery(query.query);
      tables.forEach(table => {
        tablePatterns.set(table, (tablePatterns.get(table) || 0) + 1);
      });
    });
    
    // Generate recommendations for frequently queried tables
    tablePatterns.forEach((count, table) => {
      if (count > 5) {
        recommendations.push(`Consider adding indexes on ${table} for frequent queries`);
      }
    });
    
    return recommendations;
  }

  private extractTablesFromQuery(query: string): string[] {
    const tables: string[] = [];
    const fromMatch = query.match(/from\s+(\w+)/gi);
    const joinMatch = query.match(/join\s+(\w+)/gi);
    
    if (fromMatch) {
      fromMatch.forEach(match => {
        const table = match.split(/\s+/)[1];
        if (table) tables.push(table);
      });
    }
    
    if (joinMatch) {
      joinMatch.forEach(match => {
        const table = match.split(/\s+/)[1];
        if (table) tables.push(table);
      });
    }
    
    return tables;
  }

  private calculateCacheEfficiency(): number {
    if (this.queryMetrics.length === 0) return 0;
    
    const recentMetrics = this.queryMetrics.slice(-1000);
    const cacheableQueries = recentMetrics.filter(m => 
      this.shouldUseCache(m.query)
    );
    
    if (cacheableQueries.length === 0) return 0;
    
    const cacheHits = cacheableQueries.filter(m => m.cacheHit).length;
    return (cacheHits / cacheableQueries.length) * 100;
  }

  private generateOptimizationSuggestions(metrics: QueryMetrics[]): string[] {
    const suggestions: string[] = [];
    
    const avgExecutionTime = this.performanceMetrics.averageExecutionTime;
    const cacheHitRatio = this.performanceMetrics.cacheHitRatio;
    const slowQueryRate = (this.performanceMetrics.slowQueries / this.performanceMetrics.totalQueries) * 100;
    
    if (avgExecutionTime > this.config.performance.slowQueryThreshold) {
      suggestions.push('Average query execution time is high - consider query optimization');
    }
    
    if (cacheHitRatio < 50) {
      suggestions.push('Cache hit ratio is low - consider adjusting cache TTL or strategy');
    }
    
    if (slowQueryRate > 10) {
      suggestions.push('High percentage of slow queries - review indexing strategy');
    }
    
    if (this.performanceMetrics.connectionPoolUtilization > 80) {
      suggestions.push('Connection pool utilization is high - consider increasing pool size');
    }
    
    return suggestions;
  }
}

/**
 * Factory for creating optimized data access instances
 */
export class DataAccessOptimizerFactory {
  static create(dbPool: DatabasePool, config?: Partial<DataAccessConfig>): DataAccessOptimizer {
    const defaultConfig: DataAccessConfig = {
      cache: {
        strategy: 'write-through',
        ttl: 300, // 5 minutes
        maxSize: 1000,
        invalidationRules: [],
        namespace: 'db-queries'
      },
      performance: {
        slowQueryThreshold: 1000, // 1 second
        maxConcurrentQueries: 20,
        connectionPoolSize: 10,
        queryTimeout: 30000 // 30 seconds
      },
      optimization: {
        enableQueryCache: true,
        enableResultCache: true,
        enablePreparedStatements: true,
        enableQueryPlanning: true
      }
    };
    
    const mergedConfig: DataAccessConfig = {
      cache: { ...defaultConfig.cache, ...config?.cache },
      performance: { ...defaultConfig.performance, ...config?.performance },
      optimization: { ...defaultConfig.optimization, ...config?.optimization }
    };
    
    return new DataAccessOptimizer(dbPool, mergedConfig);
  }
}
