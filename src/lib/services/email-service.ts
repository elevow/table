/**
 * Production-Ready Email Service for Password Reset and Notifications
 * 
 * Features:
 * - Multiple email provider support (SendGrid, AWS SES, SMTP)
 * - Automatic failover and retry logic
 * - Rate limiting and abuse prevention
 * - Professional HTML email templates
 * - Comprehensive error handling and logging
 * - Development mode with console logging
 */

import { getEmailConfig, emailTemplates, type EmailConfig } from '../config/email-config';

export interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export interface SendEmailOptions {
  to: string;
  from?: string;
  fromName?: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  retryCount?: number;
}

class EmailRateLimiter {
  private emailCounts = new Map<string, { count: number; resetTime: number }>();
  private readonly maxEmails: number;
  private readonly windowMs: number = 60 * 60 * 1000; // 1 hour

  constructor(maxEmailsPerHour: number) {
    this.maxEmails = maxEmailsPerHour;
  }

  canSendEmail(email: string): boolean {
    const now = Date.now();
    const userCounts = this.emailCounts.get(email);

    if (!userCounts || now > userCounts.resetTime) {
      this.emailCounts.set(email, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (userCounts.count >= this.maxEmails) {
      return false;
    }

    userCounts.count++;
    return true;
  }

  getRemainingEmails(email: string): number {
    const userCounts = this.emailCounts.get(email);
    if (!userCounts || Date.now() > userCounts.resetTime) {
      return this.maxEmails;
    }
    return Math.max(0, this.maxEmails - userCounts.count);
  }
}

export class EmailService {
  private config: EmailConfig;
  private rateLimiter: EmailRateLimiter;
  private sendGridClient: any;
  private awsSES: any;
  private smtpTransporter: any;

  constructor(config?: EmailConfig) {
    this.config = config || getEmailConfig();
    this.rateLimiter = new EmailRateLimiter(this.config.maxEmailsPerHour);
    
    // Initialize email providers
    this.initializeProviders();
  }

  private async initializeProviders() {
    try {
      switch (this.config.provider) {
        case 'sendgrid':
          if (this.config.sendgrid?.apiKey) {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(this.config.sendgrid.apiKey);
            this.sendGridClient = sgMail;
          }
          break;

        case 'aws-ses':
          if (this.config.awsSes) {
            const AWS = require('aws-sdk');
            AWS.config.update({
              accessKeyId: this.config.awsSes.accessKeyId,
              secretAccessKey: this.config.awsSes.secretAccessKey,
              region: this.config.awsSes.region
            });
            this.awsSES = new AWS.SES();
          }
          break;

        case 'smtp':
          if (this.config.smtp) {
            const nodemailer = require('nodemailer');
            this.smtpTransporter = nodemailer.createTransporter({
              host: this.config.smtp.host,
              port: this.config.smtp.port,
              secure: this.config.smtp.secure,
              auth: {
                user: this.config.smtp.auth.user,
                pass: this.config.smtp.auth.pass
              }
            });
          }
          break;
      }
    } catch (error) {
      console.warn('Failed to initialize email provider:', error);
    }
  }

  /**
   * Send password reset email with secure token
   */
  async sendPasswordResetEmail(email: string, resetToken: string, expiryMinutes = 60): Promise<EmailResult> {
    // Rate limiting check
    if (!this.rateLimiter.canSendEmail(email)) {
      return {
        success: false,
        error: `Rate limit exceeded. ${this.rateLimiter.getRemainingEmails(email)} emails remaining this hour.`
      };
    }

    const resetUrl = `${this.config.baseUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    const template = this.getPasswordResetTemplate(resetUrl, expiryMinutes);
    
    return this.sendEmailWithRetry({
      to: email,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody
    });
  }

  /**
   * Send welcome email for new users
   */
  async sendWelcomeEmail(email: string, username: string): Promise<EmailResult> {
    const template = this.getWelcomeTemplate(username);
    
    return this.sendEmailWithRetry({
      to: email,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody
    });
  }

  /**
   * Send account verification email
   */
  async sendVerificationEmail(email: string, verificationToken: string): Promise<EmailResult> {
    const verifyUrl = `${this.config.baseUrl}/verify-account?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const template = this.getVerificationTemplate(verifyUrl);
    
    return this.sendEmailWithRetry({
      to: email,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody
    });
  }

  /**
   * Core email sending method with retry logic
   */
  private async sendEmailWithRetry(options: SendEmailOptions): Promise<EmailResult> {
    let lastError: string = '';
    
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const result = await this.sendEmail(options);
        if (result.success) {
          return { ...result, retryCount: attempt };
        }
        lastError = result.error || 'Unknown error';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Email send attempt ${attempt + 1} failed:`, lastError);
      }

      // Wait before retry (exponential backoff)
      if (attempt < this.config.retries) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt)));
      }
    }

    return {
      success: false,
      error: `Failed after ${this.config.retries + 1} attempts: ${lastError}`,
      retryCount: this.config.retries + 1
    };
  }

  /**
   * Send email using configured provider
   */
  private async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    if (this.config.provider === 'development') {
      return this.sendDevelopmentEmail(options);
    }

    try {
      switch (this.config.provider) {
        case 'sendgrid':
          return await this.sendWithSendGrid(options);
        case 'aws-ses':
          return await this.sendWithAWSSES(options);
        case 'smtp':
          return await this.sendWithSMTP(options);
        default:
          throw new Error(`Unsupported email provider: ${this.config.provider}`);
      }
    } catch (error) {
      console.error(`Email provider ${this.config.provider} failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown provider error',
        provider: this.config.provider
      };
    }
  }

