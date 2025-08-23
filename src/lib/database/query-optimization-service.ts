/**
 * US-011: Query Optimization Service
 * 
 * Provides intelligent query optimization, index analysis, and materialized view management
 * Analyzes query patterns and suggests performance improvements
 */

import { DatabaseClient, DatabasePool } from './database-connection';

export interface QueryPlan {
  query: string;
  estimatedCost: number;
  estimatedRows: number;
  executionPlan: string;
  indexesUsed: string[];
  scanTypes: string[];
  joinTypes: string[];
  suggestedOptimizations: string[];
}

export interface IndexAnalysis {
  tableName: string;
  indexName: string;
  columns: string[];
  usageFrequency: number;
  selectivity: number;
  efficiency: number;
  recommendation: 'keep' | 'drop' | 'modify' | 'composite';
  reason: string;
}

export interface MaterializedViewCandidate {
  name: string;
  query: string;
  estimatedBenefit: number;
  frequency: number;
  avgExecutionTime: number;
  dataFreshness: 'real-time' | 'hourly' | 'daily';
  refreshStrategy: 'manual' | 'automatic' | 'incremental';
}

export interface OptimizationStrategy {
  indexing: {
    newIndexes: Array<{
      tableName: string;
      columns: string[];
      type: 'btree' | 'gin' | 'gist' | 'hash';
      reason: string;
    }>;
    dropIndexes: string[];
    modifyIndexes: Array<{
      current: string;
      suggested: string;
      improvement: string;
    }>;
  };
  partitioning: {
    tables: Array<{
      tableName: string;
      strategy: 'range' | 'hash' | 'list';
      column: string;
      benefit: string;
    }>;
  };
  materializedViews: MaterializedViewCandidate[];
  queryRewrite: Array<{
    original: string;
    optimized: string;
    improvement: string;
  }>;
}

/**
 * Advanced query optimization and performance analysis service
 */
export class QueryOptimizationService {
  private queryCache = new Map<string, QueryPlan>();
  private indexAnalysisCache = new Map<string, IndexAnalysis[]>();
  private mvCandidates: MaterializedViewCandidate[] = [];
  private queryPatterns = new Map<string, {
    frequency: number;
    avgExecutionTime: number;
    lastSeen: Date;
    variations: string[];
  }>();

  constructor(private dbPool: DatabasePool) {}

  /**
   * Analyze query and provide optimization recommendations
   */
  async analyzeQuery(sql: string): Promise<QueryPlan> {
    const cacheKey = this.normalizeQuery(sql);
    
    if (this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey)!;
    }

    const plan = await this.generateQueryPlan(sql);
    this.queryCache.set(cacheKey, plan);
    
