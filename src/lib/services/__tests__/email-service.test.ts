// Mock external dependencies FIRST before any imports
jest.mock('../../config/email-config', () => ({
  getEmailConfig: jest.fn(() => ({
    provider: 'development' as const,
    fromEmail: 'noreply@tablepoker.com',
    fromName: 'Table Poker',
    replyTo: 'support@tablepoker.com',
    retries: 3,
    retryDelay: 1000,
    maxEmailsPerHour: 10,
    baseUrl: 'https://tablepoker.com',
    supportEmail: 'support@tablepoker.com'
  })),
  emailTemplates: {
    passwordReset: {
      subject: 'Reset Your Table Poker Password'
    },
    welcome: {
      subject: 'Welcome to Table Poker!'
    },
    accountVerification: {
      subject: 'Verify Your Table Poker Account'
    }
  }
}));
jest.mock('@sendgrid/mail');
jest.mock('aws-sdk');
jest.mock('nodemailer');

import { EmailService } from '../email-service';
import { getEmailConfig } from '../../config/email-config';

const mockGetEmailConfig = getEmailConfig as jest.MockedFunction<typeof getEmailConfig>;

// Mock console methods to capture development output
const consoleSpy = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation()
};

describe('EmailService', () => {
  let emailService: EmailService;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      provider: 'development' as const,
      fromEmail: 'noreply@tablepoker.com',
      fromName: 'Table Poker',
      replyTo: 'support@tablepoker.com',
      retries: 3,
      retryDelay: 1000,
      maxEmailsPerHour: 5,
      baseUrl: 'https://tablepoker.com',
      supportEmail: 'support@tablepoker.com'
    };
    
    mockGetEmailConfig.mockReturnValue(mockConfig);
  });

  afterAll(() => {
    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  it('should be defined', () => {
    expect(EmailService).toBeDefined();
  });

  it('should create instance with default config', () => {
    emailService = new EmailService();
    expect(emailService).toBeInstanceOf(EmailService);
  });

  describe('Development Mode', () => {
    beforeEach(() => {
      emailService = new EmailService();
    });

    it('should send password reset email in development mode', async () => {
      const result = await emailService.sendPasswordResetEmail('user@example.com', 'reset-token-123');
      
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev-\d+$/);
      expect(result.provider).toBe('development');
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('📧 ================== EMAIL (Development Mode) ==================')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith('To: user@example.com');
      expect(consoleSpy.log).toHaveBeenCalledWith('From: noreply@tablepoker.com');
    });

    it('should include reset URL in password reset email', async () => {
      await emailService.sendPasswordResetEmail('user@example.com', 'test-token');
      
      const expectedUrl = 'https://tablepoker.com/reset-password?token=test-token&email=user%40example.com';
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(expectedUrl)
      );
    });

    it('should send welcome email in development mode', async () => {
      const result = await emailService.sendWelcomeEmail('user@example.com', 'TestUser');
      
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev-\d+$/);
      expect(result.provider).toBe('development');
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Hello TestUser!')
      );
    });

    it('should send verification email in development mode', async () => {
      const result = await emailService.sendVerificationEmail('user@example.com', 'verify-123');
      
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev-\d+$/);
      expect(result.provider).toBe('development');
      
      const expectedUrl = 'https://tablepoker.com/verify-account?token=verify-123&email=user%40example.com';
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(expectedUrl)
      );
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      emailService = new EmailService();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should allow emails within rate limit', async () => {
      const email = 'user@example.com';
      
      // Send emails up to the limit (10 per hour)
      for (let i = 0; i < mockConfig.maxEmailsPerHour; i++) {
        const result = await emailService.sendPasswordResetEmail(email, `token-${i}`);
        expect(result.success).toBe(true);
      }
    });

    it('should enforce rate limiting when limit exceeded', async () => {
      const email = 'test@example.com';
      
      // Send 5 emails (hit the limit exactly)
      for (let i = 0; i < 5; i++) {
        const result = await emailService.sendPasswordResetEmail(email, `token${i}`);
        expect(result.success).toBe(true); // These should succeed
      }

      // The 6th email should be rate limited
      const result = await emailService.sendPasswordResetEmail(email, 'token6');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(result.provider).toBeUndefined(); // Rate limiting returns without provider
    });

    it('should allow different email addresses independent rate limits', async () => {
      const email1 = 'user1@example.com';
      const email2 = 'user2@example.com';
      
      // Fill up rate limit for first email
      for (let i = 0; i < mockConfig.maxEmailsPerHour; i++) {
        const result = await emailService.sendPasswordResetEmail(email1, `token-${i}`);
        expect(result.success).toBe(true);
      }
      
      // First email should be rate limited
      const result1 = await emailService.sendPasswordResetEmail(email1, 'token-over-limit');
      expect(result1.success).toBe(false);
      
      // Second email should still work
      const result2 = await emailService.sendPasswordResetEmail(email2, 'token');
      expect(result2.success).toBe(true);
    });

    it('should reset rate limit after time window', async () => {
      const email = 'user@example.com';
      
      // Fill up rate limit
      for (let i = 0; i < mockConfig.maxEmailsPerHour; i++) {
        await emailService.sendPasswordResetEmail(email, `token-${i}`);
      }
      
      // Should be rate limited
      const result1 = await emailService.sendPasswordResetEmail(email, 'token-over-limit');
      expect(result1.success).toBe(false);
      
      // Advance time by 1 hour + 1 minute
      jest.advanceTimersByTime(61 * 60 * 1000);
      
      // Should work again after time window reset
      const result2 = await emailService.sendPasswordResetEmail(email, 'token-after-reset');
      expect(result2.success).toBe(true);
    });
  });

  describe('Custom Configuration', () => {
    it('should create service with custom config', () => {
      const customConfig = {
        ...mockConfig,
        fromEmail: 'custom@example.com',
        fromName: 'Custom Service',
        maxEmailsPerHour: 20
      };
      
      const service = new EmailService(customConfig);
      expect(service).toBeInstanceOf(EmailService);
    });

    it('should respect custom expiry minutes in password reset', async () => {
      emailService = new EmailService();
      
      await emailService.sendPasswordResetEmail('user@example.com', 'token', 30);
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('expires in 30 minutes')
      );
    });

    it('should use default expiry when not specified', async () => {
      emailService = new EmailService();
      
      await emailService.sendPasswordResetEmail('user@example.com', 'token');
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('expires in 60 minutes')
      );
    });
  });

  describe('Provider Initialization', () => {
    it('should handle SendGrid provider configuration', () => {
      const sendgridConfig = {
        ...mockConfig,
        provider: 'sendgrid' as const,
        sendgrid: {
          apiKey: 'test-sendgrid-key'
        }
      };
      mockGetEmailConfig.mockReturnValue(sendgridConfig);
      
      const service = new EmailService(sendgridConfig);
      expect(service).toBeInstanceOf(EmailService);
    });

    it('should handle AWS SES provider configuration', () => {
      const awsConfig = {
        ...mockConfig,
        provider: 'aws-ses' as const,
        awsSes: {
          region: 'us-east-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret'
        }
      };
      mockGetEmailConfig.mockReturnValue(awsConfig);
      
      const service = new EmailService(awsConfig);
      expect(service).toBeInstanceOf(EmailService);
    });

    it('should handle SMTP provider configuration', () => {
      const smtpConfig = {
        ...mockConfig,
        provider: 'smtp' as const,
        smtp: {
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          auth: {
            user: 'test@test.com',
            pass: 'password'
          }
        }
      };
      mockGetEmailConfig.mockReturnValue(smtpConfig);
      
      const service = new EmailService(smtpConfig);
      expect(service).toBeInstanceOf(EmailService);
    });
  });

  describe('Template Generation', () => {
    beforeEach(() => {
      emailService = new EmailService();
    });

    it('should generate password reset template with custom expiry', async () => {
      const result = await emailService.sendPasswordResetEmail('user@test.com', 'token123', 30);
      expect(result.success).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('expires in 30 minutes')
      );
    });

    it('should generate welcome template with username', async () => {
      const result = await emailService.sendWelcomeEmail('user@test.com', 'TestUser');
      expect(result.success).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Hello TestUser!')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to Table Poker!')
      );
    });

    it('should generate verification template with verification URL', async () => {
      const result = await emailService.sendVerificationEmail('user@test.com', 'verify123');
      expect(result.success).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Verify Your Account')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('verify123') // Check for the token in the URL
      );
    });
  });

  describe('Retry Logic', () => {
    beforeEach(() => {
      // Mock a failing provider for retry testing
      const retryConfig = {
        ...mockConfig,
        provider: 'sendgrid' as const,
        retries: 2,
        retryDelay: 100,
        sendgrid: {
          apiKey: 'test-key'
        }
      };
      mockGetEmailConfig.mockReturnValue(retryConfig);
      emailService = new EmailService(retryConfig);
    });

    it('should handle email configuration testing', async () => {
      const result = await emailService.testEmailConfiguration();
      expect(result.success).toBe(true);
      expect(result.provider).toBe('sendgrid');
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported provider error', async () => {
      const invalidConfig = {
        ...mockConfig,
        provider: 'unsupported' as any
      };
      mockGetEmailConfig.mockReturnValue(invalidConfig);
      const service = new EmailService(invalidConfig);
      
      // Try to send email with unsupported provider
      const result = await (service as any).sendEmail({
        to: 'test@test.com',
        subject: 'Test',
        html: 'Test',
        text: 'Test'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported email provider');
      expect(result.provider).toBe('unsupported');
    });

    it('should handle rate limiter remaining emails calculation', () => {
      const email = 'test@example.com';
      
      // Send 3 emails
      for (let i = 0; i < 3; i++) {
        emailService.sendPasswordResetEmail(email, `token${i}`);
      }
      
      // Check remaining emails through rate limiter
      const rateLimiter = (emailService as any).rateLimiter;
      const remaining = rateLimiter.getRemainingEmails(email);
      expect(remaining).toBe(2); // 5 - 3 = 2 remaining
    });

    it('should handle rate limiter for new email address', () => {
      const rateLimiter = (emailService as any).rateLimiter;
      const remaining = rateLimiter.getRemainingEmails('new@example.com');
      expect(remaining).toBe(5); // Full limit available for new address
    });
  });
});
