/**
 * US-016: Analytics Support Service
 * 
 * Provides comprehensive analytics capabilities for extracting meaningful
 * insights from game data to improve player experience.
 */

import { Pool, PoolClient } from 'pg';
import { EventEmitter } from 'events';

// ========================================
// TYPES AND INTERFACES
// ========================================

export interface PlayerStatistics {
  player_id: string;
  username: string;
  hands_played: number;
  average_profit: number;
  median_profit: number;
  total_profit: number;
  win_rate: number;
  biggest_win: number;
  biggest_loss: number;
  avg_session_duration: number;
  last_played: Date;
  favorite_stake: string;
  playing_style: 'tight' | 'loose' | 'aggressive' | 'passive' | 'balanced';
}

export interface GameMetrics {
  total_hands: number;
  total_players: number;
  active_players_24h: number;
  total_revenue: number;
  average_hand_duration: number;
  popular_stakes: StakeMetrics[];
  peak_hours: HourlyMetrics[];
  conversion_rate: number;
}

export interface StakeMetrics {
  stake_level: string;
  hands_played: number;
  players_count: number;
  total_volume: number;
  average_profit: number;
}

export interface HourlyMetrics {
  hour: number;
  players_count: number;
  hands_played: number;
  total_volume: number;
}

export interface TableMetrics {
  table_id: string;
  table_name: string;
  hands_played: number;
  average_players: number;
  total_volume: number;
  utilization_rate: number;
  average_hand_duration: number;
}

export interface ReportConfig {
  type: 'player' | 'game' | 'table' | 'financial' | 'custom';
  dateRange: {
    start: Date;
    end: Date;
  };
  filters?: {
    playerIds?: string[];
    tableIds?: string[];
    stakes?: string[];
    minHands?: number;
  };
  metrics: string[];
  groupBy?: string[];
  sortBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export interface CustomQuery {
  id: string;
  name: string;
  description: string;
  sql: string;
  parameters: QueryParameter[];
  category: string;
  created_by: string;
  created_at: Date;
}

export interface QueryParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  required: boolean;
  default?: any;
  description: string;
}

export interface ExportConfig {
  format: 'csv' | 'json' | 'xlsx' | 'pdf';
  includeHeaders: boolean;
  compression?: 'gzip' | 'zip';
  chunkSize?: number;
}

export interface AnalyticsEvent {
  type: 'report_generated' | 'export_completed' | 'view_refreshed' | 'query_executed';
  data: any;
  timestamp: Date;
  user_id?: string;
}

// ========================================
// ANALYTICS SERVICE
// ========================================

