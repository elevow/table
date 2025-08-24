/**
 * US-014: Data Protection - Security Utilities
 * 
 * Additional utilities for data protection including:
 * - Password policy enforcement
 * - Sensitive data field management
 * - Data anonymization utilities
 * - Security audit reporting
 */

import { DataProtectionService, DataClassification, EncryptionResult, SecurityConfig } from './data-protection-service';
import { Pool } from 'pg';

// Password Policy Configuration
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  maxAge: number; // days
  preventReuse: number; // number of previous passwords to check
  lockoutThreshold: number; // failed attempts before lockout
  lockoutDuration: number; // minutes
}

// Sensitive Data Field Configuration
export interface SensitiveField {
  tableName: string;
  fieldName: string;
  classification: DataClassification;
  encryptionRequired: boolean;
  maskingPattern?: string;
  retentionDays?: number;
}

// Data Anonymization Rules
export interface AnonymizationRule {
  fieldName: string;
  strategy: 'mask' | 'hash' | 'randomize' | 'remove';
  pattern?: string;
  preserveFormat?: boolean;
}

// Security Audit Report
export interface SecurityAuditReport {
  reportId: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: {
    totalAccesses: number;
    failedAccesses: number;
    uniqueUsers: number;
    dataBreachAttempts: number;
  };
  topResources: Array<{ resource: string; accessCount: number }>;
  suspiciousActivities: Array<{
    userId: string;
    activity: string;
    timestamp: Date;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
  recommendations: string[];
}

/**
 * Enhanced Security Utilities
 */
export class SecurityUtilities {
  private static readonly DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAge: 90,
    preventReuse: 5,
    lockoutThreshold: 5,
    lockoutDuration: 30
  };

  private passwordPolicy: PasswordPolicy;
  private sensitiveFields: Map<string, SensitiveField[]> = new Map();

  constructor(
    private dataProtection: DataProtectionService,
    private pool: Pool,
    passwordPolicy?: Partial<PasswordPolicy>
  ) {
    this.passwordPolicy = { ...SecurityUtilities.DEFAULT_PASSWORD_POLICY, ...passwordPolicy };
    this.initializeSensitiveFields();
  }

  // ========================================
  // PASSWORD POLICY ENFORCEMENT
  // ========================================

