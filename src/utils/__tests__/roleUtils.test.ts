import {
  getAdminEmails,
  isAdminEmail,
  determineUserRole,
  hasAdminPrivileges
} from '../roleUtils';
import { UserRole } from '../../types/user';

// Mock process.env for testing
const originalEnv = process.env;

describe('roleUtils', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getAdminEmails', () => {
    it('should return empty array when ADMIN_EMAILS is not set', () => {
      delete process.env.ADMIN_EMAILS;
      
      const result = getAdminEmails();
      
      expect(result).toEqual([]);
    });

    it('should return empty array when ADMIN_EMAILS is empty string', () => {
      process.env.ADMIN_EMAILS = '';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([]);
    });

    it('should parse single admin email', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      
      const result = getAdminEmails();
      
      expect(result).toEqual(['admin@example.com']);
    });

    it('should parse multiple admin emails separated by commas', () => {
      process.env.ADMIN_EMAILS = 'admin1@example.com,admin2@example.com,admin3@example.com';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([
        'admin1@example.com',
        'admin2@example.com',
        'admin3@example.com'
      ]);
    });

    it('should trim whitespace from admin emails', () => {
      process.env.ADMIN_EMAILS = '  admin1@example.com  ,  admin2@example.com  ';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([
        'admin1@example.com',
        'admin2@example.com'
      ]);
    });

    it('should convert emails to lowercase', () => {
      process.env.ADMIN_EMAILS = 'ADMIN@EXAMPLE.COM,Admin2@Example.Com';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([
        'admin@example.com',
        'admin2@example.com'
      ]);
    });

    it('should filter out empty emails', () => {
      process.env.ADMIN_EMAILS = 'admin1@example.com,,admin2@example.com,   ,admin3@example.com';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([
        'admin1@example.com',
        'admin2@example.com',
        'admin3@example.com'
      ]);
    });

    it('should handle mixed case and spacing correctly', () => {
      process.env.ADMIN_EMAILS = '  Admin@Example.COM  ,  ,  user2@TEST.org  ,   ';
      
      const result = getAdminEmails();
      
      expect(result).toEqual([
        'admin@example.com',
        'user2@test.org'
      ]);
    });
  });

  describe('isAdminEmail', () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = 'admin@example.com,super@admin.org';
    });

    it('should return true for admin email (exact case)', () => {
      const result = isAdminEmail('admin@example.com');
      
      expect(result).toBe(true);
    });

    it('should return true for admin email (different case)', () => {
      const result = isAdminEmail('ADMIN@EXAMPLE.COM');
      
      expect(result).toBe(true);
    });

    it('should return true for second admin email', () => {
      const result = isAdminEmail('super@admin.org');
      
      expect(result).toBe(true);
    });

    it('should return false for non-admin email', () => {
      const result = isAdminEmail('user@example.com');
      
      expect(result).toBe(false);
    });

    it('should return false for similar but different email', () => {
      const result = isAdminEmail('admin@different.com');
      
      expect(result).toBe(false);
    });

    it('should return false when no admin emails are configured', () => {
      delete process.env.ADMIN_EMAILS;
      
      const result = isAdminEmail('admin@example.com');
      
      expect(result).toBe(false);
    });

    it('should handle empty string input', () => {
      const result = isAdminEmail('');
      
      expect(result).toBe(false);
    });

    it('should handle whitespace in input email', () => {
      const result = isAdminEmail('  admin@example.com  ');
      
      expect(result).toBe(false); // Should not trim input, exact match required
    });
  });

  describe('determineUserRole', () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = 'admin@example.com,superuser@test.org';
    });

    it('should return "guest" when isGuest is true', () => {
      const result = determineUserRole('admin@example.com', true);
      
      expect(result).toBe('guest');
    });

    it('should return "guest" when isGuest is true even for admin email', () => {
      const result = determineUserRole('admin@example.com', true);
      
      expect(result).toBe('guest');
    });

    it('should return "admin" for admin email when not guest', () => {
      const result = determineUserRole('admin@example.com', false);
      
      expect(result).toBe('admin');
    });

    it('should return "admin" for admin email when isGuest is undefined', () => {
      const result = determineUserRole('admin@example.com');
      
      expect(result).toBe('admin');
    });

    it('should return "admin" for second admin email', () => {
      const result = determineUserRole('superuser@test.org');
      
      expect(result).toBe('admin');
    });

    it('should return "player" for regular user email', () => {
      const result = determineUserRole('user@example.com');
      
      expect(result).toBe('player');
    });

    it('should return "player" for regular user when isGuest is false', () => {
      const result = determineUserRole('user@example.com', false);
      
      expect(result).toBe('player');
    });

    it('should handle case insensitive admin check', () => {
      const result = determineUserRole('ADMIN@EXAMPLE.COM');
      
      expect(result).toBe('admin');
    });

    it('should return "player" when no admin emails configured', () => {
      delete process.env.ADMIN_EMAILS;
      
      const result = determineUserRole('admin@example.com');
      
      expect(result).toBe('player');
    });

    it('should return "guest" when no admin emails configured but isGuest is true', () => {
      delete process.env.ADMIN_EMAILS;
      
      const result = determineUserRole('admin@example.com', true);
      
      expect(result).toBe('guest');
    });
  });

  describe('hasAdminPrivileges', () => {
    it('should return true for admin role', () => {
      const result = hasAdminPrivileges('admin' as UserRole);
      
      expect(result).toBe(true);
    });

    it('should return false for player role', () => {
      const result = hasAdminPrivileges('player' as UserRole);
      
      expect(result).toBe(false);
    });

    it('should return false for guest role', () => {
      const result = hasAdminPrivileges('guest' as UserRole);
      
      expect(result).toBe(false);
    });

    it('should handle all valid UserRole values', () => {
      const roles: UserRole[] = ['admin', 'player', 'guest'];
      
      const results = roles.map(role => hasAdminPrivileges(role));
      
      expect(results).toEqual([true, false, false]);
    });
  });

  describe('integration scenarios', () => {
    it('should work correctly for complete admin flow', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com,super@test.org';
      
      // Test admin user
      const adminRole = determineUserRole('admin@example.com');
      expect(adminRole).toBe('admin');
      expect(hasAdminPrivileges(adminRole)).toBe(true);
      
      // Test regular user
      const userRole = determineUserRole('user@example.com');
      expect(userRole).toBe('player');
      expect(hasAdminPrivileges(userRole)).toBe(false);
      
      // Test guest
      const guestRole = determineUserRole('anyone@example.com', true);
      expect(guestRole).toBe('guest');
      expect(hasAdminPrivileges(guestRole)).toBe(false);
    });

    it('should handle empty configuration gracefully', () => {
      delete process.env.ADMIN_EMAILS;
      
      expect(getAdminEmails()).toEqual([]);
      expect(isAdminEmail('admin@example.com')).toBe(false);
      expect(determineUserRole('admin@example.com')).toBe('player');
      expect(hasAdminPrivileges('player')).toBe(false);
    });

    it('should be consistent with case sensitivity', () => {
      process.env.ADMIN_EMAILS = 'Admin@Example.COM';
      
      // All these should work due to lowercase normalization
      expect(isAdminEmail('admin@example.com')).toBe(true);
      expect(isAdminEmail('ADMIN@EXAMPLE.COM')).toBe(true);
      expect(isAdminEmail('Admin@Example.com')).toBe(true);
      
      expect(determineUserRole('admin@example.com')).toBe('admin');
      expect(determineUserRole('ADMIN@EXAMPLE.COM')).toBe('admin');
    });
  });
});