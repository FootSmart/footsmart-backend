import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Email Service for sending password reset emails
 * 
 * PRODUCTION SETUP:
 * - Use SendGrid, AWS SES, or Postmark for production
 * - Configure SPF, DKIM, and DMARC records
 * - Use email templates with proper branding
 * - Add email queuing (BullMQ, etc.)
 * - Monitor delivery rates and bounces
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter based on configuration
   */
  private initializeTransporter() {
    const emailProvider = this.configService.get<string>('EMAIL_PROVIDER', 'resend');

    if (emailProvider !== 'resend') {
      this.logger.warn(`EMAIL_PROVIDER=${emailProvider} is not supported. Using Resend.`);
    }

    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.error('RESEND_API_KEY is not configured');
    }

    this.resend = new Resend(apiKey || '');
    this.logger.log('Email transporter initialized successfully');
  }

  /**
   * Send password reset email with deep link
   * 
   * @param email - Recipient email address
   * @param resetToken - Secure reset token (already hashed in DB)
   * @param userName - User's display name (optional)
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName?: string,
  ): Promise<boolean> {
    try {
      const appName = this.configService.get<string>('APP_NAME', 'FootSmart');
      const deepLink = this.configService.get<string>('RESET_REDIRECT_URL', 'footsmart://reset-password');
      const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL', 'onboarding@resend.dev');
      
      // Construct deep link for Flutter app
      // Format: myapp://reset-password?token=abc123
      const resetLink = `${deepLink}?token=${resetToken}`;
      
      // Alternative web link (if you have a landing page)
      const webLink = this.configService.get<string>('WEB_RESET_URL');
      const fallbackLink = webLink ? `${webLink}?token=${resetToken}` : resetLink;

      const { data, error } = await this.resend.emails.send({
        from: `${appName} <${fromEmail}>`,
        to: email,
        subject: `Reset Your ${appName} Password`,
        html: this.getPasswordResetEmailTemplate(
          userName || 'User',
          resetLink,
          fallbackLink,
          appName,
        ),
        text: this.getPasswordResetEmailText(
          userName || 'User',
          resetLink,
          appName,
        ),
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Password reset email sent to ${email}. Id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}: ${error.message}`);
      return false;
    }
  }

  /**
   * HTML email template for password reset
   */
  private getPasswordResetEmailTemplate(
    userName: string,
    resetLink: string,
    fallbackLink: string,
    appName: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background-color: #ffffff;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 30px;
              text-align: center;
              color: #ffffff;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: 600;
            }
            .content {
              padding: 40px 30px;
            }
            .content p {
              margin: 0 0 16px;
              font-size: 16px;
            }
            .button {
              display: inline-block;
              padding: 14px 32px;
              background-color: #10b981;
              color: #ffffff !important;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
              font-size: 16px;
              margin: 24px 0;
              text-align: center;
            }
            .button:hover {
              background-color: #059669;
            }
            .info-box {
              background-color: #f9fafb;
              border-left: 4px solid #10b981;
              padding: 16px;
              margin: 24px 0;
              font-size: 14px;
            }
            .footer {
              background-color: #f9fafb;
              padding: 24px 30px;
              text-align: center;
              font-size: 14px;
              color: #6b7280;
            }
            .footer a {
              color: #667eea;
              text-decoration: none;
            }
            .security-note {
              background-color: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 16px;
              margin: 24px 0;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔒 Password Reset Request</h1>
            </div>
            
            <div class="content">
              <p>Hi <strong>${userName}</strong>,</p>
              
              <p>We received a request to reset your ${appName} password. Click the button below to choose a new password:</p>
              
              <div style="text-align: center;">
                <a href="${resetLink}" class="button">Reset Password</a>
              </div>
              
              <div class="info-box">
                <strong>⏰ This link expires in 1 hour</strong><br>
                For your security, this password reset link is only valid for 60 minutes and can only be used once.
              </div>
              
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #667eea; font-size: 14px;">${fallbackLink}</p>
              
              <div class="security-note">
                <strong>⚠️ Didn't request this?</strong><br>
                If you didn't request a password reset, please ignore this email or contact our support team if you're concerned about your account security. Your password will not be changed unless you click the link above.
              </div>
            </div>
            
            <div class="footer">
              <p>Best regards,<br><strong>${appName} Team</strong></p>
              <p style="margin-top: 16px; font-size: 12px; color: #9ca3af;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Plain text version of password reset email
   */
  private getPasswordResetEmailText(
    userName: string,
    resetLink: string,
    appName: string,
  ): string {
    return `
Hi ${userName},

We received a request to reset your ${appName} password.

To reset your password, click the link below or paste it into your browser:
${resetLink}

This link expires in 1 hour and can only be used once.

If you didn't request a password reset, please ignore this email. Your password will not be changed.

Best regards,
${appName} Team

---
This is an automated message. Please do not reply to this email.
    `.trim();
  }

  /**
   * Verify email configuration is working (call on startup)
   */
  async verifyConnection(): Promise<boolean> {
    try {
      const apiKey = this.configService.get<string>('RESEND_API_KEY');
      if (!apiKey) {
        this.logger.error('RESEND_API_KEY is not configured');
        return false;
      }

      this.logger.log('Resend API key is configured');
      return true;
    } catch (error) {
      this.logger.error(`Email server connection failed: ${error.message}`);
      return false;
    }
  }
}
