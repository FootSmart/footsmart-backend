import { Injectable, BadRequestException, UnauthorizedException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, PublicRole } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from './users/users.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailService } from './services/email.service';
import * as bcrypt from 'bcrypt';
import { User } from './users/entities/user.entity';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private emailService: EmailService,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
  ) {}

  /**
   * Generate JWT token for authenticated user
   */
  private signToken(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  /**
   * Authenticate user and return JWT token
   */
  async login(loginDto: LoginDto) {
    // Find user by email
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Return JWT token
    return this.signToken(user);
  }

  /**
   * Register new user account
   */
  async register(registerDto: RegisterDto) {
    // Security check: only allow player or coach
    if (!Object.values(PublicRole).includes(registerDto.role)) {
      throw new BadRequestException('Invalid role selection. Only player or coach are allowed.');
    }

    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    // Create user in database with all fields from DTO
    const user = await this.usersService.create({
      email: registerDto.email,
      passwordHash,
      displayName: registerDto.displayName,
      dateOfBirth: new Date(registerDto.dateOfBirth),
      is18Plus: true,
      role: registerDto.role,
      country: registerDto.country,
      club: registerDto.club,
      avatarUrl: registerDto.avatarUrl,
      kycStatus: 'not_started',
      accountStatus: 'active',
      balance: 0,
    });

    // Return JWT token
    return this.signToken(user);
  }

  /**
   * Request password reset - generates a reset token and sends email
   * 
   * SECURITY FEATURES:
   * - Tokens are hashed before storage (SHA-256)
   * - Raw token sent via email only (never stored)
   * - One-time use enforced
   * - 1 hour expiration
   * - Generic response message (prevents email enumeration)
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;
    
    this.logger.log(`Password reset requested for email: ${email}`);
    
    try {
      const user = await this.usersService.findByEmail(email);
      
      if (!user) {
        // User doesn't exist, but still return success message
        // This prevents email enumeration attacks
        this.logger.log(`Password reset requested for non-existent email: ${email}`);
      } else {
        // Delete any existing tokens for this user
        await this.passwordResetTokenRepository.delete({ userId: user.id });

        // Generate raw token (sent in email)
        const rawToken = this.generateResetToken();
        
        // Hash token for storage
        const hashedToken = this.hashToken(rawToken);
        
        // Token expires in 1 hour
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        // Create new reset token with HASHED token
        await this.passwordResetTokenRepository.save({
          userId: user.id,
          token: hashedToken, // Store hashed token
          expiresAt,
          used: false,
        });

        // Send email with RAW token (not the hash)
        const emailSent = await this.emailService.sendPasswordResetEmail(
          user.email,
          rawToken, // Send raw token in email
          user.displayName,
        );

        if (!emailSent) {
          this.logger.error(`Failed to send password reset email to ${email}`);
          // Don't reveal failure to user (security)
        } else {
          this.logger.log(`Password reset email sent successfully to ${email}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error in forgotPassword: ${error.message}`);
      // Don't reveal error to user
    }

    // Always return same message regardless of email existence (security)
    return {
      message: 'If an account exists with this email, a password reset link has been sent.',
      success: true,
    };
  }

  /**
   * Reset password using token
   * 
   * SECURITY FLOW:
   * 1. User receives raw token via email
   * 2. User submits raw token + new password
   * 3. Backend hashes submitted token and looks up in DB
   * 4. Validates token hasn't been used and isn't expired
   * 5. Updates password and marks token as used
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token: rawToken, newPassword } = resetPasswordDto;

    this.logger.log('Password reset attempt initiated');

    // Hash the submitted token to match against stored hash
    const hashedToken = this.hashToken(rawToken);

    // Find valid token by HASHED value
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token: hashedToken },
      relations: ['user'],
    });

    if (!resetToken) {
      this.logger.warn('Invalid reset token submitted');
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (resetToken.used) {
      this.logger.warn(`Reset token already used for user: ${resetToken.userId}`);
      throw new BadRequestException('This reset token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      this.logger.warn(`Expired reset token submitted for user: ${resetToken.userId}`);
      throw new BadRequestException('Reset token has expired. Please request a new password reset.');
    }

    // Hash new password (bcrypt with 10 rounds)
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update user password
    await this.usersService.updatePassword(resetToken.userId, passwordHash);

    // Mark token as used (prevents reuse)
    resetToken.used = true;
    await this.passwordResetTokenRepository.save(resetToken);

    this.logger.log(`Password successfully reset for user: ${resetToken.user.email}`);

    return {
      message: 'Password reset successfully. Please login with your new password.',
      success: true,
    };
  }

  /**
   * Verify reset token validity (optional endpoint for Flutter)
   * Allows Flutter to check if token is valid before showing password form
   */
  async verifyResetToken(rawToken: string) {
    const hashedToken = this.hashToken(rawToken);
    
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token: hashedToken },
      relations: ['user'],
    });

    if (!resetToken) {
      return {
        valid: false,
        message: 'Invalid reset token',
      };
    }

    if (resetToken.used) {
      return {
        valid: false,
        message: 'This token has already been used',
      };
    }

    if (resetToken.expiresAt < new Date()) {
      return {
        valid: false,
        message: 'Reset token has expired',
      };
    }

    return {
      valid: true,
      message: 'Token is valid',
      email: resetToken.user.email, // Can show masked email to user
    };
  }

  /**
   * Generate a cryptographically secure random token
   * 64 hex characters = 32 bytes of entropy = 256 bits
   */
  private generateResetToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Hash token using SHA-256
   * We store hashed tokens to prevent token theft from database breaches
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
