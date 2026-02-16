import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, PublicRole } from './dto/register.dto';
import { UsersService } from './users/users.service';
import * as bcrypt from 'bcrypt';
import { User } from './users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
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
      kycStatus: 'not_started',
      accountStatus: 'active',
    });

    // Return JWT token
    return this.signToken(user);
  }
}