export class AnalyticsService extends EventEmitter {
  private pool: Pool;
  private initialized: boolean = false;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  /**
   * Initialize analytics service and create materialized views
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.createAnalyticsViews();
    await this.createAnalyticsTables();
    await this.setupIndexes();
    
    this.initialized = true;
    this.emit('initialized');
  }

  // ========================================
  // MATERIALIZED VIEWS MANAGEMENT
  // ========================================

  private async createAnalyticsViews(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Player statistics materialized view
      await client.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS player_statistics AS
        SELECT
          p.id as player_id,
          p.username,
          COUNT(DISTINCT gh.hand_id) as hands_played,
          COALESCE(AVG(gr.profit_loss), 0) as average_profit,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY gr.profit_loss), 0) as median_profit,
          COALESCE(SUM(gr.profit_loss), 0) as total_profit,
          COALESCE(
            COUNT(CASE WHEN gr.profit_loss > 0 THEN 1 END)::DECIMAL / 
            NULLIF(COUNT(gr.profit_loss), 0), 0
          ) as win_rate,
          COALESCE(MAX(gr.profit_loss), 0) as biggest_win,
          COALESCE(MIN(gr.profit_loss), 0) as biggest_loss,
          COALESCE(AVG(EXTRACT(EPOCH FROM (gh.ended_at - gh.started_at))), 0) as avg_session_duration,
          MAX(gh.ended_at) as last_played,
          MODE() WITHIN GROUP (ORDER BY gh.stake_level) as favorite_stake
        FROM players p
        LEFT JOIN game_history gh ON p.id = ANY(gh.player_ids)
        LEFT JOIN game_results gr ON gh.hand_id = gr.hand_id AND p.id = gr.player_id
        GROUP BY p.id, p.username
        WITH DATA;
      `);

      // Game metrics view
      await client.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS game_metrics_daily AS
        SELECT
          DATE(gh.started_at) as game_date,
          COUNT(DISTINCT gh.hand_id) as total_hands,
          COUNT(DISTINCT UNNEST(gh.player_ids)) as unique_players,
          SUM(gh.pot_size) as total_volume,
          AVG(EXTRACT(EPOCH FROM (gh.ended_at - gh.started_at))) as avg_hand_duration,
          gh.stake_level,
          COUNT(*) as hands_at_stake
        FROM game_history gh
        GROUP BY DATE(gh.started_at), gh.stake_level
        WITH DATA;
      `);

      // Table utilization view
      await client.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS table_utilization AS
        SELECT
          gh.table_id,
          t.name as table_name,
          COUNT(DISTINCT gh.hand_id) as hands_played,
          AVG(array_length(gh.player_ids, 1)) as average_players,
          SUM(gh.pot_size) as total_volume,
          COUNT(gh.hand_id)::DECIMAL / 
            NULLIF(EXTRACT(EPOCH FROM (MAX(gh.ended_at) - MIN(gh.started_at))) / 3600, 0) as hands_per_hour,
          AVG(EXTRACT(EPOCH FROM (gh.ended_at - gh.started_at))) as avg_hand_duration
        FROM game_history gh
        LEFT JOIN tables t ON gh.table_id = t.id
        GROUP BY gh.table_id, t.name
        WITH DATA;
      `);

      // Hourly activity patterns
      await client.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_activity AS
        SELECT
          EXTRACT(HOUR FROM gh.started_at) as hour_of_day,
          EXTRACT(DOW FROM gh.started_at) as day_of_week,
          COUNT(DISTINCT gh.hand_id) as hands_played,
          COUNT(DISTINCT UNNEST(gh.player_ids)) as unique_players,
          SUM(gh.pot_size) as total_volume,
          AVG(array_length(gh.player_ids, 1)) as avg_players_per_hand
        FROM game_history gh
        WHERE gh.started_at >= NOW() - INTERVAL '30 days'
        GROUP BY EXTRACT(HOUR FROM gh.started_at), EXTRACT(DOW FROM gh.started_at)
        WITH DATA;
      `);

    } finally {
      client.release();
    }
  }

  private async createAnalyticsTables(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Custom queries storage
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_analytics_queries (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          description TEXT,
          sql_query TEXT NOT NULL,
          parameters JSONB DEFAULT '[]',
          category VARCHAR(100) DEFAULT 'custom',
          created_by UUID REFERENCES players(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          is_public BOOLEAN DEFAULT false,
          execution_count INTEGER DEFAULT 0,
          last_executed TIMESTAMP WITH TIME ZONE
        );
      `);

      // Report execution history
      await client.query(`
        CREATE TABLE IF NOT EXISTS analytics_report_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          report_type VARCHAR(100) NOT NULL,
          config JSONB NOT NULL,
          generated_by UUID REFERENCES players(id),
          generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          execution_time_ms INTEGER,
          row_count INTEGER,
          file_path TEXT,
          status VARCHAR(50) DEFAULT 'completed'
        );
      `);

      // Analytics events log
      await client.query(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          event_type VARCHAR(100) NOT NULL,
          event_data JSONB NOT NULL,
          user_id UUID REFERENCES players(id),
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          session_id VARCHAR(255),
          ip_address INET
        );
      `);

    } finally {
      client.release();
    }
  }

  private async setupIndexes(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_stats_hands 
        ON player_statistics(hands_played DESC);
      `);
      
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_stats_profit 
        ON player_statistics(total_profit DESC);
      `);
      
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_metrics_date 
        ON game_metrics_daily(game_date DESC);
      `);
      
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_type_time 
        ON analytics_events(event_type, timestamp DESC);
      `);

    } finally {
      client.release();
    }
  }

  /**
   * Refresh materialized views
   */
  async refreshViews(concurrent: boolean = true): Promise<void> {
    const client = await this.pool.connect();
    const concurrentFlag = concurrent ? 'CONCURRENTLY' : '';
    
    try {
      await client.query(`REFRESH MATERIALIZED VIEW ${concurrentFlag} player_statistics`);
      await client.query(`REFRESH MATERIALIZED VIEW ${concurrentFlag} game_metrics_daily`);
      await client.query(`REFRESH MATERIALIZED VIEW ${concurrentFlag} table_utilization`);
      await client.query(`REFRESH MATERIALIZED VIEW ${concurrentFlag} hourly_activity`);
      
      this.emit('view_refreshed', { timestamp: new Date() });
    } finally {
      client.release();
    }
  }

