import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetRateLimitGuard } from './guards/password-reset-rate-limit.guard';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'User registration' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  @ApiResponse({ status: 400, description: 'Invalid input or role' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('forgot-password')
  @UseGuards(PasswordResetRateLimitGuard)
  @ApiOperation({ 
    summary: 'Request password reset',
    description: 'Sends a password reset email with a secure one-time token. Always returns success to prevent email enumeration.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Generic success message sent (email may or may not exist)',
    schema: {
      example: {
        message: 'If an account exists with this email, a password reset link has been sent.',
        success: true,
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests. Rate limit exceeded.' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @ApiOperation({ 
    summary: 'Reset password with token',
    description: 'Validates the token from email and updates user password. Token is one-time use and expires in 1 hour.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successfully',
    schema: {
      example: {
        message: 'Password reset successfully. Please login with your new password.',
        success: true,
      },
    },
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid, expired, or already used token',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid or expired reset token',
        error: 'Bad Request',
      },
    },
  })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('verify-reset-token')
  @ApiOperation({ 
    summary: 'Verify password reset token',
    description: 'Check if token is valid before showing password reset form. Returns token validity and masked email.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'abc123def456...', description: 'Reset token from email' },
      },
      required: ['token'],
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Token validation result',
    schema: {
      oneOf: [
        {
          example: {
            valid: true,
            message: 'Token is valid',
            email: 'user@example.com',
          },
        },
        {
          example: {
            valid: false,
            message: 'Invalid reset token',
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  verifyResetToken(@Body() body: { token: string }) {
    return this.authService.verifyResetToken(body.token);
  }

  @Get('reset-password-link')
  @ApiOperation({
    summary: 'Reset password landing page',
    description: 'Redirects users to the mobile app using a secure deep link.',
  })
  resetPasswordLink(@Query('token') token: string, @Res() res: Response) {
    if (!token) {
      return res.status(HttpStatus.BAD_REQUEST).type('html').send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>FootSmart Password Reset</title>
          </head>
          <body style="font-family: Arial, sans-serif; padding: 24px;">
            <h2>Invalid reset link</h2>
            <p>Please request a new password reset link.</p>
          </body>
        </html>
      `);
    }

    const deepLinkBase = this.configService.get<string>(
      'RESET_DEEP_LINK_URL',
      'footsmart://reset-password',
    );
    const encodedToken = encodeURIComponent(token);
    const appResetLink = `${deepLinkBase}?token=${encodedToken}`;

    return res.status(HttpStatus.OK).type('html').send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>FootSmart Password Reset</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 24px; }
            .card { max-width: 560px; margin: 48px auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
            .btn { display: inline-block; padding: 12px 20px; background: #10b981; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; }
            .link { word-break: break-all; color: #2563eb; }
            .muted { color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Open FootSmart to reset your password</h2>
            <p>We will open the FootSmart app to finish your password reset.</p>
            <p><a class="btn" href="${appResetLink}">Open FootSmart App</a></p>
            <p class="muted">If the app does not open, copy this link into your browser or try again:</p>
            <p class="link">${appResetLink}</p>
            <p class="muted">This link expires in 1 hour.</p>
          </div>
          <script>
            setTimeout(function () {
              window.location.href = "${appResetLink}";
            }, 300);
          </script>
        </body>
      </html>
    `);
  }
}
