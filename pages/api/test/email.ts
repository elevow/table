import type { NextApiRequest, NextApiResponse } from 'next';
import { emailService } from '../../../src/lib/services/email-service';
import { getEmailConfig } from '../../../src/lib/config/email-config';

interface TestEmailRequest {
  email: string;
  type: 'password-reset' | 'welcome' | 'verification' | 'config-test';
  username?: string;
}

interface TestEmailResponse {
  success: boolean;
  message: string;
  config?: {
    provider: string;
    fromEmail: string;
    configured: boolean;
  };
  result?: {
    messageId?: string;
    provider?: string;
    retryCount?: number;
    error?: string;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TestEmailResponse | { error: string }>
) {
  // Only allow in development mode for security
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, type, username = 'TestUser' }: TestEmailRequest = req.body;

    if (!email || !type) {
      return res.status(400).json({ error: 'Email and type are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const config = getEmailConfig();
    
    // Test configuration
    if (type === 'config-test') {
      const testResult = await emailService.testEmailConfiguration();
      return res.status(200).json({
        success: testResult.success,
        message: testResult.success ? 'Email configuration is working' : 'Email configuration failed',
        config: {
          provider: config.provider,
          fromEmail: config.fromEmail,
          configured: testResult.success
        },
        result: {
          error: testResult.error
        }
      });
    }

    let result;
    let message: string;

    // Send test email based on type
    switch (type) {
      case 'password-reset':
        result = await emailService.sendPasswordResetEmail(email, 'test-token-12345', 60);
        message = 'Password reset email sent';
        break;
        
      case 'welcome':
        result = await emailService.sendWelcomeEmail(email, username);
        message = 'Welcome email sent';
        break;
        
      case 'verification':
        result = await emailService.sendVerificationEmail(email, 'test-verification-token-12345');
        message = 'Verification email sent';
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid email type' });
    }

    return res.status(200).json({
      success: result.success,
      message: result.success ? message : `Failed to send ${type} email`,
      config: {
        provider: config.provider,
        fromEmail: config.fromEmail,
        configured: true
      },
      result: {
        messageId: result.messageId,
        provider: result.provider,
        retryCount: result.retryCount,
        error: result.error
      }
    });

  } catch (error) {
    console.error('Email test error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
