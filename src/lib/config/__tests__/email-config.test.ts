import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getEmailConfig, emailTemplates, type EmailConfig, type EmailTemplateConfig } from '../email-config';

describe('Email Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original environment variables
    originalEnv = { ...process.env };
    
    // Clear all email-related environment variables
    delete (process.env as any).NODE_ENV;
    delete (process.env as any).EMAIL_FROM;
    delete (process.env as any).EMAIL_FROM_NAME;
    delete (process.env as any).EMAIL_REPLY_TO;
    delete (process.env as any).EMAIL_SUPPORT;
    delete (process.env as any).NEXT_PUBLIC_BASE_URL;
    delete (process.env as any).SENDGRID_API_KEY;
    delete (process.env as any).AWS_SES_REGION;
    delete (process.env as any).AWS_ACCESS_KEY_ID;
    delete (process.env as any).AWS_SECRET_ACCESS_KEY;
    delete (process.env as any).SMTP_HOST;
    delete (process.env as any).SMTP_PORT;
    delete (process.env as any).SMTP_SECURE;
    delete (process.env as any).SMTP_USER;
    delete (process.env as any).SMTP_PASS;
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('getEmailConfig', () => {
    test('returns default development configuration when no environment variables are set', () => {
      const config = getEmailConfig();
      
      expect(config).toEqual({
        provider: 'development',
        fromEmail: 'noreply@table.com',
        fromName: 'Table Poker',
        replyTo: undefined,
        retries: 3,
        retryDelay: 1000,
        maxEmailsPerHour: 1000,
        baseUrl: 'http://localhost:3000',
        supportEmail: 'support@table.com'
      });
    });

    test('uses custom values from environment variables for default config', () => {
      (process.env as any).EMAIL_FROM = 'custom@example.com';
      (process.env as any).EMAIL_FROM_NAME = 'Custom Name';
      (process.env as any).EMAIL_REPLY_TO = 'reply@example.com';
      (process.env as any).EMAIL_SUPPORT = 'help@example.com';
      (process.env as any).NEXT_PUBLIC_BASE_URL = 'https://custom.com';

      const config = getEmailConfig();

      expect(config).toEqual(expect.objectContaining({
        provider: 'development',
        fromEmail: 'custom@example.com',
        fromName: 'Custom Name',
        replyTo: 'reply@example.com',
        supportEmail: 'help@example.com',
        baseUrl: 'https://custom.com'
      }));
    });

    test('sets lower email rate limit for production environment', () => {
      (process.env as any).NODE_ENV = 'production';
      
      const config = getEmailConfig();
      
      expect(config.maxEmailsPerHour).toBe(100);
    });

    test('sets higher email rate limit for development environment', () => {
      (process.env as any).NODE_ENV = 'development';
      
      const config = getEmailConfig();
      
      expect(config.maxEmailsPerHour).toBe(1000);
    });

    test('returns SendGrid configuration when SENDGRID_API_KEY is provided', () => {
      (process.env as any).SENDGRID_API_KEY = 'sg-test-key-123';
      (process.env as any).EMAIL_FROM = 'test@example.com';

      const config = getEmailConfig();

      expect(config).toEqual(expect.objectContaining({
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
        sendgrid: {
          apiKey: 'sg-test-key-123'
        }
      }));
    });

    test('returns AWS SES configuration when all AWS variables are provided', () => {
      (process.env as any).AWS_SES_REGION = 'us-east-1';
      (process.env as any).AWS_ACCESS_KEY_ID = 'test-access-key';
      (process.env as any).AWS_SECRET_ACCESS_KEY = 'test-secret-key';

      const config = getEmailConfig();

      expect(config).toEqual(expect.objectContaining({
        provider: 'aws-ses',
        awsSes: {
          region: 'us-east-1',
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key'
        }
      }));
    });

    test('does not return AWS SES configuration when only some AWS variables are provided', () => {
      (process.env as any).AWS_SES_REGION = 'us-east-1';
      // Missing AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY

      const config = getEmailConfig();

      expect(config.provider).toBe('development');
      expect(config.awsSes).toBeUndefined();
    });

    test('returns SMTP configuration when all SMTP variables are provided', () => {
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';
      (process.env as any).SMTP_PORT = '465';
      (process.env as any).SMTP_SECURE = 'true';

      const config = getEmailConfig();

      expect(config).toEqual(expect.objectContaining({
        provider: 'smtp',
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          auth: {
            user: 'smtp-user',
            pass: 'smtp-password'
          }
        }
      }));
    });

    test('uses default SMTP port (587) when SMTP_PORT is not provided', () => {
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';
      // SMTP_PORT not set

      const config = getEmailConfig();

      expect(config.smtp?.port).toBe(587);
    });

    test('sets SMTP secure to false when SMTP_SECURE is not "true"', () => {
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';
      (process.env as any).SMTP_SECURE = 'false';

      const config = getEmailConfig();

      expect(config.smtp?.secure).toBe(false);
    });

    test('does not return SMTP configuration when required SMTP variables are missing', () => {
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      // Missing SMTP_USER and SMTP_PASS

      const config = getEmailConfig();

      expect(config.provider).toBe('development');
      expect(config.smtp).toBeUndefined();
    });

    test('prioritizes SendGrid over AWS SES when both are configured', () => {
      (process.env as any).SENDGRID_API_KEY = 'sg-test-key';
      (process.env as any).AWS_SES_REGION = 'us-east-1';
      (process.env as any).AWS_ACCESS_KEY_ID = 'test-access-key';
      (process.env as any).AWS_SECRET_ACCESS_KEY = 'test-secret-key';

      const config = getEmailConfig();

      expect(config.provider).toBe('sendgrid');
      expect(config.sendgrid).toBeDefined();
      expect(config.awsSes).toBeUndefined();
    });

    test('prioritizes SendGrid over SMTP when both are configured', () => {
      (process.env as any).SENDGRID_API_KEY = 'sg-test-key';
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';

      const config = getEmailConfig();

      expect(config.provider).toBe('sendgrid');
      expect(config.sendgrid).toBeDefined();
      expect(config.smtp).toBeUndefined();
    });

    test('prioritizes AWS SES over SMTP when both are configured', () => {
      (process.env as any).AWS_SES_REGION = 'us-east-1';
      (process.env as any).AWS_ACCESS_KEY_ID = 'test-access-key';
      (process.env as any).AWS_SECRET_ACCESS_KEY = 'test-secret-key';
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';

      const config = getEmailConfig();

      expect(config.provider).toBe('aws-ses');
      expect(config.awsSes).toBeDefined();
      expect(config.smtp).toBeUndefined();
    });

    test('handles invalid SMTP port gracefully', () => {
      (process.env as any).SMTP_HOST = 'smtp.example.com';
      (process.env as any).SMTP_USER = 'smtp-user';
      (process.env as any).SMTP_PASS = 'smtp-password';
      (process.env as any).SMTP_PORT = 'invalid-port';

      const config = getEmailConfig();

      expect(config.smtp?.port).toBeNaN();
    });

    test('always includes default configuration properties', () => {
      (process.env as any).SENDGRID_API_KEY = 'sg-test-key';

      const config = getEmailConfig();

      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('fromEmail');
      expect(config).toHaveProperty('fromName');
      expect(config).toHaveProperty('retries', 3);
      expect(config).toHaveProperty('retryDelay', 1000);
      expect(config).toHaveProperty('maxEmailsPerHour');
      expect(config).toHaveProperty('baseUrl');
      expect(config).toHaveProperty('supportEmail');
    });
  });

  describe('emailTemplates', () => {
    test('exports correct password reset template configuration', () => {
      expect(emailTemplates.passwordReset).toEqual({
        subject: 'Reset Your Password - Table Poker',
        expiryMinutes: 60
      });
    });

    test('exports correct welcome template configuration', () => {
      expect(emailTemplates.welcome).toEqual({
        subject: 'Welcome to Table Poker!'
      });
    });

    test('exports correct account verification template configuration', () => {
      expect(emailTemplates.accountVerification).toEqual({
        subject: 'Verify Your Account - Table Poker',
        expiryMinutes: 1440
      });
    });

    test('has all required template properties', () => {
      expect(emailTemplates).toHaveProperty('passwordReset');
      expect(emailTemplates).toHaveProperty('welcome');
      expect(emailTemplates).toHaveProperty('accountVerification');
    });

    test('password reset template has required properties', () => {
      expect(emailTemplates.passwordReset).toHaveProperty('subject');
      expect(emailTemplates.passwordReset).toHaveProperty('expiryMinutes');
      expect(typeof emailTemplates.passwordReset.subject).toBe('string');
      expect(typeof emailTemplates.passwordReset.expiryMinutes).toBe('number');
    });

    test('welcome template has required properties', () => {
      expect(emailTemplates.welcome).toHaveProperty('subject');
      expect(typeof emailTemplates.welcome.subject).toBe('string');
    });

    test('account verification template has required properties', () => {
      expect(emailTemplates.accountVerification).toHaveProperty('subject');
      expect(emailTemplates.accountVerification).toHaveProperty('expiryMinutes');
      expect(typeof emailTemplates.accountVerification.subject).toBe('string');
      expect(typeof emailTemplates.accountVerification.expiryMinutes).toBe('number');
    });
  });

  describe('TypeScript type definitions', () => {
    test('EmailConfig interface supports all expected properties', () => {
      const config: EmailConfig = {
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
        fromName: 'Test Name',
        replyTo: 'reply@example.com',
        sendgrid: {
          apiKey: 'test-key'
        },
        awsSes: {
          region: 'us-east-1',
          accessKeyId: 'key',
          secretAccessKey: 'secret'
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: {
            user: 'user',
            pass: 'pass'
          }
        },
        retries: 3,
        retryDelay: 1000,
        maxEmailsPerHour: 100,
        baseUrl: 'https://example.com',
        supportEmail: 'support@example.com'
      };

      expect(config).toBeDefined();
    });

    test('EmailTemplateConfig interface supports all expected properties', () => {
      const templates: EmailTemplateConfig = {
        passwordReset: {
          subject: 'Reset Password',
          expiryMinutes: 60
        },
        welcome: {
          subject: 'Welcome!'
        },
        accountVerification: {
          subject: 'Verify Account',
          expiryMinutes: 1440
        }
      };

      expect(templates).toBeDefined();
    });
  });
});
