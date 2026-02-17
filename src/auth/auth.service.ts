import { Injectable, BadRequestException, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, PublicRole } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from './users/users.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import * as bcrypt from 'bcrypt';
import { User } from './users/entities/user.entity';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
  ) {}

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

    // Create user in database with all required fields
    const user = await this.usersService.create({
      email: registerDto.email,
      passwordHash,
      displayName: registerDto.displayName,
      dateOfBirth: new Date(registerDto.dateOfBirth),
      is18Plus: true,
      role: registerDto.role,
      accountStatus: 'active',
    });

    // Return JWT token
    return this.signToken(user);
  }

  /**
   * Request password reset - generates a reset token
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);
    
    // Security: Always return success message even if user doesn't exist
    if (!user) {
      return {
        message: 'If an account exists with this email, a password reset link will be sent',
      };
    }

    // Generate unique token
    const token = this.generateResetToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

    // Delete any existing tokens for this user
    await this.passwordResetTokenRepository.delete({ userId: user.id });

    // Create new reset token
    await this.passwordResetTokenRepository.save({
      userId: user.id,
      token,
      expiresAt,
      used: false,
    });

    // TODO: Send email with reset link
    // In production, send email: yourapp.com/reset-password?token=${token}
    // For now, return token for testing (remove in production)
    return {
      message: 'Password reset email sent',
      // Remove this in production:
      resetToken: token,
      expiresIn: '1 hour',
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;

    // Find valid token
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token },
      relations: ['user'],
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (resetToken.used) {
      throw new BadRequestException('This reset token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update user password
    await this.usersService.updatePassword(resetToken.userId, passwordHash);

    // Mark token as used
    resetToken.used = true;
    await this.passwordResetTokenRepository.save(resetToken);

    return {
      message: 'Password reset successfully',
    };
  }

  /**
   * Verify reset token validity
   */
  async verifyResetToken(token: string) {
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid reset token');
    }

    if (resetToken.used) {
      throw new BadRequestException('This token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    return {
      valid: true,
      message: 'Token is valid',
    };
  }

  /**
   * Generate a secure random token
   */
  private generateResetToken(): string {
    return randomBytes(32).toString('hex');
  }
}
