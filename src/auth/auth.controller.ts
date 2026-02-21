import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetRateLimitGuard } from './guards/password-reset-rate-limit.guard';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
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
}