  /**
   * Validate password against policy
   */
  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < this.passwordPolicy.minLength) {
      errors.push(`Password must be at least ${this.passwordPolicy.minLength} characters long`);
    }

    if (this.passwordPolicy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.passwordPolicy.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.passwordPolicy.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (this.passwordPolicy.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if password is in reuse history
   */
  async checkPasswordReuse(userId: string, password: string): Promise<boolean> {
    const result = await this.pool.query(`
      SELECT password_hash, salt FROM password_history 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `, [userId, this.passwordPolicy.preventReuse]);

    for (const row of result.rows) {
      const isMatch = await this.dataProtection.verifyHash(password, row.password_hash, row.salt);
      if (isMatch) {
        return true; // Password was used before
      }
    }

    return false; // Password is not in reuse history
  }

  /**
   * Store password in history
   */
  async storePasswordHistory(userId: string, passwordHash: string, salt: string): Promise<void> {
    await this.pool.query(`
      INSERT INTO password_history (user_id, password_hash, salt, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [userId, passwordHash, salt]);

    // Clean up old password history beyond the reuse limit
    await this.pool.query(`
      DELETE FROM password_history 
      WHERE user_id = $1 
      AND id NOT IN (
        SELECT id FROM password_history 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2
      )
    `, [userId, this.passwordPolicy.preventReuse]);
  }

  /**
   * Check and handle failed login attempts
   */
  async handleFailedLogin(userId: string): Promise<{ locked: boolean; remainingAttempts: number }> {
    // Increment failed attempts
    const result = await this.pool.query(`
      INSERT INTO login_attempts (user_id, attempted_at, success)
      VALUES ($1, NOW(), false)
      ON CONFLICT (user_id) DO UPDATE SET
        failed_count = login_attempts.failed_count + 1,
        last_attempt = NOW()
      RETURNING failed_count
    `, [userId]);

    const failedCount = result.rows[0]?.failed_count || 1;
    const remainingAttempts = Math.max(0, this.passwordPolicy.lockoutThreshold - failedCount);

    // Check if account should be locked
    if (failedCount >= this.passwordPolicy.lockoutThreshold) {
      await this.lockAccount(userId);
      return { locked: true, remainingAttempts: 0 };
    }

    return { locked: false, remainingAttempts };
  }

  /**
   * Handle successful login
   */
  async handleSuccessfulLogin(userId: string): Promise<void> {
    // Reset failed attempts
    await this.pool.query(`
      UPDATE login_attempts 
      SET failed_count = 0, last_success = NOW()
      WHERE user_id = $1
    `, [userId]);

    // Unlock account if it was locked
    await this.unlockAccount(userId);
  }

  // ========================================
  // SENSITIVE DATA MANAGEMENT
  // ========================================

  /**
   * Encrypt sensitive field data
   */
  async encryptSensitiveField(
    resourceType: string,
    resourceId: string,
    fieldName: string,
    value: string
  ): Promise<void> {
    const sensitiveField = this.getSensitiveField(resourceType, fieldName);
    if (!sensitiveField?.encryptionRequired) {
      return; // Field doesn't require encryption
    }

    const encryptionResult = await this.dataProtection.encryptSensitiveData(
      value,
      sensitiveField.classification
    );

    await this.pool.query(`
      INSERT INTO encrypted_data (
        resource_type, resource_id, field_name, 
        encrypted_value, salt, iv, algorithm, classification
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (resource_type, resource_id, field_name) 
      DO UPDATE SET
        encrypted_value = EXCLUDED.encrypted_value,
        salt = EXCLUDED.salt,
        iv = EXCLUDED.iv,
        algorithm = EXCLUDED.algorithm,
        classification = EXCLUDED.classification
    `, [
      resourceType,
      resourceId,
      fieldName,
      encryptionResult.encryptedData,
      encryptionResult.salt,
      encryptionResult.iv,
      encryptionResult.algorithm,
      sensitiveField.classification
    ]);
  }

  /**
   * Decrypt sensitive field data
   */
  async decryptSensitiveField(
    resourceType: string,
    resourceId: string,
    fieldName: string
  ): Promise<string | null> {
    const result = await this.pool.query(`
      SELECT encrypted_value, salt, iv, algorithm
      FROM encrypted_data
      WHERE resource_type = $1 AND resource_id = $2 AND field_name = $3
    `, [resourceType, resourceId, fieldName]);

    if (result.rows.length === 0) {
      return null; // No encrypted data found
    }

    const row = result.rows[0];
    const encryptionResult: EncryptionResult = {
      encryptedData: row.encrypted_value,
      salt: row.salt,
      iv: row.iv,
      algorithm: row.algorithm
    };

    return await this.dataProtection.decryptSensitiveData(encryptionResult);
  }

  /**
   * Mask sensitive data for display
   */
  maskSensitiveData(value: string, fieldName: string): string {
    // Email masking
    if (fieldName.toLowerCase().includes('email')) {
      const [user, domain] = value.split('@');
      if (user.length <= 2) return value; // Don't mask very short emails
      return `${user.charAt(0)}${'*'.repeat(user.length - 2)}${user.slice(-1)}@${domain}`;
    }

    // Phone masking
    if (fieldName.toLowerCase().includes('phone')) {
      return value.replace(/\d(?=\d{4})/g, '*');
    }

    // Credit card masking
    if (fieldName.toLowerCase().includes('card') || fieldName.toLowerCase().includes('credit')) {
      return value.replace(/\d(?=\d{4})/g, '*');
    }

    // Default masking - show first and last character
    if (value.length <= 2) return '*'.repeat(value.length);
    return `${value.charAt(0)}${'*'.repeat(value.length - 2)}${value.slice(-1)}`;
  }

  // ========================================
  // DATA ANONYMIZATION
  // ========================================

  /**
   * Anonymize data based on rules
   */
  async anonymizeData(
    tableName: string,
    conditions: string = '',
    rules: AnonymizationRule[]
  ): Promise<number> {
    const ruleMap = new Map(rules.map(rule => [rule.fieldName, rule]));
    let recordsProcessed = 0;

    // Get table schema to identify fields
    const schemaResult = await this.pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [tableName]);

    const columns = schemaResult.rows;
    const updates: string[] = [];
    const updateValues: any[] = [];
    let paramCounter = 1;

    for (const column of columns) {
      const rule = ruleMap.get(column.column_name);
      if (!rule) continue;

      switch (rule.strategy) {
        case 'mask':
          updates.push(`${column.column_name} = REGEXP_REPLACE(${column.column_name}, '${rule.pattern || '.'}', '*', 'g')`);
          break;

        case 'hash':
          updates.push(`${column.column_name} = md5(${column.column_name})`);
          break;

        case 'randomize':
          if (column.data_type === 'integer') {
            updates.push(`${column.column_name} = floor(random() * 1000000)`);
          } else {
            updates.push(`${column.column_name} = md5(random()::text)`);
          }
          break;

        case 'remove':
          updates.push(`${column.column_name} = NULL`);
          break;
      }
    }

    if (updates.length > 0) {
      const query = `
        UPDATE ${tableName} 
        SET ${updates.join(', ')}
        ${conditions ? `WHERE ${conditions}` : ''}
      `;

      const result = await this.pool.query(query, updateValues);
      recordsProcessed = result.rowCount || 0;
    }

    return recordsProcessed;
  }

  // ========================================
  // SECURITY AUDIT REPORTING
  // ========================================

  /**
   * Generate comprehensive security audit report
   */
  async generateSecurityAuditReport(startDate: Date, endDate: Date): Promise<SecurityAuditReport> {
    const reportId = `audit-${Date.now()}`;

    // Get audit summary
    const summaryResult = await this.pool.query(`
      SELECT 
        COUNT(*) as total_accesses,
        COUNT(CASE WHEN success = false THEN 1 END) as failed_accesses,
        COUNT(DISTINCT user_id) as unique_users
      FROM audit_log 
      WHERE timestamp BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const summary = summaryResult.rows[0];

    // Get top accessed resources
    const topResourcesResult = await this.pool.query(`
      SELECT resource, COUNT(*) as access_count
      FROM audit_log 
      WHERE timestamp BETWEEN $1 AND $2
      GROUP BY resource 
      ORDER BY access_count DESC 
      LIMIT 10
    `, [startDate, endDate]);

    // Detect suspicious activities
    const suspiciousResult = await this.pool.query(`
      SELECT 
        user_id,
        'Multiple failed logins' as activity,
        MAX(timestamp) as timestamp,
        CASE 
          WHEN COUNT(*) > 20 THEN 'high'
          WHEN COUNT(*) > 10 THEN 'medium'
          ELSE 'low'
        END as risk_level
      FROM audit_log 
      WHERE timestamp BETWEEN $1 AND $2 
        AND success = false 
        AND action = 'login'
      GROUP BY user_id 
      HAVING COUNT(*) > 5
      ORDER BY COUNT(*) DESC
    `, [startDate, endDate]);

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (summary.failed_accesses > summary.total_accesses * 0.1) {
      recommendations.push('High failure rate detected - review authentication mechanisms');
    }
    
    if (summary.unique_users < 10) {
      recommendations.push('Low user activity - verify monitoring coverage');
    }

    if (suspiciousResult.rows.length > 0) {
      recommendations.push('Suspicious login patterns detected - implement additional monitoring');
    }

    return {
      reportId,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary: {
        totalAccesses: parseInt(summary.total_accesses),
        failedAccesses: parseInt(summary.failed_accesses),
        uniqueUsers: parseInt(summary.unique_users),
        dataBreachAttempts: suspiciousResult.rows.filter(r => r.risk_level === 'high').length
      },
      topResources: topResourcesResult.rows.map(row => ({
        resource: row.resource,
        accessCount: parseInt(row.access_count)
      })),
      suspiciousActivities: suspiciousResult.rows.map(row => ({
        userId: row.user_id,
        activity: row.activity,
        timestamp: new Date(row.timestamp),
        riskLevel: row.risk_level as 'low' | 'medium' | 'high'
      })),
      recommendations
    };
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  private initializeSensitiveFields(): void {
    // Player table sensitive fields
    this.sensitiveFields.set('players', [
      {
        tableName: 'players',
        fieldName: 'email',
        classification: DataClassification.CONFIDENTIAL,
        encryptionRequired: true,
        retentionDays: 2555 // 7 years
      },
      {
        tableName: 'players',
        fieldName: 'password_hash',
        classification: DataClassification.RESTRICTED,
        encryptionRequired: true
      },
      {
        tableName: 'players',
        fieldName: 'ssn',
        classification: DataClassification.RESTRICTED,
        encryptionRequired: true,
        maskingPattern: 'XXX-XX-****'
      }
    ]);

    // Payment table sensitive fields
    this.sensitiveFields.set('payments', [
      {
        tableName: 'payments',
        fieldName: 'card_number',
        classification: DataClassification.RESTRICTED,
        encryptionRequired: true,
        maskingPattern: '****-****-****-****'
      },
      {
        tableName: 'payments',
        fieldName: 'cvv',
        classification: DataClassification.RESTRICTED,
        encryptionRequired: true
      }
    ]);
  }

  private getSensitiveField(tableName: string, fieldName: string): SensitiveField | undefined {
    const tableFields = this.sensitiveFields.get(tableName);
    return tableFields?.find(field => field.fieldName === fieldName);
  }

  private async lockAccount(userId: string): Promise<void> {
    const lockUntil = new Date();
    lockUntil.setMinutes(lockUntil.getMinutes() + this.passwordPolicy.lockoutDuration);

    await this.pool.query(`
      UPDATE players 
      SET account_locked_until = $1 
      WHERE id = $2
    `, [lockUntil, userId]);

    await this.dataProtection.auditAccess(
      userId,
      'account',
      'lock',
      true,
      undefined,
      { reason: 'Too many failed login attempts', lockUntil }
    );
  }

  private async unlockAccount(userId: string): Promise<void> {
    await this.pool.query(`
      UPDATE players 
      SET account_locked_until = NULL 
      WHERE id = $1
    `, [userId]);

    await this.dataProtection.auditAccess(
      userId,
      'account',
      'unlock',
      true,
      undefined,
      { reason: 'Successful login' }
    );
  }
}

/**
 * Data Protection Factory for easy setup
 */
export class DataProtectionFactory {
  static async createDataProtectionService(
    pool: Pool,
    config: Partial<SecurityConfig> = {}
  ): Promise<DataProtectionService> {
    // Import TransactionManager
    const { TransactionManager } = await import('./transaction-manager');
    
    const transactionManager = new TransactionManager(pool);

    const defaultConfig: SecurityConfig = {
      encryption: {
        algorithm: 'aes-256-gcm',
        keyRotation: 90, // days
        saltRounds: 12
      },
      access: {
        roles: ['player', 'moderator', 'admin'],
        permissions: new Map()
      },
      audit: {
        enabled: true,
        retention: 2555 // days (~7 years)
      }
    };

    const finalConfig = { ...defaultConfig, ...config };
    const dataProtection = new DataProtectionService(pool, transactionManager, finalConfig);
    
    await dataProtection.initialize();
    return dataProtection;
  }

  static async createSecurityUtilities(
    dataProtection: DataProtectionService,
    pool: Pool,
    passwordPolicy?: Partial<PasswordPolicy>
  ): Promise<SecurityUtilities> {
    return new SecurityUtilities(dataProtection, pool, passwordPolicy);
  }
}
