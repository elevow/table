/**
 * US-014: Data Protection - Comprehensive Test Suite
 */

import { Pool } from 'pg';
import { DataProtectionService, DataClassification, SecurityConfig } from '../data-protection-service';
import { SecurityUtilities, PasswordPolicy } from '../security-utilities';
import { TransactionManager } from '../transaction-manager';

// Mock PostgreSQL Pool
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as any;

// Mock TransactionManager
const mockTransactionManager = {
  beginTransaction: jest.fn(),
  executeInTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn()
} as any;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool)
}));

jest.mock('../transaction-manager', () => ({
  TransactionManager: jest.fn().mockImplementation(() => mockTransactionManager)
}));

describe('US-014: Data Protection Service', () => {
  let mockPool: any;
  let mockTransactionManager: any;
  let dataProtectionService: DataProtectionService;
  let securityUtilities: SecurityUtilities;

  const mockSecurityConfig: SecurityConfig = {
    encryption: {
      algorithm: 'aes-256-cbc', // Use CBC mode for simpler testing
      keyRotation: 90,
      saltRounds: 10 // Lower for testing
    },
    access: {
      roles: ['player', 'moderator', 'admin'],
      permissions: new Map()
    },
    audit: {
      enabled: true,
      retention: 365
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mocks
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: jest.fn(),
      end: jest.fn()
    };

    mockTransactionManager = {
      beginTransaction: jest.fn(),
      executeInTransaction: jest.fn().mockResolvedValue({ rowCount: 1 }),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn()
    };

    // Mock transaction context
    const mockContext = {
      id: 'test-transaction',
      client: { query: jest.fn(), release: jest.fn() },
      config: { isolationLevel: 'read_committed' as const, timeout: 5000, retryPolicy: { maxAttempts: 3, baseDelay: 100, backoffFactor: 2, jitter: true } },
      startTime: new Date(),
      operations: [],
      status: 'active' as const,
      savepoints: new Map()
    };

    mockTransactionManager.beginTransaction.mockResolvedValue(mockContext);

    dataProtectionService = new DataProtectionService(mockPool, mockTransactionManager, mockSecurityConfig);
    securityUtilities = new SecurityUtilities(dataProtectionService, mockPool);
  });

  describe('Data Encryption', () => {
    test('should encrypt sensitive data with proper algorithm', async () => {
      const plaintext = 'sensitive-email@example.com';
      
      const result = await dataProtectionService.encryptSensitiveData(plaintext);

      expect(result).toHaveProperty('encryptedData');
      expect(result).toHaveProperty('salt');
      expect(result).toHaveProperty('iv');
      expect(result.algorithm).toBe('aes-256-cbc');
      expect(result.encryptedData).not.toBe(plaintext);
      expect(result.salt).toHaveLength(64); // 32 bytes as hex
      expect(result.iv).toHaveLength(32); // 16 bytes as hex
    });

    test('should decrypt data back to original', async () => {
      const plaintext = 'test-password-123';
      
      const encrypted = await dataProtectionService.encryptSensitiveData(plaintext);
      const decrypted = await dataProtectionService.decryptSensitiveData(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('should hash data with salt for passwords', async () => {
      const password = 'MySecurePassword123!';
      
      const result = await dataProtectionService.hashWithSalt(password);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('salt');
      expect(result.hash).toHaveLength(128); // 64 bytes as hex
      expect(result.salt).toHaveLength(64); // 32 bytes as hex
      expect(result.hash).not.toBe(password);
    });

    test('should verify hashed passwords correctly', async () => {
      const password = 'TestPassword456!';
      
      const { hash, salt } = await dataProtectionService.hashWithSalt(password);
      const isValid = await dataProtectionService.verifyHash(password, hash, salt);
      const isInvalid = await dataProtectionService.verifyHash('WrongPassword', hash, salt);

      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });
  });

  describe('Access Control', () => {
    beforeEach(() => {
      mockPool.query.mockImplementation((query: string, params?: any[]) => {
        if (query.includes('SELECT role_id FROM user_roles')) {
          if (params?.[0] === 'player-1') {
            return Promise.resolve({ rows: [{ role_id: 'player' }], rowCount: 1 });
          } else if (params?.[0] === 'admin-1') {
            return Promise.resolve({ rows: [{ role_id: 'admin' }], rowCount: 1 });
          }
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
    });

    test('should allow access for users with proper permissions', async () => {
      const hasPermission = await dataProtectionService.checkPermission(
        'admin-1',
        'players',
        'read',
        DataClassification.CONFIDENTIAL
      );

      expect(hasPermission).toBe(true);
    });

    test('should deny access for users without permissions', async () => {
      const hasPermission = await dataProtectionService.checkPermission(
        'player-1',
        'admin_panel',
        'write',
        DataClassification.RESTRICTED
      );

      expect(hasPermission).toBe(false);
    });

    test('should allow players to access their own data', async () => {
      const hasPermission = await dataProtectionService.checkPermission(
        'player-1',
        'profile',
        'read',
        DataClassification.INTERNAL
      );

      expect(hasPermission).toBe(true);
    });

    test('should assign roles to users', async () => {
      await dataProtectionService.assignRole('user-1', 'moderator');

      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        ['user-1', 'moderator']
      );
    });

    test('should revoke roles from users', async () => {
      await dataProtectionService.revokeRole('user-1', 'moderator');

      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
        ['user-1', 'moderator']
      );
    });
  });

  describe('Audit Logging', () => {
    test('should log successful access attempts', async () => {
      await dataProtectionService.auditAccess(
        'user-1',
        'players',
        'read',
        true
      );

      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining(['user-1', 'players', 'read', expect.any(Date), true])
      );
    });

    test('should log failed access attempts with error messages', async () => {
      await dataProtectionService.auditAccess(
        'user-1',
        'admin_panel',
        'access',
        false,
        'Insufficient permissions'
      );

      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining(['user-1', 'admin_panel', 'access', expect.any(Date), false, 'Insufficient permissions'])
      );
    });

    test('should retrieve audit trail with filters', async () => {
      const mockAuditEntries = [
        {
          id: '1',
          user_id: 'user-1',
          resource: 'players',
          action: 'read',
          timestamp: new Date().toISOString(),
          success: true,
          error_message: null,
          metadata: '{}'
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockAuditEntries, rowCount: 1 } as any);

      const auditTrail = await dataProtectionService.getAuditTrail({
        userId: 'user-1',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        limit: 100
      });

      expect(auditTrail).toHaveLength(1);
      expect(auditTrail[0]).toMatchObject({
        id: '1',
        userId: 'user-1',
        resource: 'players',
        action: 'read',
        success: true
      });
    });

    test('should not log when audit is disabled', async () => {
      const disabledConfig = {
        ...mockSecurityConfig,
        audit: { enabled: false, retention: 0 }
      };
      
      const disabledService = new DataProtectionService(mockPool, mockTransactionManager, disabledConfig);
      
      await disabledService.auditAccess('user-1', 'test', 'read', true);

      expect(mockTransactionManager.executeInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Data Retention', () => {
    test('should set and apply retention policies', async () => {
      dataProtectionService.setRetentionPolicy({
        resourceType: 'audit_log',
        retentionPeriodDays: 365,
        purgeAfterDays: 365
      });

      const results = await dataProtectionService.applyRetentionPolicies();

      expect(results).toHaveLength(3); // Default policies
      expect(results.some(r => r.resourceType === 'audit_log')).toBe(true);
    });

    test('should get retention status for all policies', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: '100' }], rowCount: 1 } as any);

      const status = await dataProtectionService.getRetentionStatus();

      expect(status.length).toBeGreaterThan(0);
      expect(status[0]).toHaveProperty('resourceType');
      expect(status[0]).toHaveProperty('totalRecords');
      expect(status[0]).toHaveProperty('eligibleForArchive');
      expect(status[0]).toHaveProperty('eligibleForPurge');
    });
  });

  describe('Password Policy Enforcement', () => {
    test('should validate strong passwords', () => {
      const strongPassword = 'MyVerySecurePassword123!@#';
      
      const result = securityUtilities.validatePassword(strongPassword);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject weak passwords', () => {
      const weakPassword = 'weak';
      
      const result = securityUtilities.validatePassword(weakPassword);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('at least'))).toBe(true);
    });

    test('should check password reuse history', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { 
            password_hash: 'hash1', 
            salt: 'salt1' 
          }
        ],
        rowCount: 1
      } as any);

      // Mock the verify hash to return true for reused password
      jest.spyOn(dataProtectionService, 'verifyHash').mockResolvedValueOnce(true);

      const isReused = await securityUtilities.checkPasswordReuse('user-1', 'password123');

      expect(isReused).toBe(true);
    });

    test('should handle failed login attempts and account lockout', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ failed_count: 5 }],
        rowCount: 1
      } as any);

      const result = await securityUtilities.handleFailedLogin('user-1');

      expect(result.locked).toBe(true);
      expect(result.remainingAttempts).toBe(0);
    });

    test('should reset failed attempts on successful login', async () => {
      await securityUtilities.handleSuccessfulLogin('user-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE login_attempts'),
        ['user-1']
      );
    });
  });

  describe('Sensitive Data Management', () => {
    test('should mask email addresses properly', () => {
      const email = 'user@example.com';
      
      const masked = securityUtilities.maskSensitiveData(email, 'email');

      expect(masked).toBe('u**r@example.com');
      expect(masked).not.toBe(email);
    });

    test('should mask phone numbers', () => {
      const phone = '1234567890';
      
      const masked = securityUtilities.maskSensitiveData(phone, 'phone');

      expect(masked).toMatch(/\*+7890$/);
    });

    test('should encrypt and store sensitive field data', async () => {
      await securityUtilities.encryptSensitiveField(
        'players',
        'user-1',
        'email',
        'test@example.com'
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO encrypted_data'),
        expect.arrayContaining(['players', 'user-1', 'email'])
      );
    });

    test('should decrypt sensitive field data', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          encrypted_value: 'encrypted_data',
          salt: 'salt_value',
          iv: 'iv_value',
          algorithm: 'aes-256-cbc'
        }],
        rowCount: 1
      } as any);

      jest.spyOn(dataProtectionService, 'decryptSensitiveData').mockResolvedValueOnce('decrypted_value');

      const result = await securityUtilities.decryptSensitiveField('players', 'user-1', 'email');

      expect(result).toBe('decrypted_value');
    });
  });

  describe('Data Anonymization', () => {
    test('should anonymize data based on rules', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            { column_name: 'email', data_type: 'varchar' },
            { column_name: 'phone', data_type: 'varchar' }
          ],
          rowCount: 2
        } as any)
        .mockResolvedValueOnce({ rows: [], rowCount: 5 } as any);

      const rules = [
        { fieldName: 'email', strategy: 'mask' as const, pattern: '@.*' },
        { fieldName: 'phone', strategy: 'hash' as const }
      ];

      const processed = await securityUtilities.anonymizeData('players', 'created_at < NOW() - INTERVAL \'1 year\'', rules);

      expect(processed).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE players'),
        []
      );
    });
  });

  describe('Security Audit Reporting', () => {
    test('should generate comprehensive security audit report', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      // Mock audit summary query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            total_accesses: '1000',
            failed_accesses: '50',
            unique_users: '100'
          }],
          rowCount: 1
        } as any)
        .mockResolvedValueOnce({
          rows: [
            { resource: 'players', access_count: '500' },
            { resource: 'games', access_count: '300' }
          ],
          rowCount: 2
        } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: 'suspicious-user',
              activity: 'Multiple failed logins',
              timestamp: new Date().toISOString(),
              risk_level: 'high'
            }
          ],
          rowCount: 1
        } as any);

      const report = await securityUtilities.generateSecurityAuditReport(startDate, endDate);

      expect(report).toHaveProperty('reportId');
      expect(report).toHaveProperty('generatedAt');
      expect(report.period.start).toEqual(startDate);
      expect(report.period.end).toEqual(endDate);
      expect(report.summary.totalAccesses).toBe(1000);
      expect(report.summary.failedAccesses).toBe(50);
      expect(report.topResources).toHaveLength(2);
      expect(report.suspiciousActivities).toHaveLength(1);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('System Integration', () => {
    test('should initialize all security tables and triggers', async () => {
      await dataProtectionService.initialize();

      // Verify multiple transaction calls for table creation
      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalled();
      expect(mockTransactionManager.commitTransaction).toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      mockTransactionManager.executeInTransaction.mockRejectedValueOnce(new Error('Database error'));
      mockTransactionManager.rollbackTransaction.mockResolvedValueOnce();

      await expect(dataProtectionService.assignRole('user-1', 'invalid-role')).rejects.toThrow('Database error');
      expect(mockTransactionManager.rollbackTransaction).toHaveBeenCalled();
    });

    test('should support the RequirePermission decorator', async () => {
      // This would be tested in integration with actual services that use the decorator
      const { RequirePermission } = await import('../data-protection-service');
      
      expect(RequirePermission).toBeDefined();
      expect(typeof RequirePermission).toBe('function');
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large audit trail queries efficiently', async () => {
      const largeAuditData = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        user_id: `user-${i % 10}`,
        resource: 'players',
        action: 'read',
        timestamp: new Date().toISOString(),
        success: true,
        error_message: null,
        metadata: '{}'
      }));

      mockPool.query.mockResolvedValueOnce({ rows: largeAuditData, rowCount: 1000 } as any);

      const auditTrail = await dataProtectionService.getAuditTrail({ limit: 1000 });

      expect(auditTrail).toHaveLength(1000);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([1000])
      );
    });

    test('should batch process retention policies efficiently', async () => {
      // Set multiple retention policies
      const policies = [
        { resourceType: 'logs', retentionPeriodDays: 90, purgeAfterDays: 90 },
        { resourceType: 'sessions', retentionPeriodDays: 30, purgeAfterDays: 30 },
        { resourceType: 'cache', retentionPeriodDays: 7, purgeAfterDays: 7 }
      ];

      policies.forEach(policy => dataProtectionService.setRetentionPolicy(policy));

      const results = await dataProtectionService.applyRetentionPolicies();

      expect(results.length).toBeGreaterThanOrEqual(policies.length);
      expect(mockTransactionManager.executeInTransaction).toHaveBeenCalled();
    });
  });
});