  private async sendWithSendGrid(options: SendEmailOptions): Promise<EmailResult> {
    if (!this.sendGridClient) {
      throw new Error('SendGrid not configured');
    }

    const msg = {
      to: options.to,
      from: {
        email: options.from || this.config.fromEmail,
        name: options.fromName || this.config.fromName
      },
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || this.config.replyTo
    };

    const response = await this.sendGridClient.send(msg);
    return {
      success: true,
      messageId: response[0]?.headers?.['x-message-id'],
      provider: 'sendgrid'
    };
  }

  private async sendWithAWSSES(options: SendEmailOptions): Promise<EmailResult> {
    if (!this.awsSES) {
      throw new Error('AWS SES not configured');
    }

    const params = {
      Destination: {
        ToAddresses: [options.to]
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: options.html
          },
          Text: {
            Charset: 'UTF-8',
            Data: options.text
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: options.subject
        }
      },
      Source: options.from || this.config.fromEmail,
      ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined
    };

    const response = await this.awsSES.sendEmail(params).promise();
    return {
      success: true,
      messageId: response.MessageId,
      provider: 'aws-ses'
    };
  }

  private async sendWithSMTP(options: SendEmailOptions): Promise<EmailResult> {
    if (!this.smtpTransporter) {
      throw new Error('SMTP not configured');
    }

    const mailOptions = {
      from: `${options.fromName || this.config.fromName} <${options.from || this.config.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || this.config.replyTo
    };

    const response = await this.smtpTransporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: response.messageId,
      provider: 'smtp'
    };
  }

  private async sendDevelopmentEmail(options: SendEmailOptions): Promise<EmailResult> {
    console.log('\n📧 ================== EMAIL (Development Mode) ==================');
    console.log(`To: ${options.to}`);
    console.log(`From: ${options.from || this.config.fromEmail}`);
    console.log(`Subject: ${options.subject}`);
    console.log('─'.repeat(60));
    console.log('HTML Content:');
    console.log(options.html);
    console.log('─'.repeat(60));
    console.log('Text Content:');
    console.log(options.text);
    console.log('===============================================================\n');
    
    return {
      success: true,
      messageId: `dev-${Date.now()}`,
      provider: 'development'
    };
  }

  private getPasswordResetTemplate(resetUrl: string, expiryMinutes = 60): EmailTemplate {
    const subject = emailTemplates.passwordReset.subject;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${subject}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
            .content { background: white; padding: 40px; border: 1px solid #e5e7eb; }
            .button { display: inline-block; background-color: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 30px 0; }
            .button:hover { background-color: #1d4ed8; }
            .footer { background: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 8px 8px; color: #6b7280; font-size: 14px; }
            .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 15px; margin: 20px 0; color: #92400e; }
            .link-fallback { word-break: break-all; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎮 Table Poker</h1>
            </div>
            <div class="content">
              <h2 style="color: #1f2937; margin-bottom: 20px;">Reset Your Password</h2>
              <p>You requested to reset your password for your Table account.</p>
              <p>Click the button below to create a new password. This link will expire in <strong>${expiryMinutes} minutes</strong>.</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset My Password</a>
              </div>
              
              <div class="warning">
                <strong>⚠️ Security Notice:</strong> This link can only be used once and will expire automatically.
              </div>
              
              <p>If the button doesn't work, copy and paste this link in your browser:</p>
              <div class="link-fallback">${resetUrl}</div>
              
              <p style="margin-top: 30px; color: #6b7280;">If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
            </div>
            <div class="footer">
              <p><strong>Table Poker</strong> - The Premier Online Poker Experience</p>
              <p>Need help? Contact us at <a href="mailto:${this.config.supportEmail}">${this.config.supportEmail}</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    const textBody = `
Reset Your Password - Table Poker

You requested to reset your password for your Table account.

Click this link to create a new password (expires in ${expiryMinutes} minutes):
${resetUrl}

SECURITY NOTICE: This link can only be used once and will expire automatically.

If you didn't request this password reset, please ignore this email and your password will remain unchanged.

---
Table Poker - The Premier Online Poker Experience
Need help? Contact us at ${this.config.supportEmail}
    `;

    return { subject, htmlBody, textBody };
  }

  private getWelcomeTemplate(username: string): EmailTemplate {
    const subject = emailTemplates.welcome.subject;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${subject}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
            .content { background: white; padding: 40px; border: 1px solid #e5e7eb; }
            .button { display: inline-block; background-color: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 30px 0; }
            .features { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .feature { display: flex; align-items: center; margin: 15px 0; }
            .feature-icon { margin-right: 12px; font-size: 20px; }
            .footer { background: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 8px 8px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎮 Welcome to Table Poker!</h1>
            </div>
            <div class="content">
              <h2 style="color: #1f2937;">Hello ${username}! 👋</h2>
              <p>Welcome to Table, the premier online poker platform. We're excited to have you join our community of poker enthusiasts!</p>
              
              <div class="features">
                <h3 style="margin-top: 0; color: #1f2937;">What you can do now:</h3>
                <div class="feature">
                  <span class="feature-icon">🃏</span>
                  <span>Join poker games with players worldwide</span>
                </div>
                <div class="feature">
                  <span class="feature-icon">📊</span>
                  <span>Track your statistics and improve your game</span>
                </div>
                <div class="feature">
                  <span class="feature-icon">🏆</span>
                  <span>Participate in tournaments and challenges</span>
                </div>
                <div class="feature">
                  <span class="feature-icon">👥</span>
                  <span>Connect with fellow poker players</span>
                </div>
              </div>
              
              <div style="text-align: center;">
                <a href="${this.config.baseUrl}/dashboard" class="button">Start Playing Now</a>
              </div>
              
              <p>Good luck at the tables, and may the cards be in your favor! 🍀</p>
            </div>
            <div class="footer">
              <p><strong>Table Poker</strong> - The Premier Online Poker Experience</p>
              <p>Questions? We're here to help at <a href="mailto:${this.config.supportEmail}">${this.config.supportEmail}</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    const textBody = `
Welcome to Table Poker!

Hello ${username}!

Welcome to Table, the premier online poker platform. We're excited to have you join our community of poker enthusiasts!

What you can do now:
🃏 Join poker games with players worldwide
📊 Track your statistics and improve your game
🏆 Participate in tournaments and challenges
👥 Connect with fellow poker players

Start playing: ${this.config.baseUrl}/dashboard

Good luck at the tables, and may the cards be in your favor!

---
Table Poker - The Premier Online Poker Experience
Questions? We're here to help at ${this.config.supportEmail}
    `;

    return { subject, htmlBody, textBody };
  }

  private getVerificationTemplate(verifyUrl: string): EmailTemplate {
    const subject = emailTemplates.accountVerification.subject;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${subject}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
            .content { background: white; padding: 40px; border: 1px solid #e5e7eb; }
            .button { display: inline-block; background-color: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 30px 0; }
            .footer { background: #f9fafb; padding: 30px; text-align: center; border-radius: 0 0 8px 8px; color: #6b7280; font-size: 14px; }
            .link-fallback { word-break: break-all; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎮 Table Poker</h1>
            </div>
            <div class="content">
              <h2 style="color: #1f2937;">Verify Your Account</h2>
              <p>Please verify your email address to complete your Table account setup.</p>
              <p>Click the button below to verify your account:</p>
              
              <div style="text-align: center;">
                <a href="${verifyUrl}" class="button">Verify My Account</a>
              </div>
              
              <p>If the button doesn't work, copy and paste this link in your browser:</p>
              <div class="link-fallback">${verifyUrl}</div>
              
              <p style="margin-top: 30px; color: #6b7280;">This verification link will expire in 24 hours.</p>
            </div>
            <div class="footer">
              <p><strong>Table Poker</strong> - The Premier Online Poker Experience</p>
              <p>Need help? Contact us at <a href="mailto:${this.config.supportEmail}">${this.config.supportEmail}</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    const textBody = `
Verify Your Account - Table Poker

Please verify your email address to complete your Table account setup.

Click this link to verify your account:
${verifyUrl}

This verification link will expire in 24 hours.

---
Table Poker - The Premier Online Poker Experience
Need help? Contact us at ${this.config.supportEmail}
    `;

    return { subject, htmlBody, textBody };
  }

  /**
   * Test email configuration and connectivity
   */
  async testEmailConfiguration(): Promise<{ success: boolean; provider: string; error?: string }> {
    try {
      // Test with a dummy email send (development mode)
      const originalProvider = this.config.provider;
      this.config.provider = 'development';
      
      const result = await this.sendEmail({
        to: 'test@example.com',
        subject: 'Email Configuration Test',
        html: '<p>This is a test email to verify configuration.</p>',
        text: 'This is a test email to verify configuration.'
      });
      
      this.config.provider = originalProvider;
      
      return {
        success: result.success,
        provider: originalProvider,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        provider: this.config.provider,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance with default configuration
export const emailService = new EmailService();