  // ========================================
  // ANALYTICS QUERIES
  // ========================================

  /**
   * Get player statistics
   */
  async getPlayerStatistics(filters?: {
    playerIds?: string[];
    minHands?: number;
    dateRange?: { start: Date; end: Date };
  }): Promise<PlayerStatistics[]> {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT 
          player_id,
          username,
          hands_played,
          ROUND(average_profit::NUMERIC, 2) as average_profit,
          ROUND(median_profit::NUMERIC, 2) as median_profit,
          ROUND(total_profit::NUMERIC, 2) as total_profit,
          ROUND(win_rate::NUMERIC, 4) as win_rate,
          ROUND(biggest_win::NUMERIC, 2) as biggest_win,
          ROUND(biggest_loss::NUMERIC, 2) as biggest_loss,
          ROUND(avg_session_duration::NUMERIC, 2) as avg_session_duration,
          last_played,
          favorite_stake,
          CASE 
            WHEN win_rate > 0.6 AND average_profit > 0 THEN 'tight'
            WHEN win_rate < 0.4 AND hands_played > 100 THEN 'loose'
            WHEN biggest_win > ABS(biggest_loss) * 2 THEN 'aggressive'
            WHEN ABS(biggest_loss) > biggest_win * 2 THEN 'passive'
            ELSE 'balanced'
          END as playing_style
        FROM player_statistics 
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramIndex = 1;
      
      if (filters?.playerIds?.length) {
        query += ` AND player_id = ANY($${paramIndex})`;
        params.push(filters.playerIds);
        paramIndex++;
      }
      
      if (filters?.minHands) {
        query += ` AND hands_played >= $${paramIndex}`;
        params.push(filters.minHands);
        paramIndex++;
      }
      
      query += ` ORDER BY hands_played DESC, total_profit DESC`;
      
      const result = await client.query(query, params);
      return result.rows;
      
    } finally {
      client.release();
    }
  }

  /**
   * Get game metrics
   */
  async getGameMetrics(dateRange?: { start: Date; end: Date }): Promise<GameMetrics> {
    const client = await this.pool.connect();
    
    try {
      let dateFilter = '';
      const params: any[] = [];
      
      if (dateRange) {
        dateFilter = 'WHERE game_date BETWEEN $1 AND $2';
        params.push(dateRange.start, dateRange.end);
      }
      
      // Get overall metrics
      const overallQuery = `
        SELECT 
          SUM(total_hands) as total_hands,
          COUNT(DISTINCT game_date) as active_days,
          SUM(unique_players) as total_unique_players,
          SUM(total_volume) as total_revenue,
          AVG(avg_hand_duration) as average_hand_duration
        FROM game_metrics_daily 
        ${dateFilter}
      `;
      
      const overallResult = await client.query(overallQuery, params);
      const overall = overallResult.rows[0];
      
      // Get stake metrics
      const stakeQuery = `
        SELECT 
          stake_level,
          SUM(hands_at_stake) as hands_played,
          COUNT(DISTINCT game_date) as days_active,
          SUM(total_volume) as total_volume,
          AVG(avg_hand_duration) as avg_duration
        FROM game_metrics_daily 
        ${dateFilter}
        GROUP BY stake_level
        ORDER BY total_volume DESC
      `;
      
      const stakeResult = await client.query(stakeQuery, params);
      
      // Get hourly metrics
      const hourlyQuery = `
        SELECT 
          hour_of_day as hour,
          AVG(unique_players) as players_count,
          AVG(hands_played) as hands_played,
          AVG(total_volume) as total_volume
        FROM hourly_activity
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `;
      
      const hourlyResult = await client.query(hourlyQuery);
      
      return {
        total_hands: parseInt(overall.total_hands) || 0,
        total_players: parseInt(overall.total_unique_players) || 0,
        active_players_24h: await this.getActivePlayers24h(),
        total_revenue: parseFloat(overall.total_revenue) || 0,
        average_hand_duration: parseFloat(overall.average_hand_duration) || 0,
        popular_stakes: stakeResult.rows.map(row => ({
          stake_level: row.stake_level,
          hands_played: parseInt(row.hands_played),
          players_count: parseInt(row.days_active),
          total_volume: parseFloat(row.total_volume),
          average_profit: parseFloat(row.avg_duration)
        })),
        peak_hours: hourlyResult.rows.map(row => ({
          hour: parseInt(row.hour),
          players_count: Math.round(parseFloat(row.players_count)),
          hands_played: Math.round(parseFloat(row.hands_played)),
          total_volume: parseFloat(row.total_volume)
        })),
        conversion_rate: await this.getConversionRate()
      };
      
    } finally {
      client.release();
    }
  }

  /**
   * Get table metrics
   */
  async getTableMetrics(): Promise<TableMetrics[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          table_id,
          table_name,
          hands_played,
          ROUND(average_players::NUMERIC, 2) as average_players,
          ROUND(total_volume::NUMERIC, 2) as total_volume,
          ROUND((hands_per_hour / 20.0)::NUMERIC, 4) as utilization_rate,
          ROUND(avg_hand_duration::NUMERIC, 2) as average_hand_duration
        FROM table_utilization
        ORDER BY total_volume DESC
      `);
      
      return result.rows;
      
    } finally {
      client.release();
    }
  }

  // ========================================
  // CUSTOM REPORTING
  // ========================================

  /**
   * Generate custom report
   */
  async generateReport(config: ReportConfig, userId?: string): Promise<any[]> {
    const startTime = Date.now();
    
    try {
      const query = this.buildReportQuery(config);
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(query.sql, query.params);
        const executionTime = Date.now() - startTime;
        
        // Log report generation
        await this.logReportExecution(config, userId, executionTime, result.rows.length);
        
        this.emit('report_generated', {
          type: config.type,
          rowCount: result.rows.length,
          executionTime
        });
        
        return result.rows;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('Report generation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to generate report: ${errorMessage}`);
    }
  }

  private buildReportQuery(config: ReportConfig): { sql: string; params: any[] } {
    const params: any[] = [];
    let paramIndex = 1;
    
    let baseQuery = '';
    let whereClause = '';
    let groupByClause = '';
    let orderByClause = '';
    
    // Build base query based on report type
    switch (config.type) {
      case 'player':
        baseQuery = `
          SELECT 
            ps.*,
            p.email,
            p.created_at as registration_date
          FROM player_statistics ps
          JOIN players p ON ps.player_id = p.id
        `;
        break;
        
      case 'game':
        baseQuery = `
          SELECT * FROM game_metrics_daily
        `;
        break;
        
      case 'table':
        baseQuery = `
          SELECT * FROM table_utilization
        `;
        break;
        
      case 'financial':
        baseQuery = `
          SELECT 
            DATE(gh.started_at) as date,
            SUM(gh.pot_size) as total_volume,
            COUNT(gh.hand_id) as total_hands,
            AVG(gh.pot_size) as avg_pot_size
          FROM game_history gh
        `;
        break;
    }
    
    // Add date range filter
    if (config.dateRange) {
      const dateField = config.type === 'player' ? 'ps.last_played' : 
                       config.type === 'game' ? 'game_date' : 'created_at';
      
      whereClause += `${whereClause ? ' AND ' : ' WHERE '}${dateField} BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(config.dateRange.start, config.dateRange.end);
      paramIndex += 2;
    }
    
    // Add additional filters
    if (config.filters) {
      if (config.filters.playerIds?.length) {
        whereClause += `${whereClause ? ' AND ' : ' WHERE '}player_id = ANY($${paramIndex})`;
        params.push(config.filters.playerIds);
        paramIndex++;
      }
      
      if (config.filters.minHands) {
        whereClause += `${whereClause ? ' AND ' : ' WHERE '}hands_played >= $${paramIndex}`;
        params.push(config.filters.minHands);
        paramIndex++;
      }
    }
    
    // Add groupBy
    if (config.groupBy?.length) {
      groupByClause = ` GROUP BY ${config.groupBy.join(', ')}`;
    }
    
    // Add orderBy
    if (config.sortBy) {
      orderByClause = ` ORDER BY ${config.sortBy.field} ${config.sortBy.direction}`;
    }
    
    // Add limit
    const limitClause = config.limit ? ` LIMIT ${config.limit}` : '';
    
    const sql = baseQuery + whereClause + groupByClause + orderByClause + limitClause;
    
    return { sql, params };
  }

  // ========================================
  // CUSTOM QUERIES
  // ========================================

  /**
   * Save custom query
   */
  async saveCustomQuery(query: Omit<CustomQuery, 'id' | 'created_at'>): Promise<string> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        INSERT INTO custom_analytics_queries 
        (name, description, sql_query, parameters, category, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        query.name,
        query.description,
        query.sql,
        JSON.stringify(query.parameters),
        query.category,
        query.created_by
      ]);
      
      return result.rows[0].id;
      
    } finally {
      client.release();
    }
  }

  /**
   * Execute custom query
   */
  async executeCustomQuery(queryId: string, parameters: Record<string, any> = {}): Promise<any[]> {
    const client = await this.pool.connect();
    
    try {
      // Get query definition
      const queryDef = await client.query(`
        SELECT sql_query, parameters FROM custom_analytics_queries WHERE id = $1
      `, [queryId]);
      
      if (queryDef.rows.length === 0) {
        throw new Error('Custom query not found');
      }
      
      const { sql_query, parameters: queryParams } = queryDef.rows[0];
      
      // Validate and substitute parameters
      const processedSql = this.processQueryParameters(sql_query, queryParams, parameters);
      
      // Execute query
      const result = await client.query(processedSql);
      
      // Update execution count
      await client.query(`
        UPDATE custom_analytics_queries 
        SET execution_count = execution_count + 1, last_executed = NOW()
        WHERE id = $1
      `, [queryId]);
      
      this.emit('query_executed', { queryId, rowCount: result.rows.length });
      
      return result.rows;
      
    } finally {
      client.release();
    }
  }

  private processQueryParameters(sql: string, paramDefs: any, values: Record<string, any>): string {
    let processedSql = sql;
    
    // Parse parameters if it's a string
    const parameters = typeof paramDefs === 'string' ? JSON.parse(paramDefs) : paramDefs;
    
    for (const param of parameters) {
      const value = values[param.name] ?? param.default;
      
      if (param.required && value === undefined) {
        throw new Error(`Required parameter '${param.name}' is missing`);
      }
      
      if (value !== undefined) {
        const placeholder = `{{${param.name}}}`;
        const escapedValue = this.escapeQueryValue(value, param.type);
        processedSql = processedSql.replace(new RegExp(placeholder, 'g'), escapedValue);
      }
    }
    
    return processedSql;
  }

  private escapeQueryValue(value: any, type: string): string {
    switch (type) {
      case 'string':
        return `'${value.toString().replace(/'/g, "''")}'`;
      case 'number':
        return value.toString();
      case 'date':
        return `'${new Date(value).toISOString()}'`;
      case 'boolean':
        return value ? 'TRUE' : 'FALSE';
      default:
        return `'${value.toString().replace(/'/g, "''")}'`;
    }
  }

  // ========================================
  // DATA EXPORT
  // ========================================

  /**
   * Export data to various formats
   */
  async exportData(data: any[], config: ExportConfig, filename: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      let filePath: string;
      
      switch (config.format) {
        case 'csv':
          filePath = await this.exportToCSV(data, filename, config);
          break;
        case 'json':
          filePath = await this.exportToJSON(data, filename, config);
          break;
        case 'xlsx':
          filePath = await this.exportToExcel(data, filename, config);
          break;
        case 'pdf':
          filePath = await this.exportToPDF(data, filename, config);
          break;
        default:
          throw new Error(`Unsupported export format: ${config.format}`);
      }
      
      const executionTime = Date.now() - startTime;
      
      this.emit('export_completed', {
        format: config.format,
        filePath,
        rowCount: data.length,
        executionTime
      });
      
      return filePath;
      
    } catch (error) {
      console.error('Export failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to export data: ${errorMessage}`);
    }
  }

  private async exportToCSV(data: any[], filename: string, config: ExportConfig): Promise<string> {
    const fs = require('fs').promises;
    const path = require('path');
    
    if (data.length === 0) {
      throw new Error('No data to export');
    }
    
    const headers = Object.keys(data[0]);
    let csv = '';
    
    if (config.includeHeaders) {
      csv += headers.join(',') + '\n';
    }
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value.toString();
      });
      csv += values.join(',') + '\n';
    }
    
    const filePath = path.join(process.cwd(), 'exports', `${filename}.csv`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, csv);
    
    return filePath;
  }

  private async exportToJSON(data: any[], filename: string, config: ExportConfig): Promise<string> {
    const fs = require('fs').promises;
    const path = require('path');
    
    const json = JSON.stringify(data, null, 2);
    const filePath = path.join(process.cwd(), 'exports', `${filename}.json`);
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, json);
    
    return filePath;
  }

  private async exportToExcel(data: any[], filename: string, config: ExportConfig): Promise<string> {
    // This would require a library like 'exceljs'
    // Implementation placeholder
    throw new Error('Excel export not implemented yet');
  }

  private async exportToPDF(data: any[], filename: string, config: ExportConfig): Promise<string> {
    // This would require a library like 'puppeteer' or 'pdfkit'
    // Implementation placeholder
    throw new Error('PDF export not implemented yet');
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private async getActivePlayers24h(): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT COUNT(DISTINCT UNNEST(player_ids)) as active_players
        FROM game_history 
        WHERE started_at >= NOW() - INTERVAL '24 hours'
      `);
      
      return parseInt(result.rows[0].active_players) || 0;
      
    } finally {
      client.release();
    }
  }

  private async getConversionRate(): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          COUNT(CASE WHEN ps.hands_played > 10 THEN 1 END)::DECIMAL / 
          NULLIF(COUNT(*), 0) as conversion_rate
        FROM player_statistics ps
        JOIN players p ON ps.player_id = p.id
        WHERE p.created_at >= NOW() - INTERVAL '30 days'
      `);
      
      return parseFloat(result.rows[0].conversion_rate) || 0;
      
    } finally {
      client.release();
    }
  }

  private async logReportExecution(
    config: ReportConfig, 
    userId: string | undefined, 
    executionTime: number, 
    rowCount: number
  ): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO analytics_report_history 
        (report_type, config, generated_by, execution_time_ms, row_count)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        config.type,
        JSON.stringify(config),
        userId,
        executionTime,
        rowCount
      ]);
      
    } finally {
      client.release();
    }
  }

  /**
   * Get list of custom queries
   */
  async getCustomQueries(category?: string, userId?: string): Promise<CustomQuery[]> {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT 
          id, name, description, sql_query as sql, parameters, 
          category, created_by, created_at, execution_count, last_executed
        FROM custom_analytics_queries 
        WHERE (is_public = true OR created_by = $1)
      `;
      
      const params = [userId];
      let paramIndex = 2;
      
      if (category) {
        query += ` AND category = $${paramIndex}`;
        params.push(category);
      }
      
      query += ` ORDER BY execution_count DESC, created_at DESC`;
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        ...row,
        parameters: JSON.parse(row.parameters || '[]')
      }));
      
    } finally {
      client.release();
    }
  }
}

// ========================================
// ANALYTICS FACTORY
// ========================================

export class AnalyticsFactory {
  static create(pool: Pool): AnalyticsService {
    return new AnalyticsService(pool);
  }

  static createWithAutoRefresh(pool: Pool, refreshIntervalMs: number = 3600000): AnalyticsService {
    const service = new AnalyticsService(pool);
    
    // Auto-refresh materialized views every hour
    setInterval(async () => {
      try {
        await service.refreshViews(true);
      } catch (error) {
        console.error('Auto-refresh failed:', error);
      }
    }, refreshIntervalMs);
    
    return service;
  }
}
