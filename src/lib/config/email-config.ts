/**
 * Email Configuration for Production-Ready Email Sending
 * Supports multiple email providers with automatic failover
 */

export interface EmailConfig {
  provider: 'sendgrid' | 'aws-ses' | 'smtp' | 'development';
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  
  // SendGrid configuration
  sendgrid?: {
    apiKey: string;
  };
  
  // AWS SES configuration  
  awsSes?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  
  // SMTP configuration
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  
  // Retry configuration
  retries: number;
  retryDelay: number;
  
  // Rate limiting
  maxEmailsPerHour: number;
  
  // Template configuration
  baseUrl: string;
  supportEmail: string;
}

export function getEmailConfig(): EmailConfig {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // Default development configuration
  const defaultConfig: EmailConfig = {
    provider: 'development',
    fromEmail: process.env.EMAIL_FROM || 'noreply@table.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Table Poker',
    replyTo: process.env.EMAIL_REPLY_TO,
    retries: 3,
    retryDelay: 1000,
    maxEmailsPerHour: isDevelopment ? 1000 : 100,
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    supportEmail: process.env.EMAIL_SUPPORT || 'support@table.com'
  };

  // Production email provider configuration
  if (process.env.SENDGRID_API_KEY) {
    return {
      ...defaultConfig,
      provider: 'sendgrid',
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY
      }
    };
  }

  if (process.env.AWS_SES_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      ...defaultConfig,
      provider: 'aws-ses',
      awsSes: {
        region: process.env.AWS_SES_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      ...defaultConfig,
      provider: 'smtp',
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      }
    };
  }

  return defaultConfig;
}

// Email template configuration
export interface EmailTemplateConfig {
  passwordReset: {
    subject: string;
    expiryMinutes: number;
  };
  welcome: {
    subject: string;
  };
  accountVerification: {
    subject: string;
    expiryMinutes: number;
  };
}

export const emailTemplates: EmailTemplateConfig = {
  passwordReset: {
    subject: 'Reset Your Password - Table Poker',
    expiryMinutes: 60
  },
  welcome: {
    subject: 'Welcome to Table Poker!'
  },
  accountVerification: {
    subject: 'Verify Your Account - Table Poker',
    expiryMinutes: 1440 // 24 hours
  }
};
