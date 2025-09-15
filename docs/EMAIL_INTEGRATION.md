# Email Integration Guide

This guide explains how to configure and use the email integration for password reset and user notifications.

## Quick Start (Development)

In development mode, emails are automatically logged to the console. No configuration is needed to test the functionality.

## Production Setup

### Option 1: SendGrid (Recommended)

1. **Sign up for SendGrid**: https://sendgrid.com/
2. **Create an API Key** with "Mail Send" permissions
3. **Add to your `.env.local`**:
```env
SENDGRID_API_KEY=your_sendgrid_api_key_here
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your App Name
```

### Option 2: AWS SES (Cost-effective for high volume)

1. **Configure AWS SES** in your AWS account
2. **Create IAM user** with SES permissions
3. **Add to your `.env.local`**:
```env
AWS_SES_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your App Name
```

### Option 3: Gmail SMTP (Easy for small projects)

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate an App Password**: https://myaccount.google.com/apppasswords
3. **Add to your `.env.local`**:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@gmail.com
SMTP_PASS=your_16_character_app_password
EMAIL_FROM=your.email@gmail.com
EMAIL_FROM_NAME=Your App Name
```

### Option 4: Custom SMTP Server

```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your_smtp_password
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your App Name
```

## Environment Variables

Copy `.env.email.example` to your `.env.local` and configure:

```env
# Basic settings
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your App Name
EMAIL_REPLY_TO=support@yourdomain.com
EMAIL_SUPPORT=support@yourdomain.com
NEXT_PUBLIC_BASE_URL=https://yourdomain.com

# Choose ONE provider configuration:
# SendGrid OR AWS SES OR SMTP
```

## Features

### 🔐 Password Reset Emails
- **Secure tokens** with configurable expiration
- **Professional HTML templates** with branded styling
- **Rate limiting** to prevent abuse
- **One-time use tokens** for security

### 🎉 Welcome Emails
- **Sent automatically** on user registration
- **Personalized content** with username
- **Feature highlights** and getting started info

### ✅ Account Verification (Ready to implement)
- **Email verification tokens**
- **Configurable expiration times**
- **Professional templates**

### 🛡️ Security Features
- **Rate limiting** per email address
- **Retry logic** with exponential backoff
- **Multiple provider failover**
- **Comprehensive audit logging**
- **Anti-abuse protection**

## Testing

### Development Mode
```bash
# Start your development server
npm run dev

# Try the forgot password feature at:
http://localhost:3000/forgot-password

# Check console for email output
```

### API Testing (Development only)
```bash
# Test password reset email
curl -X POST http://localhost:3000/api/test/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "type": "password-reset"
  }'

# Test welcome email
curl -X POST http://localhost:3000/api/test/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "type": "welcome",
    "username": "TestUser"
  }'

# Test configuration
curl -X POST http://localhost:3000/api/test/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "type": "config-test"
  }'
```

## Email Templates

The email service includes professionally designed HTML templates:

### Password Reset Email
- **Branded header** with gradient background
- **Clear call-to-action button**
- **Security warnings and instructions**
- **Fallback link** for email clients that don't support buttons
- **Professional footer** with support contact

### Welcome Email
- **Personalized greeting**
- **Feature highlights** with icons
- **Getting started button**
- **Encouraging messaging**

### Verification Email (Available)
- **Account verification flow**
- **Clear instructions**
- **Time-limited tokens**

## Monitoring and Troubleshooting

### Logs
All email attempts are logged with:
- **Success/failure status**
- **Provider used**
- **Retry attempts**
- **Error messages**
- **Rate limiting status**

### Common Issues

**Email not sending in production:**
1. Check environment variables are set correctly
2. Verify API keys have correct permissions
3. Check spam folders
4. Review console logs for detailed errors

**Rate limiting:**
- Users are limited to prevent abuse
- Limits: 100 emails per hour per address (configurable)
- Check logs for rate limit messages

**SMTP authentication:**
- Use App Passwords for Gmail (not regular password)
- Ensure 2FA is enabled for Gmail
- Check SMTP server settings

## Customization

### Email Templates
Edit templates in `src/lib/services/email-service.ts`:
- Modify HTML styling
- Update text content
- Add new email types
- Customize branding

### Configuration
Modify `src/lib/config/email-config.ts`:
- Add new providers
- Change rate limits
- Update retry logic
- Add new template types

## Production Checklist

- [ ] Environment variables configured
- [ ] Email provider API key tested
- [ ] From address verified with provider
- [ ] Domain authentication configured (if using custom domain)
- [ ] Rate limits appropriate for your use case
- [ ] Error monitoring in place
- [ ] Spam testing completed
- [ ] Email deliverability tested

## Support

The email integration supports all major providers and includes comprehensive error handling. All emails include professional templates with your branding and clear calls-to-action.

For issues, check the console logs which include detailed information about email sending attempts, provider responses, and any errors encountered.
