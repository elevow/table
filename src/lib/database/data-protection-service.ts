/**
 * US-014: Data Protection Service
 * 
 * Provides comprehensive data protection capabilities including:
 * - Sensitive data encryption
 * - Access control enforcement
 * - Data access auditing
 * - Data retention policy management
 */

import { createHash, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { TransactionManager, TransactionContext } from './transaction-manager';

// Security Configuration Interface
export interface SecurityConfig {
  encryption: {
    algorithm: string;
    keyRotation: number;
    saltRounds: number;
  };
  access: {
    roles: string[];
    permissions: Map<string, string[]>;
  };
  audit: {
    enabled: boolean;
    retention: number;
  };
}

// Data Classification Levels
export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted'
}

// Access Control Types
export interface AccessPermission {
  resource: string;
  action: 'read' | 'write' | 'delete' | 'admin';
  classification: DataClassification;
}

export interface UserRole {
  id: string;
  name: string;
  permissions: AccessPermission[];
  inheritFrom?: string[];
}

export interface AuditEntry {
  id: string;
  userId: string;
  resource: string;
  action: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
}

// Encryption Result
export interface EncryptionResult {
  encryptedData: string;
  salt: string;
  iv: string;
  algorithm: string;
}

// Data Retention Policy
export interface RetentionPolicy {
  resourceType: string;
  retentionPeriodDays: number;
  archiveAfterDays?: number;
  purgeAfterDays: number;
  exemptions?: string[];
}

/**
 * Core Data Protection Service
 */
export class DataProtectionService {
  private config: SecurityConfig;
  private masterKey: Buffer;
  private roles: Map<string, UserRole> = new Map();
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();

  constructor(
    private pool: Pool,
    private transactionManager: TransactionManager,
    config: SecurityConfig
  ) {
    this.config = config;
    this.masterKey = this.deriveMasterKey();
    this.initializeDefaultRoles();
    this.initializeDefaultRetentionPolicies();
  }

  /**
   * Initialize the data protection system
   */
  async initialize(): Promise<void> {
    await this.createSecurityTables();
    await this.createAuditTriggers();
    await this.setupDefaultPolicies();
  }

  // ========================================
  // DATA ENCRYPTION
  // ========================================

  /**
   * Encrypt sensitive data
   */
  async encryptSensitiveData(
    plaintext: string,
    classification: DataClassification = DataClassification.CONFIDENTIAL
  ): Promise<EncryptionResult> {
    const salt = randomBytes(32);
    const iv = randomBytes(16);
    
    // Derive encryption key using PBKDF2
    const key = pbkdf2Sync(
      this.masterKey,
      salt,
      this.config.encryption.saltRounds,
      32,
      'sha256'
    );

    // Encrypt data
    const cipher = createCipheriv(this.config.encryption.algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // For AES-256-GCM, append the authentication tag
    if (this.config.encryption.algorithm === 'aes-256-gcm') {
      const authTag = (cipher as any).getAuthTag();
      encrypted += authTag.toString('hex');
    }

    return {
      encryptedData: encrypted,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      algorithm: this.config.encryption.algorithm
    };
  }

  /**
   * Decrypt sensitive data
   */
  async decryptSensitiveData(encryptionResult: EncryptionResult): Promise<string> {
    const salt = Buffer.from(encryptionResult.salt, 'hex');
    const iv = Buffer.from(encryptionResult.iv, 'hex');
    
    // Derive decryption key
    const key = pbkdf2Sync(
      this.masterKey,
      salt,
      this.config.encryption.saltRounds,
      32,
      'sha256'
    );

    // For AES-256-GCM, we need to handle authentication tag
    if (encryptionResult.algorithm === 'aes-256-gcm') {
      // Extract encrypted data and auth tag
      const encryptedDataHex = encryptionResult.encryptedData;
      const encryptedBuffer = Buffer.from(encryptedDataHex.slice(0, -32), 'hex'); // Remove last 16 bytes (32 hex chars)
      const authTag = Buffer.from(encryptedDataHex.slice(-32), 'hex'); // Last 16 bytes as auth tag

      const decipher = createDecipheriv(encryptionResult.algorithm, key, iv);
      (decipher as any).setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedBuffer, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } else {
      // For other algorithms
      const decipher = createDecipheriv(encryptionResult.algorithm, key, iv);
      let decrypted = decipher.update(encryptionResult.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    }
  }

  /**
   * Hash data with salt (for passwords, etc.)
   */
  async hashWithSalt(data: string, customSalt?: string): Promise<{ hash: string; salt: string }> {
    const salt = customSalt || randomBytes(32).toString('hex');
    const hash = pbkdf2Sync(data, salt, this.config.encryption.saltRounds, 64, 'sha256');
    
    return {
      hash: hash.toString('hex'),
      salt
    };
  }

  /**
   * Verify hashed data
   */
  async verifyHash(data: string, hash: string, salt: string): Promise<boolean> {
    const computedHash = pbkdf2Sync(data, salt, this.config.encryption.saltRounds, 64, 'sha256');
    return computedHash.toString('hex') === hash;
  }

  // ========================================
  // ACCESS CONTROL
  // ========================================

  /**
   * Check if user has permission for a specific action
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    classification: DataClassification = DataClassification.INTERNAL
  ): Promise<boolean> {
    const userRoles = await this.getUserRoles(userId);
    
    for (const role of userRoles) {
      const roleObj = this.roles.get(role);
      if (!roleObj) continue;

      // Check direct permissions
      const hasPermission = this.checkRolePermission(roleObj, resource, action, classification);
      if (hasPermission) {
        await this.auditAccess(userId, resource, action, true);
        return true;
      }

      // Check inherited permissions
      if (roleObj.inheritFrom) {
        for (const inheritedRole of roleObj.inheritFrom) {
          const inherited = this.roles.get(inheritedRole);
          if (inherited && this.checkRolePermission(inherited, resource, action, classification)) {
            await this.auditAccess(userId, resource, action, true);
            return true;
          }
        }
      }
    }

    await this.auditAccess(userId, resource, action, false, 'Access denied');
    return false;
  }

  /**
   * Add role to user
   */
  async assignRole(userId: string, roleId: string): Promise<void> {
    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 5000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      await this.transactionManager.executeInTransaction(
        context,
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleId]
      );

      await this.transactionManager.commitTransaction(context);
      await this.auditAccess(userId, 'user_roles', 'assign', true, undefined, { roleId });
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      throw error;
    }
  }

