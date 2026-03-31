import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsString,
  MinLength,
  MaxLength,
  IsDateString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export enum PublicRole {
  PLAYER = 'player',
  COACH = 'coach',
}

export class RegisterDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: 'SecurePass123',
    description: 'Password (minimum 8 characters)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(50, { message: 'Password must not exceed 50 characters' })
  password: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'Display name',
  })
  @IsString()
  @IsNotEmpty({ message: 'Display name is required' })
  @MinLength(2, { message: 'Display name must be at least 2 characters' })
  @MaxLength(50, { message: 'Display name must not exceed 50 characters' })
  displayName: string;

  @ApiProperty({
    example: '1990-01-15',
    description: 'Date of birth (ISO 8601 format)',
  })
  @IsDateString({}, { message: 'Invalid date format. Use ISO 8601 (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'Date of birth is required' })
  dateOfBirth: string;

  @ApiProperty({
    example: 'player',
    description: 'User role (player or coach only)',
    enum: PublicRole,
  })
  @IsEnum(PublicRole, {
    message: 'Role must be either player or coach',
  })
  @IsNotEmpty({ message: 'Role is required' })
  role: PublicRole;

  @ApiProperty({
    example: 'Nigeria',
    description: 'User country',
    required: false,
  })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({
    example: 'Manchester United',
    description: 'User club or team',
    required: false,
  })
  @IsString()
  @IsOptional()
  club?: string;

  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    description: 'Avatar URL',
    required: false,
  })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