    return plan;
  }

  /**
   * Analyze all indexes in the database
   */
  async analyzeIndexes(): Promise<IndexAnalysis[]> {
    const cacheKey = 'all_indexes';
    
    if (this.indexAnalysisCache.has(cacheKey)) {
      return this.indexAnalysisCache.get(cacheKey)!;
    }

    const analysis = await this.performIndexAnalysis();
    this.indexAnalysisCache.set(cacheKey, analysis);
    
    return analysis;
  }

  /**
   * Identify materialized view candidates
   */
  async identifyMaterializedViewCandidates(): Promise<MaterializedViewCandidate[]> {
    const patterns = Array.from(this.queryPatterns.entries())
      .filter(([_, stats]) => stats.frequency >= 10 && stats.avgExecutionTime > 1000)
      .sort((a, b) => b[1].frequency * b[1].avgExecutionTime - a[1].frequency * a[1].avgExecutionTime);

    this.mvCandidates = patterns.slice(0, 10).map(([query, stats]) => ({
      name: `mv_${this.generateViewName(query)}`,
      query,
      estimatedBenefit: stats.frequency * stats.avgExecutionTime,
      frequency: stats.frequency,
      avgExecutionTime: stats.avgExecutionTime,
      dataFreshness: this.determineDataFreshness(query),
      refreshStrategy: this.determineRefreshStrategy(query, stats.frequency)
    }));

    return this.mvCandidates;
  }

  /**
   * Generate comprehensive optimization strategy
   */
  async generateOptimizationStrategy(): Promise<OptimizationStrategy> {
    const [indexAnalysis, mvCandidates] = await Promise.all([
      this.analyzeIndexes(),
      this.identifyMaterializedViewCandidates()
    ]);

    return {
      indexing: {
        newIndexes: this.suggestNewIndexes(),
        dropIndexes: this.suggestIndexesToDrop(indexAnalysis),
        modifyIndexes: this.suggestIndexModifications(indexAnalysis)
      },
      partitioning: {
        tables: this.suggestPartitioning()
      },
      materializedViews: mvCandidates,
      queryRewrite: this.suggestQueryRewrites()
    };
  }

  /**
   * Record query execution for pattern analysis
   */
  recordQueryExecution(sql: string, executionTime: number): void {
    const normalized = this.normalizeQuery(sql);
    const pattern = this.queryPatterns.get(normalized) || {
      frequency: 0,
      avgExecutionTime: 0,
      lastSeen: new Date(),
      variations: []
    };

    pattern.frequency++;
    pattern.avgExecutionTime = (pattern.avgExecutionTime * (pattern.frequency - 1) + executionTime) / pattern.frequency;
    pattern.lastSeen = new Date();
    
    if (!pattern.variations.includes(sql) && pattern.variations.length < 5) {
      pattern.variations.push(sql);
    }

    this.queryPatterns.set(normalized, pattern);
  }

  /**
   * Get optimization recommendations for specific table
   */
  async getTableOptimizations(tableName: string): Promise<{
    indexRecommendations: string[];
    partitioningStrategy?: string;
    maintenanceRecommendations: string[];
  }> {
    const indexAnalysis = await this.analyzeIndexes();
    const tableIndexes = indexAnalysis.filter(idx => idx.tableName === tableName);
    
    const indexRecommendations = tableIndexes
      .filter(idx => idx.recommendation !== 'keep')
      .map(idx => `${idx.recommendation.toUpperCase()}: ${idx.indexName} - ${idx.reason}`);

    const partitioningStrategy = this.getPartitioningRecommendation(tableName);
    const maintenanceRecommendations = this.getMaintenanceRecommendations(tableName, tableIndexes);

    return {
      indexRecommendations,
      partitioningStrategy,
      maintenanceRecommendations
    };
  }

  /**
   * Validate and optimize a query before execution
   */
  async optimizeQueryBeforeExecution(sql: string): Promise<{
    optimizedQuery: string;
    estimatedImprovement: number;
    warnings: string[];
  }> {
    const plan = await this.analyzeQuery(sql);
    const optimizedQuery = this.applyQueryOptimizations(sql, plan);
    const estimatedImprovement = this.calculateEstimatedImprovement(sql, optimizedQuery);
    const warnings = this.generateQueryWarnings(plan);

    return {
      optimizedQuery,
      estimatedImprovement,
      warnings
    };
  }

  /**
   * Clear optimization caches
   */
  clearCache(): void {
    this.queryCache.clear();
    this.indexAnalysisCache.clear();
  }

  // Private methods

  private async generateQueryPlan(sql: string): Promise<QueryPlan> {
    // In a real implementation, this would use EXPLAIN ANALYZE
    // For now, we'll simulate a query plan analysis
    
    const estimatedCost = Math.random() * 10000;
    const estimatedRows = Math.floor(Math.random() * 100000);
    const indexesUsed = this.extractPotentialIndexes(sql);
    const scanTypes = this.determineScanTypes(sql);
    const joinTypes = this.determineJoinTypes(sql);
    const suggestedOptimizations = this.generateOptimizationSuggestions(sql);

    return {
      query: sql,
      estimatedCost,
      estimatedRows,
      executionPlan: `Simulated execution plan for: ${sql.substring(0, 100)}...`,
      indexesUsed,
      scanTypes,
      joinTypes,
      suggestedOptimizations
    };
  }

  private async performIndexAnalysis(): Promise<IndexAnalysis[]> {
    // Mock index analysis - in real implementation would query pg_stat_user_indexes
    const mockIndexes: IndexAnalysis[] = [
      {
        tableName: 'players',
        indexName: 'idx_players_username',
        columns: ['username'],
        usageFrequency: 1000,
        selectivity: 0.95,
        efficiency: 0.90,
        recommendation: 'keep',
        reason: 'High usage and selectivity'
      },
      {
        tableName: 'game_history',
        indexName: 'idx_game_history_table_id',
        columns: ['table_id'],
        usageFrequency: 500,
        selectivity: 0.70,
        efficiency: 0.85,
        recommendation: 'keep',
        reason: 'Good performance for table queries'
      },
      {
        tableName: 'game_history',
        indexName: 'idx_game_history_old',
        columns: ['old_column'],
        usageFrequency: 5,
        selectivity: 0.20,
        efficiency: 0.30,
        recommendation: 'drop',
        reason: 'Low usage and poor selectivity'
      }
    ];

    return mockIndexes;
  }

  private normalizeQuery(sql: string): string {
    return sql
      .replace(/\s+/g, ' ')
      .replace(/\$\d+|\?|'[^']*'|\d+/g, '?')
      .trim()
      .toLowerCase();
  }

  private extractPotentialIndexes(sql: string): string[] {
    const indexes: string[] = [];
    
    // Look for WHERE clauses
    const whereMatch = sql.match(/where\s+(\w+\.\w+|\w+)/gi);
    if (whereMatch) {
      whereMatch.forEach(match => {
        const column = match.split(/\s+/)[1];
        if (column && !indexes.includes(column)) {
          indexes.push(column);
        }
      });
    }

    // Look for JOIN conditions
    const joinMatch = sql.match(/join\s+\w+\s+on\s+(\w+\.\w+|\w+)/gi);
    if (joinMatch) {
      joinMatch.forEach(match => {
        const parts = match.split(/\s+/);
        const column = parts[parts.length - 1];
        if (column && !indexes.includes(column)) {
          indexes.push(column);
        }
      });
    }

    return indexes;
  }

  private determineScanTypes(sql: string): string[] {
    const scanTypes: string[] = [];
    
    if (sql.toLowerCase().includes('where')) {
      scanTypes.push('Index Scan');
    } else {
      scanTypes.push('Sequential Scan');
    }
    
    if (sql.toLowerCase().includes('order by')) {
      scanTypes.push('Sort');
    }
    
    if (sql.toLowerCase().includes('group by')) {
      scanTypes.push('Aggregate');
    }

    return scanTypes;
  }

  private determineJoinTypes(sql: string): string[] {
    const joinTypes: string[] = [];
    
    if (sql.toLowerCase().includes('inner join')) {
      joinTypes.push('Nested Loop');
    }
    
    if (sql.toLowerCase().includes('left join')) {
      joinTypes.push('Hash Join');
    }
    
    if (sql.toLowerCase().includes('group by')) {
      joinTypes.push('Merge Join');
    }

    return joinTypes;
  }

  private generateOptimizationSuggestions(sql: string): string[] {
    const suggestions: string[] = [];
    
    if (!sql.toLowerCase().includes('limit') && sql.toLowerCase().includes('select')) {
      suggestions.push('Consider adding LIMIT clause to reduce result set');
    }
    
    if (sql.toLowerCase().includes('select *')) {
      suggestions.push('Avoid SELECT * - specify only needed columns');
    }
    
    if (sql.toLowerCase().includes('or')) {
      suggestions.push('Consider rewriting OR conditions as UNION for better performance');
    }
    
    if (sql.toLowerCase().includes('like \'%')) {
      suggestions.push('Leading wildcards prevent index usage - consider full-text search');
    }

    return suggestions;
  }

  private generateViewName(query: string): string {
    const words = query.split(/\s+/).slice(0, 3);
    return words.join('_').replace(/[^a-zA-Z0-9_]/g, '');
  }

  private determineDataFreshness(query: string): 'real-time' | 'hourly' | 'daily' {
    if (query.includes('now()') || query.includes('current_timestamp')) {
      return 'real-time';
    }
    
    if (query.includes('hour') || query.includes('minute')) {
      return 'hourly';
    }
    
    return 'daily';
  }

  private determineRefreshStrategy(
    query: string, 
    frequency: number
  ): 'manual' | 'automatic' | 'incremental' {
    if (frequency > 100) {
      return 'incremental';
    }
    
    if (frequency > 20) {
      return 'automatic';
    }
    
    return 'manual';
  }

  private suggestNewIndexes(): Array<{
    tableName: string;
    columns: string[];
    type: 'btree' | 'gin' | 'gist' | 'hash';
    reason: string;
  }> {
    // Analyze query patterns to suggest new indexes
    const suggestions: Array<{
      tableName: string;
      columns: string[];
      type: 'btree' | 'gin' | 'gist' | 'hash';
      reason: string;
    }> = [];
    
    Array.from(this.queryPatterns.entries()).forEach(([query, stats]) => {
      if (stats.frequency > 50 && stats.avgExecutionTime > 500) {
        const tables = this.extractTablesFromQuery(query);
        const columns = this.extractColumnsFromQuery(query);
        
        tables.forEach(table => {
          const relevantColumns = columns.filter(col => col.includes(table) || !col.includes('.'));
          if (relevantColumns.length > 0) {
            suggestions.push({
              tableName: table,
              columns: relevantColumns,
              type: 'btree' as const,
              reason: `Frequent query pattern with ${stats.frequency} executions`
            });
          }
        });
      }
    });
    
    return suggestions.slice(0, 5); // Limit suggestions
  }

  private suggestIndexesToDrop(indexAnalysis: IndexAnalysis[]): string[] {
    return indexAnalysis
      .filter(idx => idx.recommendation === 'drop')
      .map(idx => idx.indexName);
  }

  private suggestIndexModifications(indexAnalysis: IndexAnalysis[]): Array<{
    current: string;
    suggested: string;
    improvement: string;
  }> {
    return indexAnalysis
      .filter(idx => idx.recommendation === 'modify')
      .map(idx => ({
        current: idx.indexName,
        suggested: `${idx.indexName}_improved`,
        improvement: idx.reason
      }));
  }

  private suggestPartitioning(): Array<{
    tableName: string;
    strategy: 'range' | 'hash' | 'list';
    column: string;
    benefit: string;
  }> {
    const largeTables = ['game_history', 'player_actions', 'user_sessions'];
    
    return largeTables.map(table => ({
      tableName: table,
      strategy: 'range' as const,
      column: table === 'game_history' ? 'started_at' : 'created_at',
      benefit: 'Improved query performance for time-based queries'
    }));
  }

  private suggestQueryRewrites(): Array<{
    original: string;
    optimized: string;
    improvement: string;
  }> {
    const rewrites: Array<{
      original: string;
      optimized: string;
      improvement: string;
    }> = [];
    
    Array.from(this.queryPatterns.entries()).forEach(([query, stats]) => {
      if (stats.avgExecutionTime > 1000) {
        const optimized = this.rewriteQuery(query);
        if (optimized !== query) {
          rewrites.push({
            original: query,
            optimized,
            improvement: 'Rewritten for better performance'
          });
        }
      }
    });
    
    return rewrites.slice(0, 5);
  }

  private extractTablesFromQuery(query: string): string[] {
    const tables: string[] = [];
    const fromMatch = query.match(/from\s+(\w+)/gi);
    const joinMatch = query.match(/join\s+(\w+)/gi);
    
    if (fromMatch) {
      fromMatch.forEach(match => {
        const table = match.split(/\s+/)[1];
        if (table && !tables.includes(table)) {
          tables.push(table);
        }
      });
    }
    
    if (joinMatch) {
      joinMatch.forEach(match => {
        const table = match.split(/\s+/)[1];
        if (table && !tables.includes(table)) {
          tables.push(table);
        }
      });
    }
    
    return tables;
  }

  private extractColumnsFromQuery(query: string): string[] {
    const columns: string[] = [];
    
    // Extract WHERE columns
    const whereMatch = query.match(/where\s+(\w+(?:\.\w+)?)/gi);
    if (whereMatch) {
      whereMatch.forEach(match => {
        const column = match.split(/\s+/)[1];
        if (column && !columns.includes(column)) {
          columns.push(column);
        }
      });
    }
    
    // Extract ORDER BY columns
    const orderMatch = query.match(/order\s+by\s+(\w+(?:\.\w+)?)/gi);
    if (orderMatch) {
      orderMatch.forEach(match => {
        const parts = match.split(/\s+/);
        const column = parts[parts.length - 1];
        if (column && !columns.includes(column)) {
          columns.push(column);
        }
      });
    }
    
    return columns;
  }

  private getPartitioningRecommendation(tableName: string): string | undefined {
    const largeTableStrategies: Record<string, string> = {
      'game_history': 'Range partitioning by started_at (monthly partitions)',
      'player_actions': 'Range partitioning by timestamp (weekly partitions)',
      'user_sessions': 'Range partitioning by created_at (monthly partitions)'
    };
    
    return largeTableStrategies[tableName];
  }

  private getMaintenanceRecommendations(tableName: string, indexes: IndexAnalysis[]): string[] {
    const recommendations: string[] = [];
    
    const unusedIndexes = indexes.filter(idx => idx.usageFrequency < 10);
    if (unusedIndexes.length > 0) {
      recommendations.push(`Consider dropping ${unusedIndexes.length} unused indexes`);
    }
    
    const inefficientIndexes = indexes.filter(idx => idx.efficiency < 0.5);
    if (inefficientIndexes.length > 0) {
      recommendations.push(`Review ${inefficientIndexes.length} inefficient indexes`);
    }
    
    recommendations.push('Run ANALYZE to update table statistics');
    recommendations.push('Consider VACUUM FULL during maintenance window');
    
    return recommendations;
  }

  private applyQueryOptimizations(sql: string, plan: QueryPlan): string {
    let optimized = sql;
    
    // Apply suggested optimizations
    if (plan.suggestedOptimizations.some(s => s.includes('LIMIT'))) {
      if (!optimized.toLowerCase().includes('limit')) {
        optimized += ' LIMIT 1000';
      }
    }
    
    if (plan.suggestedOptimizations.some(s => s.includes('SELECT *'))) {
      // This would require more sophisticated parsing in a real implementation
      optimized = optimized.replace(/select\s+\*/gi, 'SELECT id, name, created_at');
    }
    
    return optimized;
  }

  private calculateEstimatedImprovement(original: string, optimized: string): number {
    // Simple heuristic - in real implementation would use query plans
    let improvement = 0;
    
    if (optimized.includes('LIMIT') && !original.includes('LIMIT')) {
      improvement += 30;
    }
    
    if (!optimized.includes('SELECT *') && original.includes('SELECT *')) {
      improvement += 20;
    }
    
    return Math.min(improvement, 90); // Cap at 90% improvement
  }

  private generateQueryWarnings(plan: QueryPlan): string[] {
    const warnings: string[] = [];
    
    if (plan.estimatedCost > 5000) {
      warnings.push('High query cost detected - consider optimization');
    }
    
    if (plan.estimatedRows > 50000) {
      warnings.push('Large result set - consider adding filters or pagination');
    }
    
    if (plan.scanTypes.includes('Sequential Scan')) {
      warnings.push('Sequential scan detected - consider adding indexes');
    }
    
    return warnings;
  }

  private rewriteQuery(query: string): string {
    let rewritten = query;
    
    // Replace OR with UNION for better performance
    if (query.includes(' or ')) {
      // This is a simplified example - real implementation would be more sophisticated
      rewritten = query.replace(/ or /gi, ' UNION ');
    }
    
    // Add hints for better performance
    if (query.toLowerCase().includes('join') && !query.includes('/*+')) {
      rewritten = query.replace(/select/i, 'SELECT /*+ USE_HASH */');
    }
    
    return rewritten;
  }
}

/**
 * Factory for creating query optimization service instances
 */
export class QueryOptimizationServiceFactory {
  static create(dbPool: DatabasePool): QueryOptimizationService {
    return new QueryOptimizationService(dbPool);
  }
}
