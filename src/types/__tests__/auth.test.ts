import {
  AuthSession,
  AuthUser,
  AuthContext,
  AuthenticationOptions,
  SessionCleanupOptions,
  AuthError
} from '../auth';

describe('Auth Types', () => {
  describe('AuthError', () => {
    it('should create AuthError with default values', () => {
      const error = new AuthError('Test error message');
      
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthError);
    });

    it('should create AuthError with custom code', () => {
      const error = new AuthError('Custom error', 'CUSTOM_CODE');
      
      expect(error.message).toBe('Custom error');
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.statusCode).toBe(401);
    });

    it('should create AuthError with custom code and status code', () => {
      const error = new AuthError('Forbidden error', 'FORBIDDEN', 403);
      
      expect(error.message).toBe('Forbidden error');
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('FORBIDDEN');
      expect(error.statusCode).toBe(403);
    });

    it('should create AuthError with all custom parameters', () => {
      const error = new AuthError('Server error', 'SERVER_ERROR', 500);
      
      expect(error.message).toBe('Server error');
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('SERVER_ERROR');
      expect(error.statusCode).toBe(500);
    });

    it('should preserve stack trace', () => {
      const error = new AuthError('Stack test');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AuthError');
      expect(error.stack).toContain('Stack test');
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new AuthError('Throwable test', 'THROW_CODE', 422);
      }).toThrow(AuthError);

      try {
        throw new AuthError('Catch test', 'CATCH_CODE', 409);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe('CATCH_CODE');
        expect((error as AuthError).statusCode).toBe(409);
      }
    });

    it('should handle empty message', () => {
      const error = new AuthError('');
      
      expect(error.message).toBe('');
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
    });

    it('should handle special characters in message', () => {
      const specialMessage = 'Error with émojis 🔒 and symbols @#$%';
      const error = new AuthError(specialMessage);
      
      expect(error.message).toBe(specialMessage);
    });

    it('should handle very long messages', () => {
      const longMessage = 'A'.repeat(1000);
      const error = new AuthError(longMessage);
      
      expect(error.message).toBe(longMessage);
      expect(error.message.length).toBe(1000);
    });

    it('should handle numeric status codes correctly', () => {
      const testCases = [
        { code: 200, expected: 200 },
        { code: 400, expected: 400 },
        { code: 401, expected: 401 },
        { code: 403, expected: 403 },
        { code: 404, expected: 404 },
        { code: 500, expected: 500 }
      ];

      testCases.forEach(({ code, expected }) => {
        const error = new AuthError('Test', 'TEST', code);
        expect(error.statusCode).toBe(expected);
      });
    });

    it('should handle edge case status codes', () => {
      const error1 = new AuthError('Test', 'TEST', 0);
      expect(error1.statusCode).toBe(0);

      const error2 = new AuthError('Test', 'TEST', 999);
      expect(error2.statusCode).toBe(999);
    });
  });

  describe('Type Interfaces - Structure Validation', () => {
    describe('AuthSession interface', () => {
      it('should accept valid AuthSession object', () => {
        const validSession: AuthSession = {
          id: 'session123',
          userId: 'user456',
          token: 'token789',
          expiresAt: new Date('2025-12-31T23:59:59Z'),
          createdAt: new Date('2025-01-01T00:00:00Z'),
          lastAccessed: new Date('2025-09-17T12:00:00Z'),
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Test Browser',
          isActive: true
        };

        // Type checking - should compile without errors
        expect(typeof validSession.id).toBe('string');
        expect(typeof validSession.userId).toBe('string');
        expect(typeof validSession.token).toBe('string');
        expect(validSession.expiresAt).toBeInstanceOf(Date);
        expect(validSession.createdAt).toBeInstanceOf(Date);
        expect(validSession.lastAccessed).toBeInstanceOf(Date);
        expect(typeof validSession.ipAddress).toBe('string');
        expect(typeof validSession.userAgent).toBe('string');
        expect(typeof validSession.isActive).toBe('boolean');
      });

      it('should handle inactive session', () => {
        const inactiveSession: AuthSession = {
          id: 'inactive123',
          userId: 'user456',
          token: 'expired_token',
          expiresAt: new Date('2025-01-01T00:00:00Z'),
          createdAt: new Date('2024-01-01T00:00:00Z'),
          lastAccessed: new Date('2024-06-01T00:00:00Z'),
          ipAddress: '10.0.0.1',
          userAgent: 'Old Browser',
          isActive: false
        };

        expect(inactiveSession.isActive).toBe(false);
      });
    });

    describe('AuthUser interface', () => {
      it('should accept valid AuthUser with all optional fields', () => {
        const fullUser: AuthUser = {
          id: 'user123',
          email: 'test@example.com',
          username: 'testuser',
          isVerified: true,
          lastLogin: new Date('2025-09-17T10:30:00Z'),
          permissions: ['read', 'write', 'delete'],
          roles: ['admin', 'moderator']
        };

        expect(typeof fullUser.id).toBe('string');
        expect(typeof fullUser.email).toBe('string');
        expect(typeof fullUser.username).toBe('string');
        expect(typeof fullUser.isVerified).toBe('boolean');
        expect(fullUser.lastLogin).toBeInstanceOf(Date);
        expect(Array.isArray(fullUser.permissions)).toBe(true);
        expect(Array.isArray(fullUser.roles)).toBe(true);
      });

      it('should accept valid AuthUser with minimal fields', () => {
        const minimalUser: AuthUser = {
          id: 'user456',
          email: 'minimal@example.com',
          username: 'minimal',
          isVerified: false
        };

        expect(minimalUser.lastLogin).toBeUndefined();
        expect(minimalUser.permissions).toBeUndefined();
        expect(minimalUser.roles).toBeUndefined();
      });

      it('should accept user with empty arrays', () => {
        const userWithEmptyArrays: AuthUser = {
          id: 'user789',
          email: 'empty@example.com',
          username: 'emptyuser',
          isVerified: true,
          permissions: [],
          roles: []
        };

        expect(userWithEmptyArrays.permissions).toEqual([]);
        expect(userWithEmptyArrays.roles).toEqual([]);
      });
    });

    describe('AuthContext interface', () => {
      it('should accept valid AuthContext', () => {
        const user: AuthUser = {
          id: 'contextUser',
          email: 'context@example.com',
          username: 'contextuser',
          isVerified: true
        };

        const session: AuthSession = {
          id: 'contextSession',
          userId: 'contextUser',
          token: 'contextToken',
          expiresAt: new Date(),
          createdAt: new Date(),
          lastAccessed: new Date(),
          ipAddress: '127.0.0.1',
          userAgent: 'Context Browser',
          isActive: true
        };

        const context: AuthContext = {
          user,
          session,
          isAuthenticated: true
        };

        expect(context.user).toBe(user);
        expect(context.session).toBe(session);
        expect(context.isAuthenticated).toBe(true);
      });

      it('should handle unauthenticated context', () => {
        const user: AuthUser = {
          id: 'guest',
          email: '',
          username: 'anonymous',
          isVerified: false
        };

        const session: AuthSession = {
          id: 'guestSession',
          userId: 'guest',
          token: '',
          expiresAt: new Date(),
          createdAt: new Date(),
          lastAccessed: new Date(),
          ipAddress: '0.0.0.0',
          userAgent: 'Guest',
          isActive: false
        };

        const context: AuthContext = {
          user,
          session,
          isAuthenticated: false
        };

        expect(context.isAuthenticated).toBe(false);
      });
    });

    describe('AuthenticationOptions interface', () => {
      it('should accept full AuthenticationOptions', () => {
        const fullOptions: AuthenticationOptions = {
          requireAuth: true,
          requireVerification: true,
          permissions: ['admin', 'write'],
          roles: ['superuser'],
          maxTokenAge: 3600000 // 1 hour
        };

        expect(typeof fullOptions.requireAuth).toBe('boolean');
        expect(typeof fullOptions.requireVerification).toBe('boolean');
        expect(Array.isArray(fullOptions.permissions)).toBe(true);
        expect(Array.isArray(fullOptions.roles)).toBe(true);
        expect(typeof fullOptions.maxTokenAge).toBe('number');
      });

      it('should accept minimal AuthenticationOptions', () => {
        const minimalOptions: AuthenticationOptions = {};

        expect(minimalOptions.requireAuth).toBeUndefined();
        expect(minimalOptions.requireVerification).toBeUndefined();
        expect(minimalOptions.permissions).toBeUndefined();
        expect(minimalOptions.roles).toBeUndefined();
        expect(minimalOptions.maxTokenAge).toBeUndefined();
      });

      it('should accept options with various maxTokenAge values', () => {
        const shortToken: AuthenticationOptions = { maxTokenAge: 60000 }; // 1 minute
        const longToken: AuthenticationOptions = { maxTokenAge: 86400000 }; // 24 hours
        const zeroToken: AuthenticationOptions = { maxTokenAge: 0 };

        expect(shortToken.maxTokenAge).toBe(60000);
        expect(longToken.maxTokenAge).toBe(86400000);
        expect(zeroToken.maxTokenAge).toBe(0);
      });

      it('should handle boolean combinations', () => {
        const combinations = [
          { requireAuth: true, requireVerification: true },
          { requireAuth: true, requireVerification: false },
          { requireAuth: false, requireVerification: true },
          { requireAuth: false, requireVerification: false }
        ];

        combinations.forEach((combo) => {
          const options: AuthenticationOptions = combo;
          expect(typeof options.requireAuth).toBe('boolean');
          expect(typeof options.requireVerification).toBe('boolean');
        });
      });
    });

    describe('SessionCleanupOptions interface', () => {
      it('should accept full SessionCleanupOptions', () => {
        const fullCleanup: SessionCleanupOptions = {
          maxIdleTime: 1800000, // 30 minutes
          maxSessionAge: 86400000, // 24 hours
          cleanupExpired: true
        };

        expect(typeof fullCleanup.maxIdleTime).toBe('number');
        expect(typeof fullCleanup.maxSessionAge).toBe('number');
        expect(typeof fullCleanup.cleanupExpired).toBe('boolean');
      });

      it('should accept empty SessionCleanupOptions', () => {
        const emptyCleanup: SessionCleanupOptions = {};

        expect(emptyCleanup.maxIdleTime).toBeUndefined();
        expect(emptyCleanup.maxSessionAge).toBeUndefined();
        expect(emptyCleanup.cleanupExpired).toBeUndefined();
      });

      it('should handle various time values', () => {
        const timeOptions: SessionCleanupOptions = {
          maxIdleTime: 0, // No idle time
          maxSessionAge: Number.MAX_SAFE_INTEGER, // Very long session
          cleanupExpired: false
        };

        expect(timeOptions.maxIdleTime).toBe(0);
        expect(timeOptions.maxSessionAge).toBe(Number.MAX_SAFE_INTEGER);
        expect(timeOptions.cleanupExpired).toBe(false);
      });
    });
  });

  describe('Interface Integration Tests', () => {
    it('should work with realistic auth flow data', () => {
      // Simulate a realistic authentication flow
      const user: AuthUser = {
        id: 'user_001',
        email: 'john.doe@example.com',
        username: 'johndoe',
        isVerified: true,
        lastLogin: new Date('2025-09-17T08:30:00Z'),
        permissions: ['profile:read', 'profile:write', 'games:join'],
        roles: ['player']
      };

      const session: AuthSession = {
        id: 'sess_abc123',
        userId: user.id,
        token: 'jwt_token_here',
        expiresAt: new Date('2025-09-18T08:30:00Z'),
        createdAt: new Date('2025-09-17T08:30:00Z'),
        lastAccessed: new Date('2025-09-17T12:15:00Z'),
        ipAddress: '203.0.113.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        isActive: true
      };

      const context: AuthContext = {
        user,
        session,
        isAuthenticated: true
      };

      const authOptions: AuthenticationOptions = {
        requireAuth: true,
        requireVerification: true,
        permissions: ['profile:read'],
        roles: ['player'],
        maxTokenAge: 86400000
      };

      const cleanupOptions: SessionCleanupOptions = {
        maxIdleTime: 3600000, // 1 hour
        maxSessionAge: 604800000, // 7 days
        cleanupExpired: true
      };

      // Validate the complete auth flow
      expect(context.user.id).toBe(session.userId);
      expect(context.isAuthenticated).toBe(session.isActive);
      expect(authOptions.permissions).toContain('profile:read');
      expect(user.permissions).toContain('profile:read');
      expect(cleanupOptions.maxIdleTime).toBeLessThan(cleanupOptions.maxSessionAge!);
    });

    it('should handle admin user scenario', () => {
      const adminUser: AuthUser = {
        id: 'admin_001',
        email: 'admin@example.com',
        username: 'admin',
        isVerified: true,
        permissions: ['*'], // All permissions
        roles: ['admin', 'moderator', 'player']
      };

      const adminOptions: AuthenticationOptions = {
        requireAuth: true,
        requireVerification: true,
        permissions: ['admin:panel', 'user:manage'],
        roles: ['admin']
      };

      expect(adminUser.roles).toContain('admin');
      expect(adminOptions.roles).toContain('admin');
      expect(adminUser.permissions).toContain('*');
    });

    it('should handle guest/anonymous scenario', () => {
      const guestUser: AuthUser = {
        id: 'guest',
        email: '',
        username: 'anonymous',
        isVerified: false,
        permissions: ['public:read'],
        roles: ['guest']
      };

      const guestSession: AuthSession = {
        id: 'guest_session',
        userId: 'guest',
        token: '',
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
        createdAt: new Date(),
        lastAccessed: new Date(),
        ipAddress: '192.168.1.100',
        userAgent: 'Guest Browser',
        isActive: true
      };

      const guestContext: AuthContext = {
        user: guestUser,
        session: guestSession,
        isAuthenticated: false // Even though session is active, user isn't authenticated
      };

      expect(guestContext.isAuthenticated).toBe(false);
      expect(guestUser.isVerified).toBe(false);
      expect(guestUser.roles).toContain('guest');
    });
  });

  describe('Type Safety and Edge Cases', () => {
    it('should handle Date edge cases in sessions', () => {
      const edgeCases = {
        pastDate: new Date('2020-01-01'),
        futureDate: new Date('2030-12-31'),
        now: new Date(),
        epoch: new Date(0)
      };

      const session: AuthSession = {
        id: 'edge_session',
        userId: 'edge_user',
        token: 'edge_token',
        expiresAt: edgeCases.futureDate,
        createdAt: edgeCases.pastDate,
        lastAccessed: edgeCases.now,
        ipAddress: '::1', // IPv6 localhost
        userAgent: 'Edge Case Browser',
        isActive: true
      };

      expect(session.createdAt.getTime()).toBeLessThan(session.lastAccessed.getTime());
      expect(session.lastAccessed.getTime()).toBeLessThan(session.expiresAt.getTime());
    });

    it('should handle special string values', () => {
      const specialStrings = {
        empty: '',
        whitespace: '   ',
        unicode: '🔒🔑👤',
        longString: 'x'.repeat(1000),
        specialChars: '<script>alert("xss")</script>'
      };

      const user: AuthUser = {
        id: specialStrings.longString,
        email: specialStrings.unicode + '@example.com',
        username: specialStrings.specialChars,
        isVerified: true
      };

      expect(user.id.length).toBe(1000);
      expect(user.email).toContain('🔒🔑👤');
      expect(user.username).toContain('<script>');
    });

    it('should handle array edge cases', () => {
      const user: AuthUser = {
        id: 'array_test',
        email: 'array@test.com',
        username: 'arrayuser',
        isVerified: true,
        permissions: ['a'.repeat(100)], // Very long permission
        roles: Array(50).fill('role') // Many duplicate roles
      };

      expect(user.permissions![0].length).toBe(100);
      expect(user.roles!.length).toBe(50);
      expect(user.roles!.every(role => role === 'role')).toBe(true);
    });
  });
});