  /**
   * Remove role from user
   */
  async revokeRole(userId: string, roleId: string): Promise<void> {
    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 5000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      await this.transactionManager.executeInTransaction(
        context,
        'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
        [userId, roleId]
      );

      await this.transactionManager.commitTransaction(context);
      await this.auditAccess(userId, 'user_roles', 'revoke', true, undefined, { roleId });
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      throw error;
    }
  }

  // ========================================
  // AUDIT LOGGING
  // ========================================

  /**
   * Log data access for audit purposes
   */
  async auditAccess(
    userId: string,
    resource: string,
    action: string,
    success: boolean,
    errorMessage?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.config.audit.enabled) return;

    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 5000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      await this.transactionManager.executeInTransaction(
        context,
        `INSERT INTO audit_log (
          user_id, resource, action, timestamp, success, error_message, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          resource,
          action,
          new Date(),
          success,
          errorMessage,
          JSON.stringify(metadata || {})
        ]
      );

      await this.transactionManager.commitTransaction(context);
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      // Don't throw here to avoid infinite loops in audit logging
      console.error('Failed to log audit entry:', error);
    }
  }

  /**
   * Get audit trail for a user or resource
   */
  async getAuditTrail(
    filters: {
      userId?: string;
      resource?: string;
      action?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    } = {}
  ): Promise<AuditEntry[]> {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters.userId) {
      params.push(filters.userId);
      query += ` AND user_id = $${++paramCount}`;
    }

    if (filters.resource) {
      params.push(filters.resource);
      query += ` AND resource = $${++paramCount}`;
    }

    if (filters.action) {
      params.push(filters.action);
      query += ` AND action = $${++paramCount}`;
    }

    if (filters.startDate) {
      params.push(filters.startDate);
      query += ` AND timestamp >= $${++paramCount}`;
    }

    if (filters.endDate) {
      params.push(filters.endDate);
      query += ` AND timestamp <= $${++paramCount}`;
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      params.push(filters.limit);
      query += ` LIMIT $${++paramCount}`;
    }

    const result = await this.pool.query(query, params);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      resource: row.resource,
      action: row.action,
      timestamp: new Date(row.timestamp),
      success: row.success,
      errorMessage: row.error_message,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  // ========================================
  // DATA RETENTION
  // ========================================

  /**
   * Set retention policy for a resource type
   */
  setRetentionPolicy(policy: RetentionPolicy): void {
    this.retentionPolicies.set(policy.resourceType, policy);
  }

  /**
   * Apply retention policies (cleanup old data)
   */
  async applyRetentionPolicies(): Promise<{
    resourceType: string;
    recordsArchived: number;
    recordsPurged: number;
  }[]> {
    const results: { resourceType: string; recordsArchived: number; recordsPurged: number; }[] = [];

    // Convert Map to array for iteration
    for (const entry of Array.from(this.retentionPolicies.entries())) {
      const [resourceType, policy] = entry;
      const result = await this.applyRetentionPolicy(policy);
      results.push({
        resourceType,
        recordsArchived: result.archived,
        recordsPurged: result.purged
      });
    }

    return results;
  }

  /**
   * Get data retention status
   */
  async getRetentionStatus(): Promise<{
    resourceType: string;
    totalRecords: number;
    eligibleForArchive: number;
    eligibleForPurge: number;
  }[]> {
    const status: {
      resourceType: string;
      totalRecords: number;
      eligibleForArchive: number;
      eligibleForPurge: number;
    }[] = [];

    // Convert Map to array for iteration
    for (const entry of Array.from(this.retentionPolicies.entries())) {
      const [resourceType, policy] = entry;
      const archiveDate = new Date();
      archiveDate.setDate(archiveDate.getDate() - (policy.archiveAfterDays || policy.retentionPeriodDays));

      const purgeDate = new Date();
      purgeDate.setDate(purgeDate.getDate() - policy.purgeAfterDays);

      // This is a simplified example - actual implementation would depend on table structure
      const tableName = this.getTableNameForResource(resourceType);
      
      try {
        const totalResult = await this.pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const archiveResult = await this.pool.query(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE created_at < $1`,
          [archiveDate]
        );
        const purgeResult = await this.pool.query(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE created_at < $1`,
          [purgeDate]
        );

        status.push({
          resourceType,
          totalRecords: parseInt(totalResult.rows[0].count),
          eligibleForArchive: parseInt(archiveResult.rows[0].count),
          eligibleForPurge: parseInt(purgeResult.rows[0].count)
        });
      } catch (error) {
        console.warn(`Could not get retention status for ${resourceType}:`, error);
      }
    }

    return status;
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  private deriveMasterKey(): Buffer {
    // In production, this should come from a secure key management system
    const keyMaterial = process.env.DATA_PROTECTION_KEY || 'default-key-change-in-production';
    return createHash('sha256').update(keyMaterial).digest();
  }

  private initializeDefaultRoles(): void {
    // Player role - basic access
    this.roles.set('player', {
      id: 'player',
      name: 'Player',
      permissions: [
        { resource: 'profile', action: 'read', classification: DataClassification.INTERNAL },
        { resource: 'profile', action: 'write', classification: DataClassification.INTERNAL },
        { resource: 'game_history', action: 'read', classification: DataClassification.INTERNAL }
      ]
    });

    // Moderator role - extended access
    this.roles.set('moderator', {
      id: 'moderator',
      name: 'Moderator',
      permissions: [
        { resource: 'players', action: 'read', classification: DataClassification.CONFIDENTIAL },
        { resource: 'game_history', action: 'read', classification: DataClassification.CONFIDENTIAL },
        { resource: 'audit_log', action: 'read', classification: DataClassification.CONFIDENTIAL }
      ],
      inheritFrom: ['player']
    });

    // Admin role - full access
    this.roles.set('admin', {
      id: 'admin',
      name: 'Administrator',
      permissions: [
        { resource: '*', action: 'admin', classification: DataClassification.RESTRICTED }
      ],
      inheritFrom: ['moderator']
    });
  }

  private initializeDefaultRetentionPolicies(): void {
    // Audit logs - keep for 7 years for compliance
    this.setRetentionPolicy({
      resourceType: 'audit_log',
      retentionPeriodDays: 2555, // ~7 years
      archiveAfterDays: 365, // Archive after 1 year
      purgeAfterDays: 2555
    });

    // Game history - keep for 2 years
    this.setRetentionPolicy({
      resourceType: 'game_history',
      retentionPeriodDays: 730,
      archiveAfterDays: 365,
      purgeAfterDays: 730
    });

    // Session logs - keep for 90 days
    this.setRetentionPolicy({
      resourceType: 'session_log',
      retentionPeriodDays: 90,
      purgeAfterDays: 90
    });
  }

  private checkRolePermission(
    role: UserRole,
    resource: string,
    action: string,
    classification: DataClassification
  ): boolean {
    for (const permission of role.permissions) {
      // Check for wildcard permissions
      if (permission.resource === '*' && permission.action === 'admin') {
        return true;
      }

      // Check specific resource and action
      if (permission.resource === resource && permission.action === action) {
        // Check classification level
        return this.isClassificationAllowed(permission.classification, classification);
      }

      // Check resource pattern matching
      if (permission.resource.endsWith('*') && 
          resource.startsWith(permission.resource.slice(0, -1)) &&
          permission.action === action) {
        return this.isClassificationAllowed(permission.classification, classification);
      }
    }

    return false;
  }

  private isClassificationAllowed(
    allowedClassification: DataClassification,
    requestedClassification: DataClassification
  ): boolean {
    const levels = {
      [DataClassification.PUBLIC]: 0,
      [DataClassification.INTERNAL]: 1,
      [DataClassification.CONFIDENTIAL]: 2,
      [DataClassification.RESTRICTED]: 3
    };

    return levels[allowedClassification] >= levels[requestedClassification];
  }

  private async getUserRoles(userId: string): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [userId]
    );

    return result.rows.map((row: any) => row.role_id);
  }

  private async applyRetentionPolicy(policy: RetentionPolicy): Promise<{ archived: number; purged: number }> {
    let archived = 0;
    let purged = 0;

    const tableName = this.getTableNameForResource(policy.resourceType);
    
    // Archive old records if archive period is specified
    if (policy.archiveAfterDays) {
      const archiveDate = new Date();
      archiveDate.setDate(archiveDate.getDate() - policy.archiveAfterDays);

      try {
        const context = await this.transactionManager.beginTransaction({
          isolationLevel: 'read_committed',
          timeout: 30000,
          retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
        });

        try {
          // Move to archive table
          await this.transactionManager.executeInTransaction(
            context,
            `INSERT INTO ${tableName}_archive 
             SELECT * FROM ${tableName} 
             WHERE created_at < $1 AND archived_at IS NULL`,
            [archiveDate]
          );

          // Mark as archived
          const result = await this.transactionManager.executeInTransaction(
            context,
            `UPDATE ${tableName} 
             SET archived_at = NOW() 
             WHERE created_at < $1 AND archived_at IS NULL`,
            [archiveDate]
          );

          await this.transactionManager.commitTransaction(context);
          archived = result.rowCount || 0;
        } catch (error) {
          await this.transactionManager.rollbackTransaction(context);
          throw error;
        }
      } catch (error) {
        console.warn(`Archive failed for ${policy.resourceType}:`, error);
      }
    }

    // Purge very old records
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() - policy.purgeAfterDays);

    try {
      const context = await this.transactionManager.beginTransaction({
        isolationLevel: 'read_committed',
        timeout: 30000,
        retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
      });

      try {
        const result = await this.transactionManager.executeInTransaction(
          context,
          `DELETE FROM ${tableName} WHERE created_at < $1`,
          [purgeDate]
        );

        await this.transactionManager.commitTransaction(context);
        purged = result.rowCount || 0;
      } catch (error) {
        await this.transactionManager.rollbackTransaction(context);
        throw error;
      }
    } catch (error) {
      console.warn(`Purge failed for ${policy.resourceType}:`, error);
    }

    return { archived, purged };
  }

  private getTableNameForResource(resourceType: string): string {
    // Map resource types to actual table names
    const tableMap: Record<string, string> = {
      'audit_log': 'audit_log',
      'game_history': 'game_history',
      'session_log': 'session_log',
      'player_actions': 'player_actions'
    };

    return tableMap[resourceType] || resourceType;
  }

  private async createSecurityTables(): Promise<void> {
    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 30000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      // User roles table
      await this.transactionManager.executeInTransaction(
        context,
        `CREATE TABLE IF NOT EXISTS user_roles (
          user_id UUID NOT NULL,
          role_id VARCHAR(50) NOT NULL,
          assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          assigned_by UUID,
          PRIMARY KEY (user_id, role_id)
        )`
      );

      // Audit log table
      await this.transactionManager.executeInTransaction(
        context,
        `CREATE TABLE IF NOT EXISTS audit_log (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL,
          resource VARCHAR(255) NOT NULL,
          action VARCHAR(100) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          success BOOLEAN NOT NULL,
          error_message TEXT,
          metadata JSONB,
          ip_address INET,
          user_agent TEXT
        )`
      );

      // Encrypted data storage table
      await this.transactionManager.executeInTransaction(
        context,
        `CREATE TABLE IF NOT EXISTS encrypted_data (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          resource_type VARCHAR(100) NOT NULL,
          resource_id UUID NOT NULL,
          field_name VARCHAR(100) NOT NULL,
          encrypted_value TEXT NOT NULL,
          salt VARCHAR(64) NOT NULL,
          iv VARCHAR(32) NOT NULL,
          algorithm VARCHAR(50) NOT NULL,
          classification VARCHAR(20) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(resource_type, resource_id, field_name)
        )`
      );

      // Create indexes for performance
      await this.transactionManager.executeInTransaction(
        context,
        'CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)'
      );
      await this.transactionManager.executeInTransaction(
        context,
        'CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource)'
      );
      await this.transactionManager.executeInTransaction(
        context,
        'CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)'
      );
      await this.transactionManager.executeInTransaction(
        context,
        'CREATE INDEX IF NOT EXISTS idx_encrypted_data_resource ON encrypted_data(resource_type, resource_id)'
      );

      await this.transactionManager.commitTransaction(context);
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      throw error;
    }
  }

  private async createAuditTriggers(): Promise<void> {
    // Create audit triggers for sensitive tables
    const auditTrigger = `
      CREATE OR REPLACE FUNCTION audit_trigger_function()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO audit_log (user_id, resource, action, timestamp, success, metadata)
        VALUES (
          COALESCE(current_setting('app.current_user_id', true)::UUID, '00000000-0000-0000-0000-000000000000'),
          TG_TABLE_NAME,
          TG_OP,
          NOW(),
          true,
          json_build_object(
            'old', CASE WHEN TG_OP = 'DELETE' THEN to_json(OLD) ELSE NULL END,
            'new', CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_json(NEW) ELSE NULL END
          )
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `;

    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 30000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      await this.transactionManager.executeInTransaction(context, auditTrigger);

      // Add triggers to sensitive tables
      const tables = ['players', 'game_history', 'user_roles'];
      for (const table of tables) {
        await this.transactionManager.executeInTransaction(
          context,
          `CREATE TRIGGER ${table}_audit_trigger
           AFTER INSERT OR UPDATE OR DELETE ON ${table}
           FOR EACH ROW EXECUTE FUNCTION audit_trigger_function()`
        );
      }

      await this.transactionManager.commitTransaction(context);
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      throw error;
    }
  }

  private async setupDefaultPolicies(): Promise<void> {
    // Setup default security policies in database
    const context = await this.transactionManager.beginTransaction({
      isolationLevel: 'read_committed',
      timeout: 30000,
      retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true }
    });

    try {
      // Enable row level security on sensitive tables
      await this.transactionManager.executeInTransaction(
        context,
        'ALTER TABLE players ENABLE ROW LEVEL SECURITY'
      );
      await this.transactionManager.executeInTransaction(
        context,
        'ALTER TABLE game_history ENABLE ROW LEVEL SECURITY'
      );
      
      // Create RLS policies
      await this.transactionManager.executeInTransaction(
        context,
        `CREATE POLICY players_self_access ON players
         USING (id = current_setting('app.current_user_id')::UUID)`
      );

      await this.transactionManager.commitTransaction(context);
    } catch (error) {
      await this.transactionManager.rollbackTransaction(context);
      throw error;
    }
  }
}

/**
 * Decorator for protecting method calls with access control
 */
export function RequirePermission(resource: string, action: string, classification: DataClassification = DataClassification.INTERNAL) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const dataProtection = (this as any).dataProtection as DataProtectionService;
      const userId = (this as any).getCurrentUserId?.() || args[0];

      if (!dataProtection) {
        throw new Error('DataProtectionService not available');
      }

      const hasPermission = await dataProtection.checkPermission(userId, resource, action, classification);
      if (!hasPermission) {
        throw new Error(`Access denied: insufficient permissions for ${action} on ${resource}`);
      }

      return method.apply(this, args);
    };
  };
}
