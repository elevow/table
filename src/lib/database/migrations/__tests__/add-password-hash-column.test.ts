import { ADD_PASSWORD_HASH_COLUMN } from '../add-password-hash-column';
import { MigrationConfig } from '../../config-driven-migration';

describe('ADD_PASSWORD_HASH_COLUMN Migration', () => {
  let migration: MigrationConfig;

  beforeEach(() => {
    migration = ADD_PASSWORD_HASH_COLUMN;
  });

  describe('Migration Configuration', () => {
    it('should have the correct version', () => {
      expect(migration.version).toBe('2025.09.15.1001');
    });

    it('should have a meaningful description', () => {
      expect(migration.description).toBe('Add password_hash column to users table for secure password storage');
      expect(migration.description).toBeTruthy();
    });

    it('should have the correct dependencies', () => {
      expect(migration.dependencies).toEqual(['2025.09.02.1001']);
      expect(migration.dependencies).toHaveLength(1);
    });

    it('should be a valid MigrationConfig object', () => {
      expect(migration).toMatchObject({
        version: expect.any(String),
        description: expect.any(String),
        dependencies: expect.any(Array),
        preChecks: expect.any(Array),
        steps: expect.any(Array),
        postChecks: expect.any(Array),
        rollback: expect.any(Array)
      });
    });
  });

  describe('Pre-checks', () => {
    it('should have exactly one pre-check', () => {
      expect(migration.preChecks).toHaveLength(1);
    });

    it('should check for users table existence', () => {
      const preCheck = migration.preChecks[0];
      
      expect(preCheck.name).toBe('users_table_exists');
      expect(preCheck.sql).toBe(
        `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='users'`
      );
      expect(preCheck.expected).toEqual({ cnt: 1 });
    });

    it('should have properly formatted SQL in pre-checks', () => {
      const preCheck = migration.preChecks[0];
      
      expect(preCheck.sql).toContain('information_schema.tables');
      expect(preCheck.sql).toContain('table_name=\'users\'');
      expect(preCheck.sql).toContain('COUNT(*)::int AS cnt');
    });
  });

  describe('Migration Steps', () => {
    it('should have exactly three migration steps', () => {
      expect(migration.steps).toHaveLength(3);
    });

    it('should have correct step structure', () => {
      migration.steps.forEach(step => {
        expect(step).toMatchObject({
          type: expect.any(String),
          table: expect.any(String),
          details: expect.any(Object)
        });
        expect(step.table).toBe('users');
      });
    });

    describe('Step 1: Add password_hash column', () => {
      it('should add password_hash column with correct configuration', () => {
        const step = migration.steps[0];
        
        expect(step.type).toBe('custom');
        expect(step.table).toBe('users');
        expect(step.details.sql).toBe(
          `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`
        );
      });
    });

    describe('Step 2: Create email-password index', () => {
      it('should create conditional index on email for password authentication', () => {
        const step = migration.steps[1];
        
        expect(step.type).toBe('custom');
        expect(step.table).toBe('users');
        expect(step.details.sql).toBe(
          `CREATE INDEX IF NOT EXISTS idx_users_email_password ON users(email) WHERE password_hash IS NOT NULL`
        );
      });

      it('should create a conditional index for performance optimization', () => {
        const step = migration.steps[1];
        
        expect(step.details.sql).toContain('WHERE password_hash IS NOT NULL');
        expect(step.details.sql).toContain('idx_users_email_password');
        expect(step.details.sql).toContain('ON users(email)');
      });
    });

    describe('Step 3: Add column comment', () => {
      it('should add descriptive comment to password_hash column', () => {
        const step = migration.steps[2];
        
        expect(step.type).toBe('custom');
        expect(step.table).toBe('users');
        expect(step.details.sql).toBe(
          `COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password for email/password authentication'`
        );
      });

      it('should specify bcrypt as the hashing method', () => {
        const step = migration.steps[2];
        
        expect(step.details.sql).toContain('bcrypt hashed password');
        expect(step.details.sql).toContain('email/password authentication');
      });
    });
  });

  describe('Post-checks', () => {
    it('should have exactly one post-check', () => {
      expect(migration.postChecks).toHaveLength(1);
    });

    it('should verify password_hash column creation', () => {
      const postCheck = migration.postChecks[0];
      
      expect(postCheck.name).toBe('password_hash_column_exists');
      expect(postCheck.sql).toBe(
        `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'`
      );
      expect(postCheck.expected).toEqual({ cnt: 1 });
    });

    it('should check the correct table and column', () => {
      const postCheck = migration.postChecks[0];
      
      expect(postCheck.sql).toContain('information_schema.columns');
      expect(postCheck.sql).toContain('table_name=\'users\'');
      expect(postCheck.sql).toContain('column_name=\'password_hash\'');
    });
  });

  describe('Rollback Steps', () => {
    it('should have exactly two rollback steps', () => {
      expect(migration.rollback).toHaveLength(2);
    });

    it('should have correct rollback step structure', () => {
      migration.rollback.forEach(step => {
        expect(step).toMatchObject({
          sql: expect.any(String)
        });
      });
    });

    describe('Rollback Step 1: Remove index', () => {
      it('should drop the email-password index', () => {
        const step = migration.rollback[0];
        
        expect(step.sql).toBe('DROP INDEX IF EXISTS idx_users_email_password');
      });
    });

    describe('Rollback Step 2: Remove column', () => {
      it('should drop the password_hash column', () => {
        const step = migration.rollback[1];
        
        expect(step.sql).toBe('ALTER TABLE users DROP COLUMN IF EXISTS password_hash');
      });
    });

    it('should rollback in reverse order (index first, then column)', () => {
      const indexStep = migration.rollback[0];
      const columnStep = migration.rollback[1];
      
      expect(indexStep.sql).toContain('DROP INDEX');
      expect(columnStep.sql).toContain('DROP COLUMN');
    });
  });

  describe('Migration Integrity', () => {
    it('should have consistent table references across migration steps', () => {
      migration.steps.forEach(step => {
        expect(step.table).toBe('users');
      });
    });

    it('should use IF NOT EXISTS/IF EXISTS for idempotent operations', () => {
      // Forward migration steps should use IF NOT EXISTS
      expect(migration.steps[0].details.sql).toContain('IF NOT EXISTS');
      expect(migration.steps[1].details.sql).toContain('IF NOT EXISTS');
      
      // Rollback steps should use IF EXISTS  
      expect(migration.rollback[0].sql).toContain('IF EXISTS');
      expect(migration.rollback[1].sql).toContain('IF EXISTS');
    });

    it('should have SQL statements that are properly formatted', () => {
      const allSqlStatements = [
        ...migration.preChecks.map(check => check.sql),
        ...migration.steps.map(step => step.details.sql),
        ...migration.postChecks.map(check => check.sql),
        ...migration.rollback.map(step => step.sql)
      ];

      allSqlStatements.forEach(sql => {
        expect(sql).toBeTruthy();
        expect(sql.trim()).toBe(sql); // No leading/trailing whitespace
        expect(sql).not.toContain(';;'); // No double semicolons
      });
    });

    it('should ensure rollback can reverse all migration steps', () => {
      // Migration adds: column, index, comment
      // Rollback removes: index, column (comment is removed with column)
      
      const addColumnStep = migration.steps.find(s => s.details.sql.includes('ADD COLUMN'));
      const addIndexStep = migration.steps.find(s => s.details.sql.includes('CREATE INDEX'));
      
      const dropIndexStep = migration.rollback.find(s => s.sql.includes('DROP INDEX'));
      const dropColumnStep = migration.rollback.find(s => s.sql.includes('DROP COLUMN'));
      
      expect(addColumnStep).toBeDefined();
      expect(addIndexStep).toBeDefined();
      expect(dropIndexStep).toBeDefined();
      expect(dropColumnStep).toBeDefined();
      
      // Verify index names match
      expect(addIndexStep?.details.sql).toContain('idx_users_email_password');
      expect(dropIndexStep?.sql).toContain('idx_users_email_password');
      
      // Verify column names match
      expect(addColumnStep?.details.sql).toContain('password_hash');
      expect(dropColumnStep?.sql).toContain('password_hash');
    });
  });

  describe('Security and Best Practices', () => {
    it('should use TEXT type for password hashes to accommodate various hash lengths', () => {
      const addColumnStep = migration.steps[0];
      expect(addColumnStep.details.sql).toContain('TEXT');
    });

    it('should create a conditional index for performance optimization', () => {
      const indexStep = migration.steps[1];
      expect(indexStep.details.sql).toContain('WHERE password_hash IS NOT NULL');
    });

    it('should document the hashing algorithm in the comment', () => {
      const commentStep = migration.steps[2];
      expect(commentStep.details.sql).toContain('bcrypt');
    });

    it('should support nullable password_hash column for OAuth-only users', () => {
      const addColumnStep = migration.steps[0];
      // Column is nullable by default (no NOT NULL constraint)
      expect(addColumnStep.details.sql).not.toContain('NOT NULL');
    });
  });
});